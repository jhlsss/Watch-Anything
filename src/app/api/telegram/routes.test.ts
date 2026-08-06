import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authGetUser = vi.hoisted(() => vi.fn());
const adminFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: authGetUser },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(() => ({ from: adminFrom })),
}));

vi.mock("@/lib/env", () => ({
  parseServerEnv: vi.fn(() => ({
    TELEGRAM_BOT_USERNAME: "watchanything_bot",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CRON_SECRET: "cron-secret",
    RULE_TOKEN_SECRET: "rule-token-secret-that-is-at-least-32-chars",
    TAVILY_API_KEY: "tavily-key",
    GEMINI_API_KEY: "gemini-key",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
  })),
}));

import {
  GET as probeBindingToken,
  POST as createBindingToken,
} from "@/app/api/telegram/binding-token/route";
import { GET as getTelegramStatus } from "@/app/api/telegram/status/route";
import {
  GET as probeTelegramWebhook,
  POST as receiveTelegramWebhook,
} from "@/app/api/telegram/webhook/route";

const apiRoot = path.resolve(process.cwd(), "src/app/api");

describe("Telegram API route surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("exposes the binding-token, status, and webhook handlers", () => {
    expect(existsSync(path.join(apiRoot, "telegram/binding-token/route.ts"))).toBe(true);
    expect(existsSync(path.join(apiRoot, "telegram/status/route.ts"))).toBe(true);
    expect(existsSync(path.join(apiRoot, "telegram/webhook/route.ts"))).toBe(true);
  });

  it("returns 401 for an unauthenticated status request", async () => {
    const response = await getTelegramStatus();

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("returns 401 for an unauthenticated binding-token request", async () => {
    const response = await createBindingToken();

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("keeps the binding endpoint behind the same auth boundary for GET probes", async () => {
    const response = await probeBindingToken();

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("rejects a webhook before reading its body when the secret is wrong", async () => {
    const json = vi.fn();
    const request = {
      headers: new Headers({
        "x-telegram-bot-api-secret-token": "wrong-secret",
      }),
      json,
    } as unknown as Request;

    const response = await receiveTelegramWebhook(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(adminFrom).not.toHaveBeenCalled();
  });

  it("rejects a GET webhook probe before reading a body", async () => {
    const response = await probeTelegramWebhook(
      new Request("http://localhost/api/telegram/webhook"),
    );

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
  });
});
