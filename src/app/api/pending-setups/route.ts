import { NextResponse } from "next/server";

import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { hashRuleToken, verifyRuleToken } from "@/lib/security/rule-token";
import {
  pendingSetupRequestSchema,
  radarRulesSchema,
  type RadarRulesInput,
} from "@/lib/validation/radar-rules";

const SETUP_COOKIE = "wa_setup";
const SETUP_MAX_AGE = 60 * 60 * 24;
type PendingSetupAdmin = ReturnType<typeof createAdminClient>;

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

type PendingSetupInput = {
  admin: PendingSetupAdmin;
  userId: string;
  originalPrompt: string;
  rules: RadarRulesInput;
  ruleTokenHash: string;
  expiresAt: string;
};

async function findActivePendingSetup(
  admin: PendingSetupAdmin,
  userId: string,
  ruleTokenHash: string,
) {
  const { data, error } = await admin
    .from("pending_radar_setups")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("rule_token_hash", ruleTokenHash)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("Pending setup lookup failed.", error);
    throw new Error("PENDING_SETUP_LOOKUP_FAILED");
  }

  return data;
}

export async function getOrCreatePendingSetup({
  admin,
  userId,
  originalPrompt,
  rules,
  ruleTokenHash,
  expiresAt,
}: PendingSetupInput): Promise<{ id: string }> {
  const existing = await findActivePendingSetup(admin, userId, ruleTokenHash);

  if (existing) {
    return { id: existing.id };
  }

  const { data, error } = await admin
    .from("pending_radar_setups")
    .insert({
      user_id: userId,
      original_prompt: originalPrompt,
      radar_name: rules.radarName,
      rules,
      rule_token_hash: ruleTokenHash,
      status: "pending",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (!error && data) {
    return { id: data.id };
  }

  if (error?.code === "23505") {
    const concurrentSetup = await findActivePendingSetup(admin, userId, ruleTokenHash);

    if (concurrentSetup) {
      return { id: concurrentSetup.id };
    }
  }

  console.error("Pending setup creation failed.", error);
  throw new Error("PENDING_SETUP_FAILED");
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
  let setup: { id: string };

  try {
    setup = await getOrCreatePendingSetup({
      admin,
      userId: user.id,
      originalPrompt: parsedInput.data.originalPrompt,
      rules: rulesResult.data,
      ruleTokenHash: hashRuleToken(parsedInput.data.ruleToken),
      expiresAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PENDING_SETUP_LOOKUP_FAILED") {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    console.error("Pending setup creation failed.", error);
    return NextResponse.json({ error: "PENDING_SETUP_FAILED" }, { status: 500 });
  }

  const response = NextResponse.json({ next: "connect-telegram" });
  response.cookies.set(SETUP_COOKIE, setup.id, setupCookieOptions());
  return response;
}
