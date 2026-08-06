import { createHash, randomBytes } from "node:crypto";

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
