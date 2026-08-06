import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createPendingNotification,
  sendPendingNotification,
} from "@/lib/monitoring/notifications";
import type { MonitoringClient } from "@/lib/monitoring/create-radar";
import { createClient as createAdminClient } from "@/lib/supabase/admin";

const radarIdSchema = z.uuid();

function readRadarId(argv: string[]): string {
  const index = argv.findIndex((argument) => argument === "--radar-id");
  const value = index >= 0 ? argv[index + 1] : undefined;
  const parsed = radarIdSchema.safeParse(value);

  if (!parsed.success) {
    throw new Error("Usage: pnpm smoke:telegram -- --radar-id YOUR_REAL_RADAR_UUID");
  }

  return parsed.data;
}

async function main() {
  const radarId = readRadarId(process.argv.slice(2));
  const admin = createAdminClient();
  const monitoringClient = admin as unknown as MonitoringClient;
  const smokeId = randomUUID();
  const dedupeKey = `smoke-test-${smokeId}`;
  const sourceUrl = `https://smoke.watch-anything.invalid/${smokeId}`;

  const radarResult = await admin
    .from("radars")
    .select("id,user_id,name")
    .eq("id", radarId)
    .maybeSingle();
  if (radarResult.error || !radarResult.data) {
    throw new Error("The requested Radar was not found.");
  }

  const connectionResult = await admin
    .from("telegram_connections")
    .select("chat_id")
    .eq("user_id", radarResult.data.user_id)
    .maybeSingle();
  if (connectionResult.error || !connectionResult.data) {
    throw new Error("The Radar owner has no Telegram connection.");
  }

  const findingResult = await admin
    .from("findings")
    .insert({
      radar_id: radarId,
      source_type: "tavily",
      source_domain: "smoke.watch-anything.invalid",
      source_url: sourceUrl,
      canonical_url: sourceUrl,
      fingerprint: dedupeKey,
      event_key: dedupeKey,
      title: `[SMOKE TEST] ${smokeId}`,
      summary: "This finding proves the production Notification and Telegram path.",
      published_at: new Date().toISOString(),
      first_seen_during_baseline: false,
      relevance_score: 100,
      importance_score: 100,
      match_reason: "Task 7 Telegram smoke test",
      notification_eligible: true,
    })
    .select("id")
    .single();
  if (findingResult.error || !findingResult.data) {
    throw new Error("Smoke-test finding could not be inserted.");
  }

  const destinationId = String(connectionResult.data.chat_id);
  const notification = await createPendingNotification(
    findingResult.data.id,
    destinationId,
    monitoringClient,
  );
  const firstSend = await sendPendingNotification(notification.id, {
    client: monitoringClient,
  });

  if (firstSend?.status === "unknown") {
    console.log("Telegram delivery status is unknown; stopping without retrying.");
    process.exitCode = 2;
    return;
  }

  if (firstSend?.status !== "sent") {
    throw new Error("Smoke-test Telegram notification was not sent.");
  }

  const duplicate = await createPendingNotification(
    findingResult.data.id,
    destinationId,
    monitoringClient,
  );
  if (duplicate.id !== notification.id) {
    throw new Error("Notification dedupe did not return the original row.");
  }

  const duplicateSend = await sendPendingNotification(duplicate.id, {
    client: monitoringClient,
  });
  if (duplicateSend !== null) {
    throw new Error("Notification dedupe attempted a second delivery.");
  }

  const notificationsResult = await admin
    .from("notifications")
    .select("id,status,dedupe_key")
    .eq("radar_id", radarId)
    .eq("dedupe_key", dedupeKey);
  if (
    notificationsResult.error ||
    !Array.isArray(notificationsResult.data) ||
    notificationsResult.data.length !== 1 ||
    notificationsResult.data[0]?.status !== "sent"
  ) {
    throw new Error("Smoke-test notification count or status was unexpected.");
  }

  console.log(
    `Telegram smoke test sent one [SMOKE TEST] notification for ${radarResult.data.name}.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Telegram smoke test failed.");
  process.exitCode = 1;
}
