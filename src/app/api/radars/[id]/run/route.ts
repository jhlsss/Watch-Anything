import { NextResponse } from "next/server";

import { getMonitoringClient, MonitoringError } from "@/lib/monitoring/create-radar";
import { isMvpManualRunBypassUser } from "@/lib/monitoring/manual-run-policy";
import {
  MONITORING_ROUTE_BUDGET_MS,
  runRadar,
} from "@/lib/monitoring/run-radar";
import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function runErrorResponse(error: unknown): NextResponse {
  if (error instanceof MonitoringError) {
    const rateLimited =
      error.code === "MANUAL_CHECK_COOLDOWN" ||
      error.code === "MANUAL_DAILY_LIMIT_REACHED";
    const conflict =
      error.code === "RADAR_ALREADY_LEASED" || error.code === "RADAR_NOT_ACTIVE";
    return NextResponse.json(
      { error: error.code },
      { status: rateLimited ? 429 : conflict ? 409 : error.code === "RADAR_NOT_FOUND" ? 404 : 500 },
    );
  }

  return NextResponse.json({ error: "RUN_FAILED" }, { status: 500 });
}

export async function POST(_request: Request, { params }: RouteContext) {
  const outerDeadlineAt = Date.now() + MONITORING_ROUTE_BUDGET_MS;
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "RADAR_NOT_FOUND" }, { status: 404 });
  }

  const sessionClient = await createSessionClient();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const ownership = await sessionClient
    .from("radars")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (ownership.error || !ownership.data) {
    return NextResponse.json({ error: "RADAR_NOT_FOUND" }, { status: 404 });
  }

  const db = getMonitoringClient(
    createAdminClient() as unknown as Parameters<typeof getMonitoringClient>[0],
  );
  try {
    const run = await runRadar(id, "manual", {
      client: db,
      bypassManualLimits: isMvpManualRunBypassUser(user.id),
      outerDeadlineAt,
    });
    return NextResponse.json({ run });
  } catch (error) {
    return runErrorResponse(error);
  }
}
