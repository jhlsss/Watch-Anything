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
    } finally {
      if (userId) {
        await admin.from("radars").delete().eq("user_id", userId);
        await admin.from("pending_radar_setups").delete().eq("user_id", userId);
        await admin.from("telegram_connections").delete().eq("user_id", userId);
        await admin.auth.admin.deleteUser(userId);
      }
    }
  },
);
