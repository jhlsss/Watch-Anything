import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { hashBindingToken } from "@/lib/telegram/binding-token";
import { createTelegramClient } from "@/lib/telegram/client";
import { parseServerEnv } from "@/lib/env";
import { createClient as createAdminClient } from "@/lib/supabase/admin";

type TelegramUpdate = {
  message?: {
    chat?: {
      id?: number;
      type?: string;
    };
    from?: {
      username?: string;
    };
    text?: string;
  };
};

function hasMatchingSecret(actual: string | null, expected: string): boolean {
  if (!actual) {
    return false;
  }

  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    return (data[0] as Record<string, unknown> | undefined) ?? null;
  }

  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

async function sendBotMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await createTelegramClient({ token }).sendMessage({ chatId, text });
  } catch (error) {
    console.error("Telegram webhook reply failed.", error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = parseServerEnv();
  const secret = request.headers.get("x-telegram-bot-api-secret-token");

  if (!hasMatchingSecret(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "WEBHOOK_UNAUTHORIZED" }, { status: 401 });
  }

  let update: TelegramUpdate;

  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "INVALID_TELEGRAM_UPDATE" }, { status: 400 });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  const text = message?.text?.trim();

  if (!message || typeof chatId !== "number" || chatType !== "private" || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const helpText =
    "Watch Anything manages Radars on the website. Use /start from your personal binding link, then manage your Radars in the app.";

  if (/^\/help(?:@\w+)?$/iu.test(text)) {
    await sendBotMessage(env.TELEGRAM_BOT_TOKEN, chatId, helpText);
    return NextResponse.json({ ok: true });
  }

  const startMatch = text.match(/^\/start(?:@\w+)?\s+(\S+)$/iu);

  if (!startMatch) {
    await sendBotMessage(env.TELEGRAM_BOT_TOKEN, chatId, helpText);
    return NextResponse.json({ ok: true });
  }

  const rawToken = startMatch[1];
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_telegram_binding_token", {
    p_token_hash: hashBindingToken(rawToken),
    p_chat_id: chatId,
    p_username: message.from?.username ?? null,
  });

  if (error) {
    console.error("Telegram binding token consumption failed.", error);
    return NextResponse.json({ error: "TELEGRAM_BINDING_FAILED" }, { status: 500 });
  }

  const result = firstRpcRow(data);
  const errorCode = typeof result?.error_code === "string" ? result.error_code : null;

  if (errorCode || !result?.user_id) {
    await sendBotMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "This binding link is invalid or expired. Please create a new link in Watch Anything.",
    );
    return NextResponse.json(
      { error: errorCode ?? "BINDING_TOKEN_INVALID" },
      { status: 400 },
    );
  }

  await sendBotMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    "Telegram is connected. Return to Watch Anything to activate your Radar.",
  );
  return NextResponse.json({ ok: true, connected: true });
}

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
