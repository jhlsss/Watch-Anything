import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { parseServerEnv } from "@/lib/env";
import { runRadar } from "@/lib/monitoring/run-radar";
import { createClient as createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

function hasMatchingSecret(actual: string | null, expected: string): boolean {
  if (!actual?.startsWith("Bearer ")) {
    return false;
  }

  const actualSecret = actual.slice("Bearer ".length);
  const actualBuffer = Buffer.from(actualSecret, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const env = parseServerEnv();

  if (!hasMatchingSecret(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "CRON_UNAUTHORIZED" }, { status: 401 });
  }

  const admin = createAdminClient();
  const dueRadar = await admin
    .from("radars")
    .select("id")
    .eq("status", "active")
    .lte("next_check_at", new Date().toISOString())
    .order("next_check_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (dueRadar.error) {
    console.error("Due Radar lookup failed.", dueRadar.error);
    return NextResponse.json({ error: "CRON_LOOKUP_FAILED" }, { status: 500 });
  }

  if (!dueRadar.data || typeof dueRadar.data.id !== "string") {
    return NextResponse.json({ processed: 0 });
  }

  try {
    const run = await runRadar(dueRadar.data.id, "schedule", {
      client: admin as never,
    });

    return NextResponse.json({
      processed: 1,
      radarId: dueRadar.data.id,
      run: {
        runId: run.runId,
        status: run.status,
      },
    });
  } catch (error) {
    console.error("Due Radar run failed.", error);
    return NextResponse.json({ error: "CRON_RUN_FAILED" }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
