import { beforeEach, describe, expect, it, vi } from "vitest";

const consumeBindingToken = vi.hoisted(() => vi.fn());
const hashBindingToken = vi.hoisted(() => vi.fn((token: string) => `hashed:${token}`));
const adminRpc = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/telegram/binding-token", () => ({
  consumeBindingToken,
  hashBindingToken,
}));

vi.mock("@/lib/telegram/client", () => ({
  createTelegramClient: vi.fn(() => ({ sendMessage })),
}));

vi.mock("@/lib/env", () => ({
  parseServerEnv: vi.fn(() => ({
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_BOT_USERNAME: "watchanything_bot",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    CRON_SECRET: "cron-secret",
    RULE_TOKEN_SECRET: "rule-token-secret-that-is-at-least-32-chars",
    TAVILY_API_KEY: "tavily-key",
    GEMINI_API_KEY: "gemini-key",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(() => ({ rpc: adminRpc })),
}));

import { POST } from "@/app/api/telegram/webhook/route";

function webhookRequest(body: unknown): Request {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "webhook-secret",
    },
    body: JSON.stringify(body),
  });
}

describe("Telegram webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage.mockResolvedValue({ message_id: 1 });
    consumeBindingToken.mockResolvedValue({ userId: "user-1" });
    adminRpc.mockResolvedValue({
      data: [{ user_id: "user-1", error_code: null }],
      error: null,
    });
  });

  it("uses the atomic binding service for a private /start update", async () => {
    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 987654, type: "private" },
          from: { username: "alice" },
          text: "/start raw-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(consumeBindingToken).toHaveBeenCalledWith("raw-token", {
      chatId: 987654,
      username: "alice",
      client: expect.objectContaining({ rpc: adminRpc }),
    });
    expect(adminRpc).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 987654,
      text: expect.stringContaining("connected"),
    });
  });

  it("returns a stable invalid-token response without leaking token data", async () => {
    consumeBindingToken.mockRejectedValue(new Error("TOKEN_ALREADY_USED"));

    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: 987654, type: "private" },
          text: "/start raw-token",
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "TOKEN_ALREADY_USED" });
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: 987654,
      text: expect.not.stringContaining("raw-token"),
    });
  });

  it("ignores non-private updates without consuming a token", async () => {
    const response = await POST(
      webhookRequest({
        message: {
          chat: { id: -100, type: "group" },
          text: "/start raw-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, ignored: true });
    expect(consumeBindingToken).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects an incorrect secret before reading the update body", async () => {
    const json = vi.fn();
    const request = {
      headers: new Headers({
        "x-telegram-bot-api-secret-token": "wrong-secret",
      }),
      json,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(consumeBindingToken).not.toHaveBeenCalled();
  });
});
