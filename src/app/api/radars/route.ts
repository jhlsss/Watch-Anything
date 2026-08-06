import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

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
  withMonitoringDeadline,
} from "@/lib/monitoring/run-radar";
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

  const publicRadars = Array.isArray(result.data)
    ? result.data.map((row) =>
        toPublicRadar(row as Record<string, unknown>),
      )
    : [];

  return NextResponse.json({ radars: publicRadars });
}

export async function POST(request: Request) {
  const outerDeadlineAt = Date.now() + MONITORING_ROUTE_BUDGET_MS;
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const cookieStore = await cookies();
  let input: unknown = null;
  try {
    input = await request.json();
  } catch {
    // The activation page can rely on the HttpOnly setup cookie and submit an
    // empty body. A malformed or absent body is therefore resolved from the
    // cookie below instead of exposing the setup id to browser JavaScript.
  }

  const bodySetupId =
    input && typeof input === "object" && "setupId" in input
      ? (input as { setupId?: unknown }).setupId
      : undefined;
  const parsed = setupIdSchema.safeParse({
    setupId: bodySetupId ?? cookieStore.get("wa_setup")?.value,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const db = getMonitoringClient(
    createAdminClient() as unknown as Parameters<typeof getMonitoringClient>[0],
  );

  let createdRadar: Awaited<ReturnType<typeof createRadarFromSetup>> | null = null;
  try {
    createdRadar = await withMonitoringDeadline(
      (signal) =>
        createRadarFromSetup(
          parsed.data.setupId,
          user.id,
          outerDeadlineAt,
          db,
          signal,
        ),
      outerDeadlineAt,
    );
    cookieStore.delete("wa_setup");
    try {
      const run = await runRadar(createdRadar.id, "baseline", {
        client: db,
        outerDeadlineAt,
      });

      return NextResponse.json(
        {
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
          radar: toPublicRadar(createdRadar as unknown as Record<string, unknown>),
          run: null,
          error: baselineError,
          baselineError,
        },
        { status: 500 },
      );
    }
  } catch (error) {
    return errorResponse(error);
  }
}
