import { afterEach, describe, expect, it, vi } from "vitest";
import type { Candidate, RadarRules } from "@/types/contracts";
import {
  fetchMusicNewsRss,
  MUSIC_NEWS_RSS_URL,
} from "@/lib/sources/music-news-rss";
import { normalizeCandidate, normalizeUrl } from "@/lib/sources/normalize";
import { searchTavily } from "@/lib/sources/tavily";
import {
  evaluateCandidateItemSchema,
  evaluateCandidatesJsonSchema,
  parseRulesJsonSchema,
} from "@/lib/ai/schemas";
import { evaluateCandidates } from "@/lib/ai/evaluate-candidates";
import { parseRules } from "@/lib/ai/parse-rules";
import {
  createTelegramClient,
  sendTelegramMessage,
  TelegramApiError,
} from "@/lib/telegram/client";

const tavilyFixture = {
  url: "https://example.com/news?utm_source=x&id=1",
  title: "LISA announces a new single",
  content: "Official update from the artist team.",
  published_date: "2026-08-01T00:00:00.000Z",
};

const rssFixture = {
  title: "Music News headline",
  link: "https://www.music-news.com/news/UK/123456?utm_source=rss",
  contentSnippet:
    "First sentence. Second sentence that should not be included in the excerpt.",
  isoDate: "2026-08-02T00:00:00.000Z",
};

const rules: RadarRules = {
  radarName: "LISA Official Radar",
  subject: "LISA",
  aliases: ["Lalisa"],
  includeTopics: ["single", "tour"],
  excludeTopics: ["fan cam"],
  searchQuery: 'LISA ("single" OR "tour")',
  importanceThreshold: 80,
  intervalMinutes: 360,
};

const testServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "cron-secret",
  RULE_TOKEN_SECRET: "rule-token-secret-that-is-at-least-32-chars",
  TAVILY_API_KEY: "tavily-key",
  GROQ_API_KEY: "groq-key",
  TELEGRAM_BOT_TOKEN: "telegram-token",
  TELEGRAM_BOT_USERNAME: "watch_anything_bot",
  TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
};

function stubServerEnv(groqModel = "openai/gpt-oss-20b") {
  for (const [name, value] of Object.entries({
    ...testServerEnv,
    GROQ_MODEL: groqModel,
  })) {
    vi.stubEnv(name, value);
  }
}

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }

  throw new Error("Expected operation to reject.");
}

function createGroqStub(responses: string[]) {
  const create = vi.fn(async () => {
    const content = responses.shift();

    if (content === undefined) {
      throw new Error("No stubbed Groq response");
    }

    return {
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    };
  });

  return {
    chat: {
      completions: {
        create,
      },
    },
    create,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("normalizeUrl", () => {
  it("removes tracking parameters but keeps stable identifiers", () => {
    expect(normalizeUrl("https://example.com/news?utm_source=x&id=1")).toBe(
      "https://example.com/news?id=1",
    );
  });
});

describe("normalizeCandidate", () => {
  it("maps Tavily records into the shared Candidate shape", () => {
    expect(normalizeCandidate(tavilyFixture)).toEqual({
      sourceType: "tavily",
      sourceDomain: "example.com",
      sourceUrl: "https://example.com/news?id=1",
      title: "LISA announces a new single",
      excerpt: "Official update from the artist team.",
      publishedAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("maps RSS records into the shared Candidate shape", () => {
    expect(normalizeCandidate(rssFixture)).toEqual({
      sourceType: "rss",
      sourceDomain: "www.music-news.com",
      sourceUrl: "https://www.music-news.com/news/UK/123456",
      title: "Music News headline",
      excerpt: "First sentence.",
      publishedAt: "2026-08-02T00:00:00.000Z",
    });
  });
});

describe("searchTavily", () => {
  it("uses Basic Search with max 5 results and normalizes the response", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [tavilyFixture],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const candidates = await searchTavily({
      query: rules.searchQuery,
      apiKey: "tavily-key",
      fetchFn,
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchFn.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];

    expect(requestUrl).toBe("https://api.tavily.com/search");
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      query: rules.searchQuery,
      search_depth: "basic",
      max_results: 5,
    });
    expect(candidates).toEqual([
      {
        sourceType: "tavily",
        sourceDomain: "example.com",
        sourceUrl: "https://example.com/news?id=1",
        title: "LISA announces a new single",
        excerpt: "Official update from the artist team.",
        publishedAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("maps Node TimeoutError to a stable timeout error", async () => {
    const timeoutError = Object.assign(new Error("provider timeout detail"), {
      name: "TimeoutError",
    });
    const fetchFn = vi.fn(async () => {
      throw timeoutError;
    });

    const error = await captureError(() =>
      searchTavily({
        query: rules.searchQuery,
        apiKey: "tavily-key",
        fetchFn,
      }),
    );

    expect(error).toMatchObject({
      code: "TAVILY_TIMEOUT",
      message: "Tavily request timed out.",
    });
    expect(String(error)).not.toContain("provider timeout detail");
  });

  it("does not expose Tavily HTTP status details", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: "private provider detail" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await captureError(() =>
      searchTavily({
        query: rules.searchQuery,
        apiKey: "tavily-key",
        fetchFn,
      }),
    );

    expect(error).toMatchObject({
      code: "TAVILY_REQUEST_FAILED",
      message: "Tavily request failed.",
    });
    expect(String(error)).not.toContain("503");
    expect(String(error)).not.toContain("private provider detail");
  });
});

describe("fetchMusicNewsRss", () => {
  it("uses the fixed Music-News feed and returns normalized candidates", async () => {
    const feed = {
      items: [rssFixture],
    };
    const fetchFn = vi.fn(async () =>
      new Response("<rss />", {
        status: 200,
        headers: { "content-type": "application/xml" },
      }),
    );
    const parser = {
      parseString: vi.fn(async () => feed),
    };

    const candidates = await fetchMusicNewsRss({
      fetchFn,
      parser,
    });

    expect(fetchFn).toHaveBeenCalledWith(
      MUSIC_NEWS_RSS_URL,
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(parser.parseString).toHaveBeenCalledOnce();
    expect(candidates).toEqual([
      {
        sourceType: "rss",
        sourceDomain: "www.music-news.com",
        sourceUrl: "https://www.music-news.com/news/UK/123456",
        title: "Music News headline",
        excerpt: "First sentence.",
        publishedAt: "2026-08-02T00:00:00.000Z",
      },
    ]);
  });

  it("maps Node TimeoutError to a stable timeout error", async () => {
    const timeoutError = Object.assign(new Error("rss timeout detail"), {
      name: "TimeoutError",
    });
    const fetchFn = vi.fn(async () => {
      throw timeoutError;
    });

    const error = await captureError(() => fetchMusicNewsRss({ fetchFn }));

    expect(error).toMatchObject({
      code: "RSS_TIMEOUT",
      message: "RSS request timed out.",
    });
    expect(String(error)).not.toContain("rss timeout detail");
  });

  it("does not expose RSS HTTP status details", async () => {
    const fetchFn = vi.fn(async () =>
      new Response("private rss detail", {
        status: 502,
        headers: { "content-type": "application/xml" },
      }),
    );

    const error = await captureError(() => fetchMusicNewsRss({ fetchFn }));

    expect(error).toMatchObject({
      code: "RSS_REQUEST_FAILED",
      message: "RSS request failed.",
    });
    expect(String(error)).not.toContain("502");
    expect(String(error)).not.toContain("private rss detail");
  });

  it("rejects RSS items without a link using a stable error", async () => {
    const fetchFn = vi.fn(async () => new Response("<rss />", { status: 200 }));
    const parser = {
      parseString: vi.fn(async () => ({
        items: [{ title: "Headline without a link" }],
      })),
    };

    const error = await captureError(() =>
      fetchMusicNewsRss({ fetchFn, parser }),
    );

    expect(error).toMatchObject({
      code: "RSS_INVALID_RESPONSE",
      message: "RSS response was invalid.",
    });
    expect(String(error)).not.toContain("Invalid URL");
  });

  it("rejects RSS items without a non-empty title using a stable error", async () => {
    const fetchFn = vi.fn(async () => new Response("<rss />", { status: 200 }));
    const parser = {
      parseString: vi.fn(async () => ({
        items: [
          {
            link: "https://example.com/article",
            title: "   ",
          },
        ],
      })),
    };

    const error = await captureError(() =>
      fetchMusicNewsRss({ fetchFn, parser }),
    );

    expect(error).toMatchObject({
      code: "RSS_INVALID_RESPONSE",
      message: "RSS response was invalid.",
    });
  });
});

describe("parseRules", () => {
  it("uses strict schema output and appends the fixed interval", async () => {
    stubServerEnv();
    const groq = createGroqStub([
      JSON.stringify({
        radar_name: "LISA Official Radar",
        subject: "LISA",
        aliases: ["Lalisa"],
        include_topics: ["single", "tour"],
        exclude_topics: ["fan cam"],
        search_query: 'LISA ("single" OR "tour")',
        importance_threshold: 80,
      }),
    ]);

    const parsed = await parseRules({
      prompt: "Track important LISA music updates",
      groq,
    });

    const [request] = groq.create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];

    expect(request.model).toBe("openai/gpt-oss-20b");
    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "parse_rules",
        strict: true,
        schema: parseRulesJsonSchema,
      },
    });
    expect(parsed).toEqual({
      radarName: "LISA Official Radar",
      subject: "LISA",
      aliases: ["Lalisa"],
      includeTopics: ["single", "tour"],
      excludeTopics: ["fan cam"],
      searchQuery: 'LISA ("single" OR "tour")',
      importanceThreshold: 80,
      intervalMinutes: 360,
    });
  });

  it("retries exactly once when the first structured result fails Zod validation", async () => {
    stubServerEnv();
    const groq = createGroqStub([
      JSON.stringify({
        radar_name: "Broken rules",
        subject: "LISA",
      }),
      JSON.stringify({
        radar_name: "LISA Official Radar",
        subject: "LISA",
        aliases: ["Lalisa"],
        include_topics: ["single"],
        exclude_topics: ["fan cam"],
        search_query: "LISA single",
        importance_threshold: 85,
      }),
    ]);

    const parsed = await parseRules({
      prompt: "Track LISA singles",
      groq,
    });

    expect(groq.create).toHaveBeenCalledTimes(2);
    expect(parsed.intervalMinutes).toBe(360);
  });

  it("always uses GROQ_MODEL instead of a caller-supplied model", async () => {
    stubServerEnv("configured-groq-model");
    const groq = createGroqStub([
      JSON.stringify({
        radar_name: "LISA Official Radar",
        subject: "LISA",
        aliases: [],
        include_topics: ["single"],
        exclude_topics: [],
        search_query: "LISA single",
        importance_threshold: 80,
      }),
    ]);

    const input = {
      prompt: "Track LISA singles",
      groq,
      model: "caller-controlled-model",
    } as unknown as Parameters<typeof parseRules>[0];

    await parseRules(input);

    const [request] = groq.create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(request.model).toBe("configured-groq-model");
  });

  it("maps raw Groq transport errors to a stable public error", async () => {
    stubServerEnv();
    const privateProviderDetail = "groq provider response with internal details";
    const create = vi.fn(async () => {
      throw new Error(privateProviderDetail);
    });
    const groq = {
      chat: {
        completions: {
          create,
        },
      },
    };

    const error = await captureError(() =>
      parseRules({
        prompt: "Track LISA singles",
        groq,
      }),
    );

    expect(error).toMatchObject({
      code: "GROQ_REQUEST_FAILED",
      message: "Groq request failed.",
    });
    expect(String(error)).not.toContain(privateProviderDetail);
  });
});

describe("evaluateCandidates", () => {
  it("uses strict schema output, limits the prompt to 8 candidates, and truncates excerpts", async () => {
    stubServerEnv();
    const longExcerpt = "a".repeat(1200);
    const candidates: Candidate[] = Array.from({ length: 9 }, (_, index) => ({
      sourceType: index % 2 === 0 ? "tavily" : "rss",
      sourceDomain: `example${index}.com`,
      sourceUrl: `https://example${index}.com/article`,
      title: `Candidate ${index}`,
      excerpt: longExcerpt,
      publishedAt: "2026-08-03T00:00:00.000Z",
    }));
    const groq = createGroqStub([
      JSON.stringify(
        Array.from({ length: 8 }, (_, index) => ({
          relevant: index === 0,
          relevance_score: 90 - index,
          importance_score: 88 - index,
          confidence: 0.9,
          event_key: index === 0 ? "lisa-new-single-2026-09" : null,
          duplicate_of_event_key: null,
          reason: `Reason ${index}`,
        })),
      ),
    ]);

    const result = await evaluateCandidates({
      rules,
      candidates,
      groq,
    });

    const [request] = groq.create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    const messages = request.messages as Array<{ content: string }>;
    const content = String(messages[1]?.content);

    expect(request.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "evaluate_candidates",
        strict: true,
        schema: evaluateCandidatesJsonSchema,
      },
    });
    expect(content).toContain('"title":"Candidate 0"');
    expect(content).not.toContain('"title":"Candidate 8"');
    expect(content).toContain(`"excerpt":"${"a".repeat(800)}"`);
    expect(result).toHaveLength(8);
    expect(result[0]).toEqual({
      candidate: {
        sourceType: "tavily",
        sourceDomain: "example0.com",
        sourceUrl: "https://example0.com/article",
        title: "Candidate 0",
        excerpt: longExcerpt,
        publishedAt: "2026-08-03T00:00:00.000Z",
      },
      evaluation: evaluateCandidateItemSchema.parse({
        relevant: true,
        relevance_score: 90,
        importance_score: 88,
        confidence: 0.9,
        event_key: "lisa-new-single-2026-09",
        duplicate_of_event_key: null,
        reason: "Reason 0",
      }),
    });
  });

  it("always uses GROQ_MODEL instead of a caller-supplied model", async () => {
    stubServerEnv("configured-groq-model");
    const groq = createGroqStub([
      JSON.stringify([
        {
          relevant: true,
          relevance_score: 90,
          importance_score: 90,
          confidence: 0.9,
          event_key: "lisa-single-2026",
          duplicate_of_event_key: null,
          reason: "Relevant update",
        },
      ]),
    ]);

    const input = {
      rules,
      candidates: [
        {
          sourceType: "tavily",
          sourceDomain: "example.com",
          sourceUrl: "https://example.com/article",
          title: "LISA single",
          excerpt: "Official update.",
          publishedAt: null,
        },
      ],
      groq,
      model: "caller-controlled-model",
    } as unknown as Parameters<typeof evaluateCandidates>[0];

    await evaluateCandidates(input);

    const [request] = groq.create.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(request.model).toBe("configured-groq-model");
  });
});

describe("Telegram client", () => {
  it("does not retry sendMessage and maps timeout to TELEGRAM_RESULT_UNKNOWN", async () => {
    const timeoutError = new DOMException("Timed out", "AbortError");
    const fetchFn = vi.fn(async () => {
      throw timeoutError;
    });

    await expect(
      sendTelegramMessage({
        chatId: 123456,
        text: "Radar alert",
        token: "telegram-token",
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "TELEGRAM_RESULT_UNKNOWN",
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps Node TimeoutError to TELEGRAM_RESULT_UNKNOWN", async () => {
    const timeoutError = Object.assign(new Error("telegram timeout detail"), {
      name: "TimeoutError",
    });
    const fetchFn = vi.fn(async () => {
      throw timeoutError;
    });

    const error = await captureError(() =>
      sendTelegramMessage({
        chatId: 123456,
        text: "Radar alert",
        token: "telegram-token",
        fetchFn,
      }),
    );

    expect(error).toMatchObject({
      code: "TELEGRAM_RESULT_UNKNOWN",
      message: "Telegram request timed out before delivery could be confirmed.",
    });
    expect(String(error)).not.toContain("telegram timeout detail");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps non-timeout sendMessage transport errors to unknown without retry", async () => {
    const privateTransportDetail = "socket closed after delivery";
    const fetchFn = vi.fn(async () => {
      throw new Error(privateTransportDetail);
    });

    const error = await captureError(() =>
      sendTelegramMessage({
        chatId: 123456,
        text: "Radar alert",
        token: "telegram-token",
        fetchFn,
      }),
    );

    expect(error).toMatchObject({
      code: "TELEGRAM_RESULT_UNKNOWN",
      message: "Telegram message delivery result is unknown.",
    });
    expect(String(error)).not.toContain(privateTransportDetail);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does not expose Telegram descriptions or HTTP status details", async () => {
    const privateTelegramDetail = "bot token is invalid for internal reasons";
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          description: privateTelegramDetail,
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    const client = createTelegramClient({
      token: "telegram-token",
      fetchFn,
    });

    const error = await captureError(() =>
      client.sendMessage({
        chatId: 123456,
        text: "Radar alert",
      }),
    );

    expect(error).toMatchObject({
      code: "TELEGRAM_API_ERROR",
      message: "Telegram API request failed.",
    });
    expect(String(error)).not.toContain(privateTelegramDetail);
    expect(String(error)).not.toContain("401");
  });

  it("wraps getMe, setWebhook, getWebhookInfo, and sendMessage", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              id: 1,
              is_bot: true,
              first_name: "Watch Anything",
              username: "watch_anything_bot",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              url: "https://example.com/api/telegram/webhook",
              has_custom_certificate: false,
              pending_update_count: 0,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 42,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const client = createTelegramClient({
      token: "telegram-token",
      fetchFn,
    });

    await expect(client.getMe()).resolves.toMatchObject({
      username: "watch_anything_bot",
    });
    await expect(
      client.setWebhook({
        url: "https://example.com/api/telegram/webhook",
        secretToken: "secret",
      }),
    ).resolves.toBe(true);
    await expect(client.getWebhookInfo()).resolves.toMatchObject({
      pending_update_count: 0,
    });
    await expect(
      client.sendMessage({
        chatId: 123456,
        text: "Radar alert",
      }),
    ).resolves.toEqual({ message_id: 42 });
  });

  it("exposes stable Telegram API errors", async () => {
    expect(new TelegramApiError("TELEGRAM_RESULT_UNKNOWN", "Unknown")).toMatchObject({
      code: "TELEGRAM_RESULT_UNKNOWN",
    });
  });
});
