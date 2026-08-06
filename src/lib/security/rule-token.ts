import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  radarRulesSchema,
  type RadarRulesInput,
} from "@/lib/validation/radar-rules";

const RULE_TOKEN_VERSION = 1 as const;
const RULE_TOKEN_TTL_MS = 2 * 60 * 60 * 1_000;
const GUEST_COOKIE_VERSION = 1 as const;
const GUEST_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const tokenPayloadSchema = z
  .object({
    version: z.literal(RULE_TOKEN_VERSION),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    rules: radarRulesSchema,
  })
  .strict();

const guestCookiePayloadSchema = z
  .object({
    version: z.literal(GUEST_COOKIE_VERSION),
    guestId: z.string().min(1).max(128),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
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

function signGuestPayload(encodedPayload: string): string {
  return createHmac("sha256", getRuleTokenSecret())
    .update(`guest-cookie.${encodedPayload}`)
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

export function signGuestCookie(guestId: string, now = Date.now()): string {
  if (!guestCookiePayloadSchema.shape.guestId.safeParse(guestId).success) {
    throw new Error("INVALID_GUEST_ID");
  }

  const payload = {
    version: GUEST_COOKIE_VERSION,
    guestId,
    issuedAt: now,
    expiresAt: now + GUEST_COOKIE_TTL_MS,
  } satisfies z.infer<typeof guestCookiePayloadSchema>;
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `g1.${encodedPayload}.${signGuestPayload(encodedPayload)}`;
}

export function verifyGuestCookie(cookie: string, now = Date.now()): string {
  if (typeof cookie !== "string") {
    throw new Error("INVALID_GUEST_COOKIE");
  }

  const parts = cookie.split(".");

  if (parts.length !== 3 || parts[0] !== "g1" || !parts[1] || !parts[2]) {
    throw new Error("INVALID_GUEST_COOKIE");
  }

  const [, encodedPayload, encodedSignature] = parts;
  const expectedSignature = signGuestPayload(encodedPayload);
  const actualSignatureBuffer = Buffer.from(encodedSignature, "base64url");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "base64url");

  if (
    actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error("INVALID_GUEST_COOKIE");
  }

  let parsedPayload: unknown;

  try {
    parsedPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_GUEST_COOKIE");
  }

  const payloadResult = guestCookiePayloadSchema.safeParse(parsedPayload);

  if (
    !payloadResult.success ||
    payloadResult.data.expiresAt - payloadResult.data.issuedAt !== GUEST_COOKIE_TTL_MS ||
    payloadResult.data.issuedAt > now
  ) {
    throw new Error("INVALID_GUEST_COOKIE");
  }

  if (now >= payloadResult.data.expiresAt) {
    throw new Error("EXPIRED_GUEST_COOKIE");
  }

  return payloadResult.data.guestId;
}

export function hashGuestIdentity(guestId: string, trustedIp?: string): string {
  const normalizedIp = trustedIp?.trim();
  const identity = normalizedIp ? `ip:${normalizedIp}` : `guest:${guestId}`;

  return createHash("sha256").update(identity, "utf8").digest("hex");
}

export function hashRuleToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const RULE_TOKEN_TTL = RULE_TOKEN_TTL_MS;
export const GUEST_COOKIE_TTL = GUEST_COOKIE_TTL_MS;
