import { createHash, randomBytes } from "node:crypto";

import { createClient as createAdminClient } from "@/lib/supabase/admin";

export const BINDING_TOKEN_TTL_MS = 10 * 60 * 1_000;

export function hashBindingToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createBindingToken(now = new Date()): {
  token: string;
  tokenHash: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashBindingToken(token),
    expiresAt: new Date(now.getTime() + BINDING_TOKEN_TTL_MS).toISOString(),
  };
}

export type BindingTokenRpcClient = {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message: string; code?: string } | null;
  }>;
};

export type ConsumeBindingTokenOptions = {
  chatId: number;
  username?: string | null;
  client?: BindingTokenRpcClient;
};

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    return (data[0] as Record<string, unknown> | undefined) ?? null;
  }

  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export async function consumeBindingToken(
  rawToken: string,
  options: ConsumeBindingTokenOptions,
): Promise<{ userId: string }> {
  if (!rawToken.trim() || !Number.isSafeInteger(options.chatId)) {
    throw new Error("TOKEN_INVALID");
  }

  const client =
    options.client ?? (createAdminClient() as unknown as BindingTokenRpcClient);
  const result = await client.rpc("consume_telegram_binding_token", {
    p_token_hash: hashBindingToken(rawToken),
    p_chat_id: options.chatId,
    p_username: options.username?.trim() || null,
  });

  if (result.error) {
    throw new Error("BINDING_TOKEN_DATABASE_ERROR");
  }

  const row = firstRpcRow(result.data);
  const errorCode = typeof row?.error_code === "string" ? row.error_code : null;

  if (errorCode) {
    throw new Error(errorCode);
  }

  if (typeof row?.user_id !== "string" || !row.user_id) {
    throw new Error("TOKEN_INVALID");
  }

  return { userId: row.user_id };
}
