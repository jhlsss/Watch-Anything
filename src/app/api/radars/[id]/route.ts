import { NextResponse } from "next/server";

import {
  firstRpcRow,
  getMonitoringClient,
  MonitoringError,
} from "@/lib/monitoring/create-radar";
import {
  parseRadarUpdate,
  type NormalizedRadarUpdate,
} from "@/lib/validation/radar-update";
import { createClient as createAdminClient } from "@/lib/supabase/admin";
import { createClient as createSessionClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function invalidId(id: string): boolean {
  return !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    id,
  );
}

async function getUserAndOwnedRadarId(id: string) {
  if (invalidId(id)) {
    return { user: null, owned: false, invalid: true };
  }

  const sessionClient = await createSessionClient();
  const {
    data: { user },
    error: authError,
  } = await sessionClient.auth.getUser();

  if (authError || !user) {
    return { user: null, owned: false, invalid: false };
  }

  const ownership = await sessionClient
    .from("radars")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    user,
    owned: !ownership.error && Boolean(ownership.data),
    invalid: false,
  };
}

function authOrOwnershipResponse(
  state: Awaited<ReturnType<typeof getUserAndOwnedRadarId>>,
): NextResponse | null {
  if (state.invalid) {
    return NextResponse.json({ error: "RADAR_NOT_FOUND" }, { status: 404 });
  }
  if (!state.user) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  if (!state.owned) {
    return NextResponse.json({ error: "RADAR_NOT_FOUND" }, { status: 404 });
  }
  return null;
}

function updateErrorResponse(error: unknown): NextResponse {
  if (error instanceof MonitoringError) {
    const status =
      error.code === "ACTIVE_RADAR_LIMIT_REACHED"
        ? 409
        : error.code === "RADAR_NOT_FOUND"
          ? 404
          : 400;
    return NextResponse.json({ error: error.code }, { status });
  }

  return NextResponse.json({ error: "INVALID_RADAR_UPDATE" }, { status: 400 });
}

async function parseBody(request: Request): Promise<NormalizedRadarUpdate> {
  return parseRadarUpdate(await request.json());
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const state = await getUserAndOwnedRadarId(id);
  const authResponse = authOrOwnershipResponse(state);
  if (authResponse) {
    return authResponse;
  }

  const db = getMonitoringClient(
    createAdminClient() as unknown as Parameters<typeof getMonitoringClient>[0],
  );
  const [radarResult, findingsResult, runsResult] = await Promise.all([
    db.from("radars").select("*").eq("id", id).eq("user_id", state.user!.id).maybeSingle(),
    db.from("findings").select("*").eq("radar_id", id).order("last_seen_at", { ascending: false }),
    db.from("radar_runs").select("*").eq("radar_id", id).order("started_at", { ascending: false }),
  ]);

  if (radarResult.error || findingsResult.error || runsResult.error || !radarResult.data) {
    return NextResponse.json({ error: "DATABASE_ERROR" }, { status: 500 });
  }

  return NextResponse.json({
    radar: radarResult.data,
    findings: findingsResult.data ?? [],
    runs: runsResult.data ?? [],
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const state = await getUserAndOwnedRadarId(id);
  const authResponse = authOrOwnershipResponse(state);
  if (authResponse) {
    return authResponse;
  }

  let update: NormalizedRadarUpdate;
  try {
    update = await parseBody(request);
  } catch {
    return NextResponse.json({ error: "INVALID_RADAR_UPDATE" }, { status: 400 });
  }

  const db = getMonitoringClient(
    createAdminClient() as unknown as Parameters<typeof getMonitoringClient>[0],
  );

  if (update.action === "pause" || update.action === "resume") {
    const result = await db.rpc("set_radar_status", {
      p_radar_id: id,
      p_user_id: state.user!.id,
      p_next_status: update.action === "pause" ? "paused" : "active",
    });
    if (result.error) {
      return NextResponse.json({ error: "DATABASE_ERROR" }, { status: 500 });
    }

    const statusResult = firstRpcRow<{
      radar_id: string;
      status: string | null;
      error_code: string | null;
    }>(result.data);
    if (statusResult?.error_code) {
      const status =
        statusResult.error_code === "ACTIVE_RADAR_LIMIT_REACHED" ? 409 : 404;
      return NextResponse.json(
        { error: statusResult.error_code },
        { status },
      );
    }

    return NextResponse.json({
      radarId: id,
      status: statusResult?.status ?? (update.action === "pause" ? "paused" : "active"),
    });
  }

  try {
    const current = await db
      .from("radars")
      .select("rules")
      .eq("id", id)
      .eq("user_id", state.user!.id)
      .maybeSingle();
    if (current.error || !current.data) {
      return NextResponse.json({ error: "RADAR_NOT_FOUND" }, { status: 404 });
    }

    const currentRecord = current.data as { rules?: unknown };
    const currentRules =
      currentRecord.rules && typeof currentRecord.rules === "object"
        ? (currentRecord.rules as Record<string, unknown>)
        : {};
    const updatedRules = {
      ...currentRules,
      radarName: update.radarName,
      includeTopics: update.includeTopics,
      excludeTopics: update.excludeTopics,
      intervalMinutes: 360,
    };
    const updated = await db
      .from("radars")
      .update({ name: update.radarName, rules: updatedRules })
      .eq("id", id)
      .eq("user_id", state.user!.id)
      .select("*")
      .single();
    if (updated.error || !updated.data) {
      return NextResponse.json({ error: "DATABASE_ERROR" }, { status: 500 });
    }

    return NextResponse.json({ radar: updated.data });
  } catch (error) {
    return updateErrorResponse(error);
  }
}
