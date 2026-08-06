import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { parseRules } from "@/lib/ai/parse-rules";
import { createClient as createAdminClient } from "@/lib/supabase/admin";
import {
  hashGuestIdentity,
  signGuestCookie,
  signRuleToken,
  verifyGuestCookie,
} from "@/lib/security/rule-token";
import { ruleParseRequestSchema } from "@/lib/validation/radar-rules";

const GUEST_ID_COOKIE = "wa_guest_id";
const GUEST_ID_MAX_AGE = 60 * 60 * 24 * 30;

function getTrustedClientIp(request: NextRequest): string | undefined {
  const vercelForwardedIp = request.headers
    .get("x-vercel-forwarded-for")
    ?.split(",")[0]
    ?.trim();

  if (vercelForwardedIp) {
    return vercelForwardedIp;
  }

  if (process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production") {
    return undefined;
  }

  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    undefined
  );
}

function getGuestIdentity(request: NextRequest): {
  guestId: string;
  guestCookie: string;
  identityHash: string;
} {
  const cookieValue = request.cookies.get(GUEST_ID_COOKIE)?.value;
  let guestId: string;

  try {
    guestId = cookieValue ? verifyGuestCookie(cookieValue) : randomUUID();
  } catch {
    guestId = randomUUID();
  }

  return {
    guestId,
    guestCookie: signGuestCookie(guestId),
    identityHash: hashGuestIdentity(guestId, getTrustedClientIp(request)),
  };
}

function withGuestCookie(
  body: unknown,
  status: number,
  guestCookie: string,
): NextResponse {
  const response = NextResponse.json(body, { status });

  response.cookies.set({
    name: GUEST_ID_COOKIE,
    value: guestCookie,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: GUEST_ID_MAX_AGE,
    path: "/",
  });

  return response;
}

async function claimGuestAiRequest(
  admin: ReturnType<typeof createAdminClient>,
  identityHash: string,
): Promise<{ allowed: boolean }> {
  const { data, error } = await admin.rpc("claim_guest_ai_request", {
    p_identity_hash: identityHash,
  });

  if (error) {
    console.error("Guest rule request quota claim failed.", error);
    throw new Error("RATE_LIMIT_STORAGE_UNAVAILABLE");
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || typeof row !== "object" || typeof row.allowed !== "boolean") {
    console.error("Guest rule request quota claim returned an invalid result.");
    throw new Error("RATE_LIMIT_STORAGE_UNAVAILABLE");
  }

  return { allowed: row.allowed };
}

async function releaseGuestAiRequest(
  admin: ReturnType<typeof createAdminClient>,
  identityHash: string,
): Promise<void> {
  const releaseResult = await admin.rpc("release_guest_ai_request", {
    p_identity_hash: identityHash,
  });

  if (!releaseResult.error) {
    return;
  }

  // Keep Retry usable before the release migration is deployed. The direct
  // fallback removes only the newest reservation for this guest identity.
  console.error("Guest rule request quota release RPC failed.", releaseResult.error);
  const latestClaim = await admin
    .from("guest_ai_requests")
    .select("id")
    .eq("identity_hash", identityHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestClaim.error || !latestClaim.data?.id) {
    console.error("Guest rule request quota release fallback failed.", latestClaim.error);
    return;
  }

  const deleteResult = await admin
    .from("guest_ai_requests")
    .delete()
    .eq("id", latestClaim.data.id);

  if (deleteResult.error) {
    console.error("Guest rule request quota reservation could not be released.", deleteResult.error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let guestIdentity: ReturnType<typeof getGuestIdentity>;

  try {
    guestIdentity = getGuestIdentity(request);
  } catch (error) {
    console.error("Guest identity could not be established.", error);
    return NextResponse.json({ error: "RATE_LIMIT_STORAGE_UNAVAILABLE" }, { status: 503 });
  }

  let parsedBody: unknown;

  try {
    parsedBody = await request.json();
  } catch {
    return withGuestCookie({ error: "INVALID_RULE_REQUEST" }, 400, guestIdentity.guestCookie);
  }

  const parsedRequest = ruleParseRequestSchema.safeParse(parsedBody);

  if (!parsedRequest.success) {
    return withGuestCookie({ error: "INVALID_RULE_REQUEST" }, 400, guestIdentity.guestCookie);
  }

  let admin: ReturnType<typeof createAdminClient>;
  let quotaClaimed = false;

  try {
    admin = createAdminClient();
    const claim = await claimGuestAiRequest(admin, guestIdentity.identityHash);

    if (!claim.allowed) {
      return withGuestCookie({ error: "RATE_LIMITED" }, 429, guestIdentity.guestCookie);
    }

    quotaClaimed = true;
  } catch (error) {
    console.error("Guest rule request quota claim failed.", error);
    return withGuestCookie(
      { error: "RATE_LIMIT_STORAGE_UNAVAILABLE" },
      503,
      guestIdentity.guestCookie,
    );
  }

  try {
    const rules = await parseRules({ prompt: parsedRequest.data.prompt });
    const ruleToken = signRuleToken(rules);

    return withGuestCookie(
      { rules, ruleToken },
      200,
      guestIdentity.guestCookie,
    );
  } catch (error) {
    console.error("Rule parsing failed.", error);
    if (quotaClaimed) {
      await releaseGuestAiRequest(admin, guestIdentity.identityHash);
    }
    return withGuestCookie(
      { error: "RULE_PARSE_FAILED" },
      502,
      guestIdentity.guestCookie,
    );
  }
}
