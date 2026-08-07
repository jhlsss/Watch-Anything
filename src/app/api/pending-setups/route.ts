import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  createRadarFromSetup,
  getMonitoringClient,
  MonitoringError,
  toPublicRadar,
  toPublicRunResult,
} from "@/lib/monitoring/create-radar";
import {
  MONITORING_ROUTE_BUDGET_MS,
  runRadar,
} from "@/lib/monitoring/run-radar";
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

export const maxDuration = 60;

function setupCookieOptions() {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: SETUP_MAX_AGE,
    path: "/",
  };
}

function activationErrorResponse(error: unknown): NextResponse {
  const code = error instanceof MonitoringError ? error.code : "RADAR_REQUEST_FAILED";
  const status =
    code === "ACTIVE_RADAR_LIMIT_REACHED"
      ? 409
      : code === "TELEGRAM_NOT_CONNECTED" || code === "SETUP_NOT_AVAILABLE"
        ? 400
        : code === "CREATE_DEADLINE_EXCEEDED"
          ? 504
          : 500;

  return NextResponse.json({ error: code }, { status });
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

async function findConsumedPendingSetup(
  admin: PendingSetupAdmin,
  userId: string,
  ruleTokenHash: string,
) {
  const { data, error } = await admin
    .from("pending_radar_setups")
    .select("id, status, radar_id")
    .eq("user_id", userId)
    .eq("rule_token_hash", ruleTokenHash)
    .eq("status", "consumed")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Consumed pending setup lookup failed.", error);
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
}: PendingSetupInput): Promise<{ id: string; radarId?: string }> {
  const consumed = await findConsumedPendingSetup(admin, userId, ruleTokenHash);

  if (consumed?.radar_id) {
    return { id: consumed.id, radarId: consumed.radar_id };
  }

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
  let setup: { id: string; radarId?: string };

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

  if (setup.radarId) {
    const existingRadar = await admin
      .from("radars")
      .select(
        "id,user_id,name,original_prompt,rules,status,interval_minutes,baseline_cutoff_at,last_checked_at,next_check_at,created_at,updated_at",
      )
      .eq("id", setup.radarId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingRadar.error || !existingRadar.data) {
      console.error("Consumed setup Radar lookup failed.", existingRadar.error);
      return NextResponse.json({ error: "RADAR_NOT_FOUND" }, { status: 500 });
    }

    const cookieStore = await cookies();
    cookieStore.delete(SETUP_COOKIE);

    return NextResponse.json(
      {
        next: "radar",
        radarId: setup.radarId,
        radar: toPublicRadar(existingRadar.data as Record<string, unknown>),
        run: null,
      },
      { status: 200 },
    );
  }

  const connection = await admin
    .from("telegram_connections")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (connection.error) {
    console.error("Telegram connection lookup failed.", connection.error);
    return NextResponse.json({ error: "TELEGRAM_STATUS_FAILED" }, { status: 503 });
  }

  if (connection.data) {
    const outerDeadlineAt = Date.now() + MONITORING_ROUTE_BUDGET_MS;
    const db = getMonitoringClient(
      admin as unknown as Parameters<typeof getMonitoringClient>[0],
    );
    let createdRadar: Awaited<ReturnType<typeof createRadarFromSetup>>;

    try {
      createdRadar = await createRadarFromSetup(
        setup.id,
        user.id,
        outerDeadlineAt,
        db,
      );
    } catch (error) {
      return activationErrorResponse(error);
    }

    const cookieStore = await cookies();
    cookieStore.delete(SETUP_COOKIE);

    try {
      const run = await runRadar(createdRadar.id, "baseline", {
        client: db,
        outerDeadlineAt,
      });

      return NextResponse.json(
        {
          next: "radar",
          radarId: createdRadar.id,
          radar: toPublicRadar(createdRadar as unknown as Record<string, unknown>),
          run: toPublicRunResult(run),
        },
        { status: 201 },
      );
    } catch (error) {
      const baselineError =
        error instanceof MonitoringError ? error.code : "BASELINE_FAILED";

      return NextResponse.json(
        {
          next: "radar",
          radarId: createdRadar.id,
          radar: toPublicRadar(createdRadar as unknown as Record<string, unknown>),
          run: null,
          error: baselineError,
          baselineError,
        },
        { status: 201 },
      );
    }
  }

  const response = NextResponse.json({ next: "connect-telegram" });
  response.cookies.set(SETUP_COOKIE, setup.id, setupCookieOptions());
  return response;
}
