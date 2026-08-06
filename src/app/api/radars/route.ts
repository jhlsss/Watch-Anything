import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createRadarFromSetup,
  getMonitoringClient,
  MonitoringError,
} from "@/lib/monitoring/create-radar";
import { runRadar } from "@/lib/monitoring/run-radar";
import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const setupIdSchema = z.object({
  setupId: z.uuid(),
});

function errorResponse(error: unknown): NextResponse {
  const code =
    error instanceof MonitoringError ? error.code : "RADAR_REQUEST_FAILED";
  const status =
    code === "ACTIVE_RADAR_LIMIT_REACHED"
      ? 409
      : code === "TELEGRAM_NOT_CONNECTED" || code === "SETUP_NOT_AVAILABLE"
        ? 400
        : 500;

  return NextResponse.json({ error: code }, { status });
}

async function getAuthenticatedUser() {
  const sessionClient = await createSessionClient();
  const {
    data: { user },
    error,
  } = await sessionClient.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const db = getMonitoringClient(
    createAdminClient() as unknown as Parameters<typeof getMonitoringClient>[0],
  );
  const result = await db
    .from("radars")
    .select(
      "id,user_id,name,original_prompt,rules,status,interval_minutes,baseline_cutoff_at,last_checked_at,next_check_at,created_at,updated_at",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (result.error) {
    return NextResponse.json({ error: "DATABASE_ERROR" }, { status: 500 });
  }

  return NextResponse.json({ radars: result.data ?? [] });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = setupIdSchema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const db = getMonitoringClient(
    createAdminClient() as unknown as Parameters<typeof getMonitoringClient>[0],
  );

  try {
    const radar = await createRadarFromSetup(parsed.data.setupId, user.id, db);
    const run = await runRadar(radar.id, "baseline", { client: db });
    const cookieStore = await cookies();
    cookieStore.delete("wa_setup");

    return NextResponse.json({ radar, run }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
