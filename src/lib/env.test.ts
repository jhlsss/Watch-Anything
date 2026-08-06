import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const validServerEnv = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "cron-secret",
  RULE_TOKEN_SECRET: "rule-token-secret-that-is-at-least-32-chars",
  TAVILY_API_KEY: "tavily-key",
  GEMINI_API_KEY: "gemini-key",
  TELEGRAM_BOT_TOKEN: "telegram-token",
  TELEGRAM_BOT_USERNAME: "watch_anything_bot",
  TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
};

describe("parseServerEnv", () => {
  it("reports a missing server secret by name", () => {
    expect(() => parseServerEnv({})).toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("uses the stable Gemini model when no override is provided", () => {
    expect(parseServerEnv(validServerEnv).GEMINI_MODEL).toBe("gemini-3.1-flash-lite");
  });
});

describe("parsePublicEnv", () => {
  it("parses the public Supabase settings", async () => {
    const { parsePublicEnv } = await import("@/lib/env");

    expect(
      parsePublicEnv({
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
  });

  it("does not require the app URL to create a Supabase client", async () => {
    const { parsePublicEnv } = await import("@/lib/env");

    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    });
  });
});
