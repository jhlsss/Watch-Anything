import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AiAdapterError,
  createGeminiClient,
  createStructuredOutput,
  parseRulesJsonSchema,
  resolveGeminiModel,
  type AiLike,
} from "@/lib/ai/schemas";

const { openAiConstructor } = vi.hoisted(() => ({
  openAiConstructor: vi.fn(function OpenAI() {
    return {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };
  }),
}));

vi.mock("openai", () => ({
  default: openAiConstructor,
}));

const completeServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "cron-secret",
  RULE_TOKEN_SECRET: "rule-token-secret-that-is-at-least-32-chars",
  TAVILY_API_KEY: "tavily-key",
  GEMINI_API_KEY: "gemini-env-key",
  GEMINI_MODEL: "gemini-env-model",
  TELEGRAM_BOT_TOKEN: "telegram-token",
  TELEGRAM_BOT_USERNAME: "watch_anything_bot",
  TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
};

function stubCompleteServerEnv(): void {
  for (const [key, value] of Object.entries(completeServerEnv)) {
    vi.stubEnv(key, value);
  }
}

describe("Gemini OpenAI-compatible client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    openAiConstructor.mockClear();
  });

  it("constructs the OpenAI SDK with the Gemini API key and base URL", () => {
    createGeminiClient("gemini-test-key");

    expect(openAiConstructor).toHaveBeenCalledExactlyOnceWith({
      apiKey: "gemini-test-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  });

  it("reads GEMINI_API_KEY from server env when no explicit key is supplied without logging it", () => {
    stubCompleteServerEnv();
    const consoleError = vi.spyOn(console, "error");
    const consoleLog = vi.spyOn(console, "log");
    const consoleWarn = vi.spyOn(console, "warn");

    createGeminiClient();

    expect(openAiConstructor).toHaveBeenCalledExactlyOnceWith({
      apiKey: "gemini-env-key",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("resolves the Gemini model from the server environment", () => {
    stubCompleteServerEnv();

    expect(resolveGeminiModel()).toBe("gemini-env-model");
  });
});

describe("createStructuredOutput", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a Gemini-compatible json_schema request with max_tokens and request options", async () => {
    const abortController = new AbortController();
    const create = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ answer: "yes" }),
          },
        },
      ],
    }));
    const ai: AiLike = {
      chat: {
        completions: { create },
      },
    };

    await expect(
      createStructuredOutput({
        ai,
        model: "gemini-test-model",
        schemaName: "test_schema",
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string" } },
        },
        messages: [{ role: "user", content: "Return an answer." }],
        validator: z.object({ answer: z.string() }),
        maxCompletionTokens: 123,
        requestOptions: {
          signal: abortController.signal,
          timeout: 456,
          maxRetries: 0,
        },
      }),
    ).resolves.toEqual({ answer: "yes" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-test-model",
        messages: [{ role: "user", content: "Return an answer." }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "test_schema",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["answer"],
              properties: { answer: { type: "string" } },
            },
          },
        },
        max_tokens: 123,
      }),
      {
        signal: abortController.signal,
        timeout: 456,
        maxRetries: 0,
      },
    );
    expect((create.mock.calls as unknown[][])[0]?.[0]).not.toHaveProperty(
      "max_completion_tokens",
    );
  });

  it("classifies invalid responses as AI_INVALID_RESPONSE after one repair attempt", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        choices: [{ message: { content: "" } }],
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: { text: "{}" } } }],
      });
    const ai: AiLike = {
      chat: {
        completions: { create },
      },
    };

    await expect(
      createStructuredOutput({
        ai,
        model: "gemini-test-model",
        schemaName: "test_schema",
        jsonSchema: {
          type: "object",
          additionalProperties: false,
          required: ["answer"],
          properties: { answer: { type: "string" } },
        },
        messages: [{ role: "user", content: "Return an answer." }],
        validator: z.object({ answer: z.string() }),
      }),
    ).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    } satisfies Partial<AiAdapterError>);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      messages: [
        { role: "user", content: "Return an answer." },
        {
          role: "user",
          content: expect.stringContaining("failed validation"),
        },
      ],
    });
  });

  it("classifies a Gemini-compatible HTTP 429 as AI_RATE_LIMITED after its single retry budget", async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error("HTTP 429"), {
      status: 429,
      headers: new Headers({ "retry-after": "0" }),
    });
    const create = vi.fn(async () => {
      throw rateLimitError;
    });
    const ai: AiLike = {
      chat: {
        completions: { create },
      },
    };

    const resultPromise = createStructuredOutput({
      ai,
      model: "gemini-test-model",
      schemaName: "test_schema",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: { answer: { type: "string" } },
      },
      messages: [{ role: "user", content: "Return an answer." }],
      validator: z.object({ answer: z.string() }),
    });

    const expectation = expect(resultPromise).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
    } satisfies Partial<AiAdapterError>);

    await vi.runAllTimersAsync();
    await expectation;
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("shares one HTTP 429 retry budget across initial and repair attempts", async () => {
    vi.useFakeTimers();
    const rateLimitError = Object.assign(new Error("HTTP 429"), {
      status: 429,
      headers: new Headers({ "retry-after-ms": "0" }),
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ answer: 123 }),
            },
          },
        ],
      })
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ answer: "should-not-retry" }),
            },
          },
        ],
      });
    const ai: AiLike = {
      chat: {
        completions: { create },
      },
    };

    const resultPromise = createStructuredOutput({
      ai,
      model: "gemini-test-model",
      schemaName: "test_schema",
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["answer"],
        properties: { answer: { type: "string" } },
      },
      messages: [{ role: "user", content: "Return an answer." }],
      validator: z.object({ answer: z.string() }),
    });

    const expectation = expect(resultPromise).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
    } satisfies Partial<AiAdapterError>);

    await vi.runAllTimersAsync();
    await expectation;
    expect(create).toHaveBeenCalledTimes(3);
  });
});

describe("parseRulesJsonSchema", () => {
  it("uses a Gemini-compatible numeric importance threshold schema", () => {
    expect(parseRulesJsonSchema.properties.importance_threshold).toEqual({
      type: "number",
      minimum: 0,
      maximum: 100,
    });
  });
});
