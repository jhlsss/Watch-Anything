import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }
  return data ? (data as T) : null;
}

describe("monitoring migration contract", () => {
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
      /for stale_run in select .* from public\.radar_runs .*status = 'running'.*lease_expires_at <= now\(\).*for update/,
    );
    expect(migration).toMatch(
      /recovered_status := case .*source_success_count.*source_outcomes/,
    );
    expect(migration).toMatch(
      /update public\.radar_runs .*status = recovered_status.*finished_at = timezone\('utc', now\(\)\).*lease_owner = null.*lease_expires_at = null/,
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
      /persist_run_finding.*for update.*status = 'running'.*lease_owner.*lease_expires_at > now\(\).*run_findings/,
    );
    expect(migration).toMatch(
      /create or replace function public\.create_pending_notification_for_run\(.*p_run_id uuid.*p_lease_owner uuid/,
    );
    expect(migration).toMatch(
      /create_pending_notification_for_run.*status = 'running'.*lease_owner.*lease_expires_at > now\(\).*notifications/,
    );
    expect(migration).toMatch(
      /create or replace function public\.mark_source_baseline_for_run\(.*p_run_id uuid.*p_lease_owner uuid/,
    );

    const detailRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/[id]/route.ts"),
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

    const createRouteOrder = readFileSync(
      resolve(process.cwd(), "src/app/api/radars/route.ts"),
      "utf8",
    );
    expect(createRouteOrder.indexOf('cookieStore.delete("wa_setup")')).toBeGreaterThan(-1);
    expect(createRouteOrder.indexOf('cookieStore.delete("wa_setup")')).toBeLessThan(
      createRouteOrder.indexOf('runRadar(radar.id, "baseline"'),
    );

    const runRadarSource = readFileSync(
      resolve(process.cwd(), "src/lib/monitoring/run-radar.ts"),
      "utf8",
    );
    expect(runRadarSource).toContain("aiTimeoutMs");
    expect(runRadarSource).toContain("Promise.race");
    expect(runRadarSource).toContain('rpc("persist_run_finding"');
    expect(runRadarSource).toContain("lease_expires_at");
    expect(runRadarSource).toContain("deadlineAt");
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
);
