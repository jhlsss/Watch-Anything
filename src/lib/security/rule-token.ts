import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  radarRulesSchema,
  type RadarRulesInput,
} from "@/lib/validation/radar-rules";

const RULE_TOKEN_VERSION = 1 as const;
const RULE_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;

const tokenPayloadSchema = z
  .object({
    version: z.literal(RULE_TOKEN_VERSION),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    rules: radarRulesSchema,
  })
  .strict();

function getRuleTokenSecret(): string {
  const secret = process.env.RULE_TOKEN_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("MISSING_RULE_TOKEN_SECRET");
  }

  return secret;
}

function encodePayload(payload: z.infer<typeof tokenPayloadSchema>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getRuleTokenSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function invalidToken(): never {
  throw new Error("INVALID_RULE_TOKEN");
}

export function signRuleToken(rules: RadarRulesInput, now = Date.now()): string {
  const parsedRules = radarRulesSchema.safeParse(rules);

  if (!parsedRules.success) {
    throw new Error("INVALID_RULES");
  }

  const payload = {
    version: RULE_TOKEN_VERSION,
    issuedAt: now,
    expiresAt: now + RULE_TOKEN_TTL_MS,
    rules: parsedRules.data,
  } satisfies z.infer<typeof tokenPayloadSchema>;
  const encodedPayload = encodePayload(payload);

  return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifyRuleToken(token: string, now = Date.now()): RadarRulesInput {
  if (typeof token !== "string") {
    return invalidToken();
  }

  const parts = token.split(".");

  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return invalidToken();
  }

  const [encodedPayload, encodedSignature] = parts;
  const expectedSignature = signPayload(encodedPayload);
  const actualSignatureBuffer = Buffer.from(encodedSignature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
  ) {
    return invalidToken();
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    return invalidToken();
  }

  const payloadResult = tokenPayloadSchema.safeParse(parsedPayload);

  if (!payloadResult.success) {
    return invalidToken();
  }

  if (
    payloadResult.data.expiresAt - payloadResult.data.issuedAt !== RULE_TOKEN_TTL_MS ||
    payloadResult.data.issuedAt > now
  ) {
    return invalidToken();
  }

  if (now >= payloadResult.data.expiresAt) {
    throw new Error("EXPIRED_RULE_TOKEN");
  }

  return payloadResult.data.rules;
}

export const RULE_TOKEN_TTL = RULE_TOKEN_TTL_MS;
