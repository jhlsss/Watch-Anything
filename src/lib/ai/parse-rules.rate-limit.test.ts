import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRules } from "@/lib/ai/parse-rules";
import type { GroqLike } from "@/lib/ai/schemas";

// Regression: BLOCKER-01 — a Groq 429 escaped the first Rules generation attempt.
// Found by /qa on 2026-08-07
// Report: .gstack/qa-reports/qa-report-rules-followup-localhost-2026-08-07.md
describe("parseRules rate-limit recovery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retries a rate-limited generation before surfacing an error", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv(
      "RULE_TOKEN_SECRET",
      "rule-token-secret-that-is-at-least-32-chars",
    );
    vi.stubEnv("TAVILY_API_KEY", "tavily-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "telegram-token");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "watch_anything_bot");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "telegram-webhook-secret");

    const rateLimitError = Object.assign(new Error("429 rate limit"), {
      status: 429,
      headers: new Headers({ "retry-after": "0" }),
    });
    let attempts = 0;
    const create = vi.fn(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw rateLimitError;
      }

      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                radar_name: "OpenAI Release Monitor",
                subject: "OpenAI product releases and model updates",
                aliases: ["OpenAI"],
                include_topics: ["product release"],
                exclude_topics: [],
                search_query: "OpenAI product release model update",
                importance_threshold: 75,
              }),
            },
          },
        ],
      };
    });
    const groq: GroqLike = {
      chat: {
        completions: { create },
      },
    };

    await expect(
      parseRules({
        prompt:
          "Track official OpenAI product releases and major model updates from trusted public sources",
        groq,
      }),
    ).resolves.toMatchObject({ radarName: "OpenAI Release Monitor" });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("returns editable rules when the provider daily token quota is exhausted", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv(
      "RULE_TOKEN_SECRET",
      "rule-token-secret-that-is-at-least-32-chars",
    );
    vi.stubEnv("TAVILY_API_KEY", "tavily-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-20b");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "telegram-token");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "watch_anything_bot");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "telegram-webhook-secret");

    const rateLimitError = Object.assign(
      new Error("429 tokens per day rate limit"),
      {
        status: 429,
        headers: new Headers({ "retry-after": "0" }),
        error: {
          code: "rate_limit_exceeded",
          message: "tokens per day limit reached",
        },
      },
    );
    const create = vi.fn(async () => {
      throw rateLimitError;
    });
    const groq: GroqLike = {
      chat: {
        completions: { create },
      },
    };

    await expect(
      parseRules({
        prompt:
          "Track official creator releases, tours and partnerships from trusted public sources.",
        groq,
      }),
    ).resolves.toMatchObject({
      includeTopics: ["creator", "releases", "tours", "partnerships"],
      searchQuery: "creator releases tours partnerships",
    });
  });
});
