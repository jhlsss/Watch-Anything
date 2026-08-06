import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRules } from "@/lib/ai/parse-rules";
import type { AiLike } from "@/lib/ai/schemas";
import { radarRulesSchema } from "@/lib/validation/radar-rules";

// Regression: BLOCKER-01 — provider daily token quota made long Rules generation fail.
// Found by /qa on 2026-08-07
// Report: screenshot supplied in the task; server log showed provider TPD rate limiting.
describe("parseRules provider fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns confirmation-safe rules when the provider quota remains exhausted", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv(
      "RULE_TOKEN_SECRET",
      "rule-token-secret-that-is-at-least-32-chars",
    );
    vi.stubEnv("TAVILY_API_KEY", "tavily-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-model");
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
    const ai: AiLike = {
      chat: {
        completions: { create },
      },
    };

    const rules = await parseRules({
      prompt:
        "Track official creator releases, tours and partnerships from trusted public sources.",
      ai,
    });

    expect(radarRulesSchema.safeParse(rules).success).toBe(true);
    expect(rules.includeTopics).toEqual([
      "creator",
      "releases",
      "tours",
      "partnerships",
    ]);
    expect(rules.searchQuery).toBe("creator releases tours partnerships");
    expect(rules.importanceThreshold).toBe(75);
  });
});
