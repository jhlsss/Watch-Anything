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
  deadlineAt?: number;
};

const MAX_TIMER_MS = 2_147_000_000;

export type NotificationRunContext = {
  runId: string;
  leaseOwner: string;
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

function throwNotificationRpcError(
  error: { message: string; code?: string } | null,
): void {
  if (!error) {
    return;
  }

  const stableCode = error.message.match(
    /RUN_NOT_CLAIMED|FINDING_NOT_FOUND|NOTIFICATION_NOT_FOUND/u,
  )?.[0];
  throw new MonitoringError(stableCode ?? "DATABASE_ERROR", error.message);
}

export async function createPendingNotificationForRun(
  findingId: string,
  destinationId: string,
  context: NotificationRunContext,
  client?: MonitoringClient,
): Promise<NotificationRecord> {
  const db = getMonitoringClient(client);
  const result = await db.rpc("create_pending_notification_for_run", {
    p_run_id: context.runId,
    p_lease_owner: context.leaseOwner,
    p_finding_id: findingId,
    p_destination_id: destinationId,
  });
  throwNotificationRpcError(result.error);

  const row = firstRpcRow<{
    notification_id: string;
    finding_id: string;
    radar_id: string;
    user_id: string;
    destination_id: string;
    status: NotificationRecord["status"];
  }>(result.data);

  if (!row?.notification_id) {
    throw new MonitoringError(
      "DATABASE_ERROR",
      "Notification creation returned no row.",
    );
  }

  return {
    id: row.notification_id,
    finding_id: row.finding_id,
    radar_id: row.radar_id,
    user_id: row.user_id,
    destination_id: row.destination_id,
    status: row.status,
  };
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

function runDeadlineError(): MonitoringError {
  return new MonitoringError(
    "RUN_DEADLINE_EXCEEDED",
    "Run lease deadline was reached.",
  );
}

function withNotificationDeadline<T>(
  promise: PromiseLike<T>,
  deadlineAt: number | undefined,
): Promise<T> {
  if (deadlineAt === undefined) {
    return Promise.resolve(promise);
  }

  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    return Promise.reject(runDeadlineError());
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // Promise.race observes the provider promise, while the timeout winner keeps
  // the late provider result out of the notification state machine.
  const observedPromise = Promise.resolve(promise);
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(runDeadlineError()),
      Math.min(remainingMs, MAX_TIMER_MS),
    );
  });

  return Promise.race([observedPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

async function updateNotification(
  client: MonitoringClient,
  notificationId: string,
  values: Record<string, unknown>,
  deadlineAt?: number,
): Promise<boolean> {
  try {
    const result = await withNotificationDeadline(
      client
        .from("notifications")
        .update(values)
        .eq("id", notificationId)
        .eq("status", "sending")
        .select("id")
        .maybeSingle(),
      deadlineAt,
    );

    return !result.error && Boolean(result.data);
  } catch (error) {
    if (
      deadlineAt !== undefined &&
      error instanceof MonitoringError &&
      error.code === "RUN_DEADLINE_EXCEEDED"
    ) {
      return false;
    }

    throw error;
  }
}

async function finishPreparationFailure(
  client: MonitoringClient,
  notificationId: string,
  status: "failed" | "unknown",
  errorCode: string,
  deadlineAt?: number,
): Promise<NotificationSendResult> {
  const updated = await updateNotification(
    client,
    notificationId,
    {
      status,
      error_code: errorCode,
    },
    deadlineAt,
  );

  if (!updated) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      return {
        notificationId,
        status,
        errorCode,
      };
    }

    throw new MonitoringError(
      "DATABASE_ERROR",
      "Notification status could not be updated after preparation failure.",
    );
  }

  return {
    notificationId,
    status,
    errorCode,
  };
}

export async function sendPendingNotification(
  notificationId: string,
  dependencies: NotificationDependencies = {},
): Promise<NotificationSendResult | null> {
  const db = getMonitoringClient(dependencies.client);
  const claimResult = await withNotificationDeadline(
    db.rpc("claim_notification", {
      p_notification_id: notificationId,
    }),
    dependencies.deadlineAt,
  );
  throwDatabaseError(claimResult.error);

  const claim = firstRpcRow<ClaimedNotification>(claimResult.data);

  if (!claim?.notification_id) {
    return null;
  }

  let finding: FindingRecord;
  let radar: RadarSummary;
  try {
    finding = await withNotificationDeadline(
      readFinding(db, claim.finding_id),
      dependencies.deadlineAt,
    );
    radar = await withNotificationDeadline(
      readRadar(db, claim.radar_id),
      dependencies.deadlineAt,
    );
  } catch (error) {
    return finishPreparationFailure(
      db,
      notificationId,
      "unknown",
      error instanceof MonitoringError && error.code === "RUN_DEADLINE_EXCEEDED"
        ? "RUN_DEADLINE_EXCEEDED"
        : "NOTIFICATION_PREPARATION_FAILED",
      dependencies.deadlineAt,
    );
  }

  let connectionResult: {
    data: unknown;
    error: { message: string; code?: string } | null;
  };
  try {
    connectionResult = await withNotificationDeadline(
      db
        .from("telegram_connections")
        .select("chat_id")
        .eq("user_id", claim.user_id)
        .eq("chat_id", claim.destination_id)
        .maybeSingle(),
      dependencies.deadlineAt,
    );
  } catch (error) {
    return finishPreparationFailure(
      db,
      notificationId,
      "unknown",
      error instanceof MonitoringError && error.code === "RUN_DEADLINE_EXCEEDED"
        ? "RUN_DEADLINE_EXCEEDED"
        : "NOTIFICATION_PREPARATION_FAILED",
      dependencies.deadlineAt,
    );
  }

  if (connectionResult.error) {
    return finishPreparationFailure(
      db,
      notificationId,
      "unknown",
      "NOTIFICATION_PREPARATION_FAILED",
      dependencies.deadlineAt,
    );
  }

  if (!connectionResult.data) {
    return finishPreparationFailure(
      db,
      notificationId,
      "failed",
      "TELEGRAM_NOT_CONNECTED",
      dependencies.deadlineAt,
    );
  }

  try {
    const telegram = dependencies.telegram ?? createTelegramClient();
    const sentMessage = await withNotificationDeadline(
      telegram.sendMessage({
        chatId: claim.destination_id,
        text: formatNotificationText(radar, finding),
      }),
      dependencies.deadlineAt,
    );
    const updated = await updateNotification(
      db,
      notificationId,
      {
        status: "sent",
        telegram_message_id: sentMessage.message_id,
        sent_at: new Date().toISOString(),
        error_code: null,
      },
      dependencies.deadlineAt,
    );

    if (!updated) {
      await updateNotification(
        db,
        notificationId,
        {
          status: "unknown",
          error_code: "NOTIFICATION_STATUS_UNKNOWN",
        },
        dependencies.deadlineAt,
      );
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
    const status =
      errorCode === "TELEGRAM_RESULT_UNKNOWN" ||
      errorCode === "NOTIFICATION_TIMEOUT" ||
      errorCode === "RUN_DEADLINE_EXCEEDED"
        ? "unknown"
        : "failed";
    const updated = await updateNotification(
      db,
      notificationId,
      {
        status,
        error_code: errorCode,
      },
      dependencies.deadlineAt,
    );

    if (!updated) {
      if (dependencies.deadlineAt !== undefined && Date.now() >= dependencies.deadlineAt) {
        return {
          notificationId,
          status,
          errorCode,
        };
      }

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
