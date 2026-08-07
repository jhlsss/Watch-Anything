import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }
  return data ? (data as T) : null;
}

describe("monitoring migration contract", () => {
  it("removes the fixed Music News source with a forward migration", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/202608070010_remove_fixed_music_rss.sql",
    );

    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) {
      return;
    }

    const migration = readFileSync(migrationPath, "utf8")
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const setupStart = migration.indexOf(
      "create or replace function public.create_radar_from_setup",
    );
    const setupBody = migration.slice(
      setupStart,
      migration.indexOf("$$;", setupStart),
    );

    expect(setupStart).toBeGreaterThanOrEqual(0);
    expect(setupBody).toContain(
      "jsonb_build_object( 'tavily', jsonb_build_object('baselinecompletedat', null) )",
    );
    expect(setupBody).not.toContain("insert into public.radar_sources");
    expect(migration).toContain(
      "delete from public.findings as finding where finding.source_type = 'rss' and finding.source_domain in ('music-news.com', 'www.music-news.com')",
    );
    expect(migration).toContain(
      "delete from public.radar_sources as source where source.source_key = 'music_news_rss'",
    );
    expect(migration).toContain(
      "add constraint findings_no_fixed_music_news_rss check ( source_type <> 'rss' or lower(source_domain) not in ('music-news.com', 'www.music-news.com') )",
    );
  });

  it("allows eligible baseline findings to notify and restricts the MVP bypass RPC", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608070006_mvp_manual_bypass_and_baseline_notifications.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toContain(
      "create table if not exists public.mvp_manual_run_bypass_users",
    );
    expect(migration).toContain("bf2a2366-47b7-40ba-aed5-04410f787fff");
    expect(migration).toContain("a40b13f7-12d8-4b5a-a7d2-f2b55cc7e6cd");
    expect(migration).toMatch(
      /revoke all on table public\.mvp_manual_run_bypass_users from public, anon, authenticated/,
    );

    const persistStart = migration.indexOf(
      "create or replace function public.persist_run_finding",
    );
    const persistBody = migration.slice(persistStart, migration.indexOf("$$;", persistStart));
    expect(persistBody).toContain(
      "current_eligible := p_relevant and p_importance_score >= threshold",
    );
    expect(persistBody).not.toContain(
      "current_eligible := not first_seen and p_source_was_baselined",
    );

    const bypassStart = migration.indexOf(
      "create or replace function public.claim_radar_run_for_mvp_bypass",
    );
    const bypassBody = migration.slice(bypassStart, migration.indexOf("$$;", bypassStart));
    expect(bypassBody).toContain("p_trigger is distinct from 'manual'");
    expect(bypassBody).toContain("mvp_manual_run_bypass_users");
    expect(bypassBody).toContain("public.claim_radar_run");
    expect(bypassBody).toContain("'baseline'");
    expect(bypassBody).toContain("set trigger = 'manual'");
    expect(migration).toMatch(
      /grant execute on function public\.claim_radar_run_for_mvp_bypass\(uuid, uuid, text, uuid, timestamptz\) to service_role/,
    );
  });

  it("qualifies the MVP monitoring RPC columns in its forward migration", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608070008_fix_mvp_monitoring_rpc_ambiguity.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toContain("update public.radar_runs as run_update");
    expect(migration).toContain("run_update.lease_owner = claimed.lease_owner");
    expect(migration).toContain("run_update.radar_id = radar_id_for_run");
    expect(migration).not.toMatch(
      /set lease_expires_at = lease_expires_at\s+where id = p_run_id/u,
    );
    expect(migration).not.toMatch(
      /and lease_owner = p_lease_owner\s+and lease_expires_at/u,
    );
  });

  it("uses the run-findings constraint in the follow-up migration", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608070009_fix_mvp_persist_finding_conflict.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toContain(
      "on conflict on constraint run_findings_pkey do update",
    );
    expect(migration).not.toContain("on conflict (run_id, finding_id)");
  });

  it("uses fixed search paths and service-role-only RPC execution", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toMatch(
      /create or replace function public\.create_radar_from_setup\(.*security definer set search_path = public, pg_temp/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.claim_radar_run\(.*from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.claim_notification\(uuid\) to service_role/,
    );
    expect(migration).toMatch(
      /create or replace function public\.claim_guest_ai_request\([^)]*p_identity_hash text[^)]*\).*security definer set search_path = public, pg_temp/,
    );
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(migration).toMatch(
      /revoke all on function public\.claim_guest_ai_request\(text\) from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.claim_guest_ai_request\(text\) to service_role/,
    );
    expect(migration).toMatch(
      /alter table public\.pending_radar_setups add column if not exists rule_token_hash text/,
    );
    expect(migration).toMatch(
      /create unique index if not exists pending_radar_setups_pending_user_rule_token_hash_idx.*where status = 'pending' and rule_token_hash is not null/,
    );
    expect(migration).toMatch(
      /for stale_run in select .* from public\.radar_runs .*status = 'running'.*lease_expires_at <= clock_timestamp\(\).*for update/,
    );
    expect(migration).toContain("recovered_status := 'failed'");
    expect(migration).toContain(
      "next_check_at = clock_timestamp() + interval '15 minutes'",
    );
    expect(migration).toMatch(
      /update public\.radar_runs .*status = recovered_status.*finished_at = timezone\('utc', clock_timestamp\(\)\).*lease_owner = null.*lease_expires_at = null/,
    );
    expect(migration).toMatch(
      /where id = stale_run\.id.*status = 'running'.*lease_owner is not distinct from stale_run\.lease_owner/,
    );
    expect(migration).toMatch(
      /update public\.notifications .*status = 'unknown'.*status = 'sending'.*claimed_at/,
    );
    expect(migration).toMatch(
      /create or replace function public\.persist_run_finding\(.*p_run_id uuid.*p_lease_owner uuid/,
    );
    expect(migration).toMatch(
      /persist_run_finding.*for update.*status = 'running'.*lease_owner.*lease_expires_at > clock_timestamp\(\).*run_findings/,
    );
    expect(migration).toMatch(
      /create or replace function public\.create_pending_notification_for_run\(.*p_run_id uuid.*p_lease_owner uuid/,
    );
    expect(migration).toMatch(
      /create_pending_notification_for_run.*status = 'running'.*lease_owner.*lease_expires_at > clock_timestamp\(\).*notifications/,
    );
    expect(migration).toMatch(
      /create or replace function public\.mark_source_baseline_for_run\(.*p_run_id uuid.*p_lease_owner uuid/,
    );

    const claimFunctionStart = migration.indexOf(
      "create or replace function public.claim_radar_run",
    );
    const claimFunctionBody = migration.slice(
      claimFunctionStart,
      migration.indexOf("$$;", claimFunctionStart),
    );
    expect(claimFunctionBody).toContain("clock_timestamp()");
    expect(claimFunctionBody).not.toMatch(
      /lease_expires_at\s*(?:<=|>)\s*now\(\)/,
    );
    expect(claimFunctionBody).toContain(
      "p_lease_expires_at > clock_timestamp()",
    );
    expect(claimFunctionBody).toMatch(
      /if claimed_radar_id is null then[\s\S]*if p_lease_expires_at <= clock_timestamp\(\) then[\s\S]*'invalid_run_lease'/u,
    );
    expect(claimFunctionBody).toMatch(
      /update public\.notifications n .*set status = 'unknown'.*n\.radar_id = p_radar_id.*n\.status = 'sending'.*claimed_at/u,
    );
    expect(claimFunctionBody).toContain(
      "get diagnostics stale_notification_count = row_count",
    );
    for (const functionName of [
      "persist_run_source_outcomes",
      "finalize_run_for_owner",
      "recover_run_for_owner",
    ]) {
      expect(migration).toContain(
        `create or replace function public.${functionName}`,
      );
      expect(migration).toMatch(
        new RegExp(`revoke all on function public\\.${functionName}\\(`),
      );
      expect(migration).toMatch(
        new RegExp(`grant execute on function public\\.${functionName}\\(`),
      );
    }

    for (const functionName of [
      "persist_run_finding",
      "create_pending_notification_for_run",
      "mark_source_baseline_for_run",
    ]) {
      const functionStart = migration.indexOf(
        `create or replace function public.${functionName}`,
      );
      const functionBody = migration.slice(functionStart, migration.indexOf("$$;", functionStart));
      expect(functionBody).toContain("clock_timestamp()");
      expect(functionBody).not.toContain("lease_expires_at > now()");
      expect(functionBody).toMatch(
        /update public\.radar_runs .*where id = p_run_id .*status = 'running'.*lease_owner = p_lease_owner.*lease_expires_at > clock_timestamp\(\).*returning id into/,
      );
    }

    const detailRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/[id]/route.ts"),
      "utf8",
    );
    const publicDtoSource = readFileSync(
      resolve(process.cwd(), "src/lib/monitoring/create-radar.ts"),
      "utf8",
    );
    expect(detailRoute).toContain("const radarDetailColumns");
    expect(detailRoute).toContain("const runDetailColumns");
    expect(detailRoute).toContain("select(runDetailColumns)");
    expect(detailRoute).not.toMatch(/\.select\("\*"\)/);
    const detailGetRoute = detailRoute.slice(
      detailRoute.indexOf("export async function GET"),
      detailRoute.indexOf("export async function PATCH"),
    );
    for (const internalField of [
      "source_outcomes",
      "internal_errors",
      "error_code",
      "lease_owner",
      "lease_expires_at",
    ]) {
      expect(detailGetRoute).not.toContain(internalField);
    }
    const findingColumns = detailRoute.slice(
      detailRoute.indexOf("const findingDetailColumns"),
      detailRoute.indexOf("const runDetailColumns"),
    );
    const findingDto = publicDtoSource.slice(
      publicDtoSource.indexOf("export function toPublicFinding"),
      publicDtoSource.indexOf("export function toPublicRun"),
    );
    for (const internalFindingField of [
      "first_run_id",
      "fingerprint",
      "event_key",
      "notification_eligible",
    ]) {
      expect(findingColumns).not.toContain(internalFindingField);
      expect(findingDto).not.toContain(internalFindingField);
    }

    const createRouteOrder = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/route.ts"),
      "utf8",
    );
    expect(createRouteOrder).toMatch(
      /result\.data\.map\(\(row\) =>[\s\S]*toPublicRadar\(row/u,
    );
    expect(createRouteOrder).toContain("let createdRadar");
    expect(createRouteOrder).toContain("baselineError");
    expect(createRouteOrder).toContain("toPublicRadar(createdRadar");
    expect(createRouteOrder.indexOf('cookieStore.delete("wa_setup")')).toBeGreaterThan(-1);
    expect(createRouteOrder.indexOf('cookieStore.delete("wa_setup")')).toBeLessThan(
      createRouteOrder.indexOf('runRadar(createdRadar.id, "baseline"'),
    );

    const runRadarSource = readFileSync(
      resolve(process.cwd(), "src/lib/monitoring/run-radar.ts"),
      "utf8",
    );
    expect(runRadarSource).toContain("aiTimeoutMs");
    expect(runRadarSource).toContain("Promise.race");
    expect(runRadarSource).toContain('rpc("persist_run_finding"');
    expect(runRadarSource).toContain('rpc("persist_run_source_outcomes"');
    expect(runRadarSource).toContain('rpc("finalize_run_for_owner"');
    expect(runRadarSource).toContain('rpc("recover_run_for_owner"');
    expect(runRadarSource).toContain("lease_expires_at");
    expect(runRadarSource).toContain("deadlineAt");
    expect(runRadarSource).toContain("AbortController");
    expect(runRadarSource).toContain("maxRetries: 0");
    expect(runRadarSource).toContain("signal:");
    expect(runRadarSource).toContain("outerDeadlineAt");
    expect(runRadarSource).toContain("RECOVERY_CLEANUP_BUDGET_MS");
    expect(runRadarSource).not.toMatch(/from\("findings"\)\.insert/);

    const notificationsSource = readFileSync(
      resolve(process.cwd(), "src/lib/monitoring/notifications.ts"),
      "utf8",
    );
    expect(notificationsSource).toContain(
      'rpc("create_pending_notification_for_run"',
    );

    const createRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/route.ts"),
      "utf8",
    );
    expect(createRoute).toContain("toPublicRadar");
    expect(createRoute).not.toContain("return NextResponse.json({ radar, run }");

    const manualRunRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/[id]/run/route.ts"),
      "utf8",
    );
    expect(createRoute).toContain("MONITORING_ROUTE_BUDGET_MS");
    expect(createRoute).toContain("outerDeadlineAt");
    expect(manualRunRoute).toContain("MONITORING_ROUTE_BUDGET_MS");
    expect(manualRunRoute).toContain("outerDeadlineAt");
  });

  it("recovers a stale source-success run as failed with a 15-minute retry", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const claimStart = migration.indexOf(
      "create or replace function public.claim_radar_run",
    );
    const claimBody = migration.slice(
      claimStart,
      migration.indexOf("$$;", claimStart),
    );

    expect(claimBody).toContain("recovered_status := 'failed'");
    expect(claimBody).toContain(
      "next_check_at = clock_timestamp() + interval '15 minutes'",
    );
    expect(claimBody).not.toMatch(
      /recovered_status := case[\s\S]*source_success_count/u,
    );
    expect(claimBody).not.toContain("clock_timestamp() + interval '6 hours'");
  });

  it("rechecks setup and recovery leases with wall-clock time after locks", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    const setupStart = migration.indexOf(
      "create or replace function public.create_radar_from_setup",
    );
    const setupBody = migration.slice(
      setupStart,
      migration.indexOf("$$;", setupStart),
    );
    expect(setupBody).toMatch(
      /select s\.\* .*for update; if not found or setup_row\.status <> 'pending' or setup_row\.expires_at <= clock_timestamp\(\)/u,
    );
    expect(setupBody).not.toContain("setup_row.expires_at <= now()");

    const recoveryStart = migration.indexOf(
      "create or replace function public.recover_run_for_owner",
    );
    const recoveryBody = migration.slice(
      recoveryStart,
      migration.indexOf("$$;", recoveryStart),
    );
    expect(recoveryBody).toMatch(
      /select rr\.id, rr\.source_outcomes, rr\.source_success_count .*status = 'running' .*lease_owner = p_lease_owner .*rr\.lease_expires_at > clock_timestamp\(\) .*for update/u,
    );
    expect(recoveryBody).toMatch(
      /update public\.radar_runs .*where id = p_run_id .*status = 'running' .*lease_owner = p_lease_owner .*lease_expires_at > clock_timestamp\(\) .*returning id into run_lock_id/u,
    );
    expect(recoveryBody).toMatch(
      /update public\.radars .*where id = radar_lock_id .*lease_owner = p_lease_owner .*lease_expires_at > clock_timestamp\(\) .*returning id into radar_lock_id/u,
    );
  });

  it("cleans an expired sending notification before returning an existing row", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const functionStart = migration.indexOf(
      "create or replace function public.create_pending_notification_for_run",
    );
    const functionBody = migration.slice(
      functionStart,
      migration.indexOf("$$;", functionStart),
    );

    expect(functionBody).toContain("if notification_row.status = 'sending'");
    expect(functionBody).toContain(
      "update public.notifications n set status = 'unknown'",
    );
    expect(functionBody).toContain("n.id = notification_row.id");
    expect(functionBody).toContain("n.status = 'sending'");
    expect(functionBody).toContain(
      "n.claimed_at <= clock_timestamp() - interval '5 minutes'",
    );
    expect(functionBody).toContain("returning * into notification_row");
  });

  it("requeues only failed notifications and leaves unknown terminal", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const functionStart = migration.indexOf(
      "create or replace function public.create_pending_notification_for_run",
    );
    const functionBody = migration.slice(
      functionStart,
      migration.indexOf("$$;", functionStart),
    );

    expect(functionBody).toContain("if notification_row.status = 'failed'");
    expect(functionBody).toContain(
      "update public.notifications n set status = 'pending'",
    );
    expect(functionBody).toContain("n.status = 'failed'");
    expect(functionBody).toContain("error_code = null");
    expect(functionBody).not.toMatch(
      /notification_row\.status = 'unknown'[\s\S]*set status = 'pending'/u,
    );
  });

  it("exposes a lease-bound failed notification worklist for a Radar run", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const functionStart = migration.indexOf(
      "create or replace function public.requeue_failed_notifications_for_run",
    );
    expect(functionStart).toBeGreaterThan(-1);
    const functionBody = migration.slice(
      functionStart,
      migration.indexOf("$$;", functionStart),
    );

    expect(functionBody).toContain("p_run_id uuid");
    expect(functionBody).toContain("p_lease_owner uuid");
    expect(functionBody).toContain("status = 'running'");
    expect(functionBody).toContain("lease_expires_at > clock_timestamp()");
    expect(functionBody).toContain("n.status = 'failed'");
    expect(functionBody).toContain("set status = 'pending'");
    expect(functionBody).not.toContain("status = 'unknown'");
  });

  it("passes an absolute create deadline into the RPC and enforces it around locks and insert", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060002_monitoring_functions.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
    const setupStart = migration.indexOf(
      "create or replace function public.create_radar_from_setup",
    );
    const setupBody = migration.slice(
      setupStart,
      migration.indexOf("$$;", setupStart),
    );

    expect(migration).toContain(
      "drop function if exists public.create_radar_from_setup(uuid, uuid)",
    );
    expect(migration).toContain(
      "to_regprocedure('public.create_radar_from_setup(uuid, uuid)')",
    );
    expect(migration).not.toContain(
      "create or replace function public.create_radar_from_setup( p_setup_id uuid, p_user_id uuid ) returns",
    );
    expect(setupBody).toContain("p_deadline_at timestamptz");
    expect(setupBody).toContain("if p_deadline_at is null then");
    expect(setupBody).toContain("raise exception 'create_deadline_required'");
    expect(setupBody).not.toContain("p_deadline_at is not null");
    expect(setupBody).toContain("set_config('lock_timeout'");
    expect(setupBody).toContain("set_config('statement_timeout'");

    const lockPositions = [...setupBody.matchAll(/for update/g)].map(
      (match) => match.index ?? -1,
    );
    const insertPosition = setupBody.indexOf("insert into public.radars");
    expect(lockPositions.length).toBeGreaterThanOrEqual(2);
    expect(insertPosition).toBeGreaterThan(lockPositions[1] ?? -1);
    expect(
      setupBody.slice(lockPositions[0], lockPositions[1]),
    ).toContain("p_deadline_at <= clock_timestamp()");
    expect(
      setupBody.slice(lockPositions[1], insertPosition),
    ).toContain("p_deadline_at <= clock_timestamp()");
    expect(setupBody.slice(0, insertPosition)).toContain(
      "p_deadline_at <= clock_timestamp()",
    );

    const createRadarSource = readFileSync(
      resolve(process.cwd(), "src/lib/monitoring/create-radar.ts"),
      "utf8",
    );
    expect(createRadarSource).toContain("deadlineAt: number");
    expect(createRadarSource).not.toContain("deadlineAt?: number");
    expect(createRadarSource).toContain(
      "p_deadline_at: new Date(deadlineAt).toISOString()",
    );
    expect(createRadarSource).not.toContain("deadlineAt === undefined");
    expect(createRadarSource).toContain("abortSignal");

    const createRouteSource = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/route.ts"),
      "utf8",
    );
    expect(createRouteSource).toMatch(
      /createRadarFromSetup\([\s\S]*outerDeadlineAt,\s*db,\s*signal/u,
    );
  });

  it("persists the created Radar so setup activation retries are idempotent", () => {
    const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
    const idempotencyMigration = readdirSync(migrationDirectory)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(resolve(migrationDirectory, file), "utf8"))
      .find((source) => {
        const normalized = source.toLowerCase();
        return normalized.includes("alter table public.pending_radar_setups") &&
          normalized.includes("add column if not exists radar_id uuid");
      })
      ?.replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase() ?? "";

    expect(idempotencyMigration).toMatch(
      /alter table public\.pending_radar_setups add column if not exists radar_id uuid/,
    );
    expect(idempotencyMigration).toContain("with consumed_setups as");
    expect(idempotencyMigration).toMatch(
      /if setup_row\.status = 'consumed'[\s\S]*if setup_row\.radar_id is null[\s\S]*return radar_row/,
    );
    expect(idempotencyMigration).toMatch(
      /update public\.pending_radar_setups[\s\S]*set status = 'consumed', radar_id = radar_row\.id/,
    );
  });
});

const integrationConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const missingConfig = Object.entries(integrationConfig)
  .filter(([, value]) => !value || value.startsWith("your-") || value.startsWith("replace-with"))
  .map(([name]) => name);
const runIntegrationTest = missingConfig.length ? it.skip : it;
const MONITORING_INTEGRATION_TIMEOUT_MS = 30_000;

runIntegrationTest(
  `integration: monitoring RPC claims are atomic${
    missingConfig.length ? ` (SKIP: missing ${missingConfig.join(", ")})` : ""
  }`,
  async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(integrationConfig.url!, integrationConfig.serviceRoleKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `task5-monitoring-${randomUUID()}@example.com`;
    const password = `Task5-monitoring-${randomUUID()}!`;
    let userId: string | undefined;
    const setupIds: string[] = [];
    const radarIds: string[] = [];
    const guestIdentityHash = `task5-guest-${randomUUID()}`;

    try {
      const userResult = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      expect(userResult.error).toBeNull();
      userId = userResult.data.user?.id;
      expect(userId).toBeDefined();

      const profileResult = await admin.from("profiles").select("id").eq("id", userId!).single();
      expect(profileResult.error).toBeNull();

      const quotaResults = await Promise.all(
        Array.from({ length: 4 }, () =>
          admin.rpc("claim_guest_ai_request", {
            p_identity_hash: guestIdentityHash,
          }),
        ),
      );
      const quotaClaims = quotaResults.map((result) => {
        expect(result.error).toBeNull();
        return firstRow<{
          allowed: boolean;
          identity_count: number;
          global_count: number;
        }>(result.data);
      });
      expect(quotaClaims.filter((claim) => claim?.allowed)).toHaveLength(3);
      expect(Math.max(...quotaClaims.map((claim) => claim?.identity_count ?? 0))).toBe(3);

      const idempotentSetupIds = [randomUUID(), randomUUID()];
      const idempotentSetupResults = await Promise.all(
        idempotentSetupIds.map((setupId) => {
          setupIds.push(setupId);
          return admin.from("pending_radar_setups").insert({
            id: setupId,
            user_id: userId,
            original_prompt: "Task 5 idempotency test",
            radar_name: "Task 5 Idempotency",
            rules: {
              radarName: "Task 5 Idempotency",
              subject: "Task 5",
              aliases: [],
              includeTopics: ["test"],
              excludeTopics: [],
              searchQuery: "Task 5",
              importanceThreshold: 50,
              intervalMinutes: 360,
            },
            rule_token_hash: "task5-rule-token-hash",
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          });
        }),
      );
      expect(idempotentSetupResults.filter((result) => !result.error)).toHaveLength(1);
      expect(idempotentSetupResults.filter((result) => result.error?.code === "23505")).toHaveLength(1);

      const chatId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 100000);
      const connectionResult = await admin.from("telegram_connections").insert({
        user_id: userId,
        chat_id: chatId,
        telegram_username: "task5-test",
      });
      expect(connectionResult.error).toBeNull();

      for (let index = 0; index < 4; index += 1) {
        const setupId = randomUUID();
        setupIds.push(setupId);
        const setupResult = await admin.from("pending_radar_setups").insert({
          id: setupId,
          user_id: userId,
          original_prompt: `Task 5 test ${index}`,
          radar_name: `Task 5 Radar ${index}`,
          rules: {
            radarName: `Task 5 Radar ${index}`,
            subject: "Task 5",
            aliases: [],
            includeTopics: ["test"],
            excludeTopics: [],
            searchQuery: "Task 5",
            importanceThreshold: 50,
            intervalMinutes: 360,
          },
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
        expect(setupResult.error).toBeNull();
      }

      const createResults = await Promise.all(
        setupIds.map((setupId) =>
          admin.rpc("create_radar_from_setup", {
            p_setup_id: setupId,
            p_user_id: userId,
            p_deadline_at: new Date(Date.now() + 60_000).toISOString(),
          }),
        ),
      );
      const createdRadars = createResults
        .map((result) => firstRow<{ id: string }>(result.data))
        .filter((radar): radar is { id: string } => Boolean(radar?.id));
      radarIds.push(...createdRadars.map((radar) => radar.id));
      expect(createdRadars.length).toBeLessThanOrEqual(3);

      const radarId = createdRadars[0]?.id;
      expect(radarId).toBeDefined();
      const leaseExpiresAt = new Date(Date.now() + 60_000).toISOString();
      const claimResults = await Promise.all(
        [randomUUID(), randomUUID()].map((leaseOwner) =>
          admin.rpc("claim_radar_run", {
            p_radar_id: radarId,
            p_user_id: userId,
            p_trigger: "manual",
            p_lease_owner: leaseOwner,
            p_lease_expires_at: leaseExpiresAt,
          }),
        ),
      );
      const claimedRuns = claimResults
        .map((result) => firstRow<{ run_id: string | null }>(result.data))
        .filter((claim): claim is { run_id: string } => Boolean(claim?.run_id));
      expect(claimedRuns).toHaveLength(1);

      const findingResult = await admin
        .from("findings")
        .insert({
          radar_id: radarId,
          source_type: "tavily",
          source_domain: "example.com",
          source_url: `https://example.com/task5/${randomUUID()}`,
          fingerprint: randomUUID(),
          title: "Task 5 Notification",
          summary: "Task 5 notification test",
        })
        .select("id")
        .single();
      expect(findingResult.error).toBeNull();

      const notificationResult = await admin
        .from("notifications")
        .insert({
          finding_id: findingResult.data!.id,
          radar_id: radarId,
          user_id: userId,
          destination_id: String(chatId),
          dedupe_key: randomUUID(),
          status: "pending",
        })
        .select("id")
        .single();
      expect(notificationResult.error).toBeNull();

      const notificationClaims = await Promise.all(
        [1, 2].map(() =>
          admin.rpc("claim_notification", {
            p_notification_id: notificationResult.data!.id,
          }),
        ),
      );
      const claimedNotifications = notificationClaims
        .map((result) => firstRow<{ notification_id: string }>(result.data))
        .filter((claim): claim is { notification_id: string } => Boolean(claim?.notification_id));
      expect(claimedNotifications).toHaveLength(1);

      const staleSendingResult = await admin
        .from("notifications")
        .update({
          status: "sending",
          claimed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        })
        .eq("id", notificationResult.data!.id);
      expect(staleSendingResult.error).toBeNull();

      const staleClaimResult = await admin.rpc("claim_notification", {
        p_notification_id: notificationResult.data!.id,
      });
      expect(staleClaimResult.error).toBeNull();
      expect(firstRow(staleClaimResult.data)).toBeNull();

      const staleNotificationState = await admin
        .from("notifications")
        .select("status")
        .eq("id", notificationResult.data!.id)
        .single();
      expect(staleNotificationState.error).toBeNull();
      expect(staleNotificationState.data?.status).toBe("unknown");
    } finally {
      if (userId) {
        await admin.from("radars").delete().eq("user_id", userId);
        await admin.from("pending_radar_setups").delete().eq("user_id", userId);
        await admin.from("telegram_connections").delete().eq("user_id", userId);
        await admin.from("guest_ai_requests").delete().eq("identity_hash", guestIdentityHash);
        await admin.auth.admin.deleteUser(userId);
      }
    }
  },
  MONITORING_INTEGRATION_TIMEOUT_MS,
);
