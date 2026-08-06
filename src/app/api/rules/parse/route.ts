import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { parseRules } from "@/lib/ai/parse-rules";
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
    return withGuestCookie(
      { error: "RULE_PARSE_FAILED" },
      502,
      guestIdentity.guestCookie,
    );
  }
}
