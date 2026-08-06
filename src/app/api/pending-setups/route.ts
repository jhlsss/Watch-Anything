import { NextResponse } from "next/server";

import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { verifyRuleToken } from "@/lib/security/rule-token";
import {
  pendingSetupRequestSchema,
  radarRulesSchema,
} from "@/lib/validation/radar-rules";

const SETUP_COOKIE = "wa_setup";
const SETUP_MAX_AGE = 60 * 60 * 24;

function setupCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: SETUP_MAX_AGE,
    path: "/",
  };
}

async function getCurrentUser() {
  const client = await createServerClient();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "AUTH_REQUIRED" }, { status: 401 });
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_PENDING_SETUP" }, { status: 400 });
  }

  const parsedInput = pendingSetupRequestSchema.safeParse(input);

  if (!parsedInput.success) {
    return NextResponse.json({ error: "INVALID_PENDING_SETUP" }, { status: 400 });
  }

  let signedRules;

  try {
    signedRules = verifyRuleToken(parsedInput.data.ruleToken);
  } catch (error) {
    if (error instanceof Error && error.message === "EXPIRED_RULE_TOKEN") {
      return NextResponse.json({ error: "EXPIRED_RULE_TOKEN" }, { status: 400 });
    }

    if (error instanceof Error && error.message === "MISSING_RULE_TOKEN_SECRET") {
      console.error("Rule token secret is unavailable.");
      return NextResponse.json({ error: "RULE_TOKEN_UNAVAILABLE" }, { status: 503 });
    }

    return NextResponse.json({ error: "INVALID_RULE_TOKEN" }, { status: 400 });
  }

  const rulesResult = radarRulesSchema.safeParse({
    ...signedRules,
    ...parsedInput.data.editableDelta,
  });

  if (!rulesResult.success) {
    return NextResponse.json({ error: "INVALID_RULE_DELTA" }, { status: 400 });
  }

  const expiresAt = new Date(Date.now() + SETUP_MAX_AGE * 1_000).toISOString();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("pending_radar_setups")
    .insert({
      user_id: user.id,
      original_prompt: parsedInput.data.originalPrompt,
      radar_name: rulesResult.data.radarName,
      rules: rulesResult.data,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("Pending setup creation failed.", error);
    return NextResponse.json({ error: "PENDING_SETUP_FAILED" }, { status: 500 });
  }

  const response = NextResponse.json({ next: "connect-telegram" });
  response.cookies.set(SETUP_COOKIE, data.id, setupCookieOptions());
  return response;
}
