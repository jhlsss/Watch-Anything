import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { parseRules } from "@/lib/ai/parse-rules";
import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { signRuleToken } from "@/lib/security/rule-token";
import { ruleParseRequestSchema } from "@/lib/validation/radar-rules";

const GUEST_ID_COOKIE = "wa_guest_id";
const GUEST_ID_MAX_AGE = 60 * 60 * 24 * 30;
const DAILY_IDENTITY_LIMIT = 3;
const DAILY_GLOBAL_LIMIT = 20;

function getGuestIdentity(request: NextRequest): { guestId: string; identityHash: string } {
  const cookieValue = request.cookies.get(GUEST_ID_COOKIE)?.value;
  const guestId = cookieValue && cookieValue.length <= 128 ? cookieValue : randomUUID();
  const forwardedIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedIp || request.headers.get("x-real-ip") || "unknown";
  const identityHash = createHash("sha256")
    .update(`${guestId}:${ip}`, "utf8")
    .digest("hex");

  return { guestId, identityHash };
}

function startOfUtcDay(): string {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
}

function withGuestCookie(
  body: unknown,
  status: number,
  guestId: string,
): NextResponse {
  const response = NextResponse.json(body, { status });

  response.cookies.set({
    name: GUEST_ID_COOKIE,
    value: guestId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GUEST_ID_MAX_AGE,
    path: "/",
  });

  return response;
}

async function countRequests(
  admin: ReturnType<typeof createAdminClient>,
  start: string,
  identityHash?: string,
): Promise<number> {
  let query = admin
    .from("guest_ai_requests")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start);

  if (identityHash) {
    query = query.eq("identity_hash", identityHash);
  }

  const { count, error } = await query;

  if (error) {
    console.error("Guest rule request rate-limit lookup failed.", error);
    throw new Error("RATE_LIMIT_STORAGE_UNAVAILABLE");
  }

  return count ?? 0;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { guestId, identityHash } = getGuestIdentity(request);
  let parsedBody: unknown;

  try {
    parsedBody = await request.json();
  } catch {
    return withGuestCookie({ error: "INVALID_RULE_REQUEST" }, 400, guestId);
  }

  const parsedRequest = ruleParseRequestSchema.safeParse(parsedBody);

  if (!parsedRequest.success) {
    return withGuestCookie({ error: "INVALID_RULE_REQUEST" }, 400, guestId);
  }

  try {
    const admin = createAdminClient();
    const start = startOfUtcDay();
    const identityCount = await countRequests(admin, start, identityHash);
    const globalCount = await countRequests(admin, start);

    if (identityCount >= DAILY_IDENTITY_LIMIT || globalCount >= DAILY_GLOBAL_LIMIT) {
      return withGuestCookie({ error: "RATE_LIMITED" }, 429, guestId);
    }

    const { error: insertError } = await admin.from("guest_ai_requests").insert({
      identity_hash: identityHash,
    });

    if (insertError) {
      console.error("Guest rule request rate-limit write failed.", insertError);
      return withGuestCookie({ error: "RATE_LIMIT_STORAGE_UNAVAILABLE" }, 503, guestId);
    }

    const rules = await parseRules({ prompt: parsedRequest.data.prompt });
    const ruleToken = signRuleToken(rules);

    return withGuestCookie({ rules, ruleToken }, 200, guestId);
  } catch (error) {
    console.error("Rule parsing failed.", error);
    return withGuestCookie({ error: "RULE_PARSE_FAILED" }, 502, guestId);
  }
}
