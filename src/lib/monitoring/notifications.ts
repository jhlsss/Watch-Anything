import { createTelegramClient } from "@/lib/telegram/client";
import {
  firstRpcRow,
  getMonitoringClient,
  MonitoringError,
  throwDatabaseError,
  type MonitoringClient,
} from "@/lib/monitoring/create-radar";

type FindingRecord = {
  id: string;
  radar_id: string;
  fingerprint: string;
  event_key?: string | null;
  title: string;
  summary: string;
  source_domain: string;
  source_url: string;
};

type RadarSummary = {
  id: string;
  user_id: string;
  name: string;
};

type NotificationRecord = {
  id: string;
  finding_id: string;
  radar_id: string;
  user_id: string;
  destination_id: string;
  status: "pending" | "sending" | "sent" | "failed" | "unknown";
};

type ClaimedNotification = {
  notification_id: string;
  finding_id: string;
  radar_id: string;
  user_id: string;
  destination_id: string;
};

type TelegramSender = {
  sendMessage(input: {
    chatId: number | string;
    text: string;
  }): Promise<{ message_id: number }>;
};

export type NotificationSendResult = {
  notificationId: string;
  status: "sent" | "failed" | "unknown";
  messageId?: number;
  errorCode?: string;
};

type NotificationDependencies = {
  client?: MonitoringClient;
  telegram?: TelegramSender;
};

function notificationDedupeKey(finding: FindingRecord): string {
  return finding.event_key?.trim() || finding.fingerprint;
}

async function readFinding(
  client: MonitoringClient,
  findingId: string,
): Promise<FindingRecord> {
  const result = await client
    .from("findings")
    .select(
      "id,radar_id,fingerprint,event_key,title,summary,source_domain,source_url",
    )
    .eq("id", findingId)
    .maybeSingle();
  throwDatabaseError(result.error);

  if (!result.data) {
    throw new MonitoringError("DATABASE_ERROR", "Finding was not found.");
  }

  return result.data as FindingRecord;
}

async function readRadar(
  client: MonitoringClient,
  radarId: string,
): Promise<RadarSummary> {
  const result = await client
    .from("radars")
    .select("id,user_id,name")
    .eq("id", radarId)
    .maybeSingle();
  throwDatabaseError(result.error);

  if (!result.data) {
    throw new MonitoringError("RADAR_NOT_FOUND", "Radar was not found.");
  }

  return result.data as RadarSummary;
}

export async function createPendingNotification(
  findingId: string,
  destinationId: string,
  client?: MonitoringClient,
): Promise<NotificationRecord> {
  const db = getMonitoringClient(client);
  const finding = await readFinding(db, findingId);
  const radar = await readRadar(db, finding.radar_id);
  const dedupeKey = notificationDedupeKey(finding);

  const insertResult = await db
    .from("notifications")
    .insert({
      finding_id: finding.id,
      radar_id: radar.id,
      user_id: radar.user_id,
      destination_id: destinationId,
      dedupe_key: dedupeKey,
      status: "pending",
    })
    .select("id,finding_id,radar_id,user_id,destination_id,status")
    .maybeSingle();

  if (!insertResult.error && insertResult.data) {
    return insertResult.data as NotificationRecord;
  }

  if (insertResult.error && insertResult.error.code !== "23505") {
    throwDatabaseError(insertResult.error);
  }

  const existingByFindingResult = await db
    .from("notifications")
    .select("id,finding_id,radar_id,user_id,destination_id,status")
    .eq("finding_id", finding.id)
    .eq("destination_id", destinationId)
    .maybeSingle();
  throwDatabaseError(existingByFindingResult.error);

  if (existingByFindingResult.data) {
    return existingByFindingResult.data as NotificationRecord;
  }

  const existingByDedupeResult = await db
    .from("notifications")
    .select("id,finding_id,radar_id,user_id,destination_id,status")
    .eq("radar_id", radar.id)
    .eq("dedupe_key", dedupeKey)
    .eq("destination_id", destinationId)
    .maybeSingle();
  throwDatabaseError(existingByDedupeResult.error);

  if (existingByDedupeResult.data) {
    return existingByDedupeResult.data as NotificationRecord;
  }

  throw new MonitoringError(
    "DATABASE_ERROR",
    "Notification could not be created or resolved.",
  );
}

function formatNotificationText(radar: RadarSummary, finding: FindingRecord): string {
  return [
    radar.name,
    finding.title,
    finding.summary,
    `Source: ${finding.source_domain}`,
    finding.source_url,
    "Importance and confidence indicate a rule match, not guaranteed factual truth.",
  ].join("\n\n");
}

async function updateNotification(
  client: MonitoringClient,
  notificationId: string,
  values: Record<string, unknown>,
): Promise<boolean> {
  const result = await client
    .from("notifications")
    .update(values)
    .eq("id", notificationId)
    .eq("status", "sending");

  return !result.error;
}

export async function sendPendingNotification(
  notificationId: string,
  dependencies: NotificationDependencies = {},
): Promise<NotificationSendResult | null> {
  const db = getMonitoringClient(dependencies.client);
  const claimResult = await db.rpc("claim_notification", {
    p_notification_id: notificationId,
  });
  throwDatabaseError(claimResult.error);

  const claim = firstRpcRow<ClaimedNotification>(claimResult.data);

  if (!claim?.notification_id) {
    return null;
  }

  const finding = await readFinding(db, claim.finding_id);
  const radar = await readRadar(db, claim.radar_id);
  const connectionResult = await db
    .from("telegram_connections")
    .select("chat_id")
    .eq("user_id", claim.user_id)
    .eq("chat_id", claim.destination_id)
    .maybeSingle();

  if (connectionResult.error || !connectionResult.data) {
    const updated = await updateNotification(db, notificationId, {
      status: "failed",
      error_code: "TELEGRAM_NOT_CONNECTED",
    });

    if (!updated) {
      throw new MonitoringError(
        "DATABASE_ERROR",
        connectionResult.error?.message ?? "Notification status could not be updated.",
      );
    }

    return {
      notificationId,
      status: "failed",
      errorCode: "TELEGRAM_NOT_CONNECTED",
    };
  }

  const telegram = dependencies.telegram ?? createTelegramClient();

  try {
    const sentMessage = await telegram.sendMessage({
      chatId: claim.destination_id,
      text: formatNotificationText(radar, finding),
    });
    const updated = await updateNotification(db, notificationId, {
      status: "sent",
      telegram_message_id: sentMessage.message_id,
      sent_at: new Date().toISOString(),
      error_code: null,
    });

    if (!updated) {
      await updateNotification(db, notificationId, {
        status: "unknown",
        error_code: "NOTIFICATION_STATUS_UNKNOWN",
      });
      return {
        notificationId,
        status: "unknown",
        errorCode: "NOTIFICATION_STATUS_UNKNOWN",
      };
    }

    return {
      notificationId,
      status: "sent",
      messageId: sentMessage.message_id,
    };
  } catch (error) {
    const errorCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "TELEGRAM_API_ERROR";
    const status = errorCode === "TELEGRAM_RESULT_UNKNOWN" ? "unknown" : "failed";
    const updated = await updateNotification(db, notificationId, {
      status,
      error_code: errorCode,
    });

    if (!updated) {
      throw new MonitoringError(
        "DATABASE_ERROR",
        "Notification status could not be updated after delivery failure.",
      );
    }

    return {
      notificationId,
      status,
      errorCode,
    };
  }
}
