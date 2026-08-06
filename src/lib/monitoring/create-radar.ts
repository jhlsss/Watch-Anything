import { createClient as createAdminClient } from "@/lib/supabase/admin";

export type MonitoringErrorCode =
  | "PROFILE_NOT_FOUND"
  | "SETUP_NOT_AVAILABLE"
  | "TELEGRAM_NOT_CONNECTED"
  | "ACTIVE_RADAR_LIMIT_REACHED"
  | "RADAR_NOT_FOUND"
  | "RADAR_NOT_ACTIVE"
  | "RADAR_ALREADY_LEASED"
  | "RADAR_NOT_DUE"
  | "MANUAL_CHECK_COOLDOWN"
  | "MANUAL_DAILY_LIMIT_REACHED"
  | "INVALID_RUN_TRIGGER"
  | "INVALID_RUN_LEASE"
  | "RUN_NOT_CLAIMED"
  | "NOTIFICATION_NOT_PENDING"
  | "DATABASE_ERROR";

export class MonitoringError extends Error {
  constructor(
    public readonly code: MonitoringErrorCode | string,
    message = code,
  ) {
    super(message);
    this.name = "MonitoringError";
  }
}

export type DatabaseError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

export type DatabaseResult<T = unknown> = {
  data: T | null;
  error: DatabaseError | null;
};

export interface MonitoringQuery<T = unknown> extends PromiseLike<DatabaseResult<T>> {
  select(columns?: string, options?: Record<string, unknown>): MonitoringQuery<T>;
  eq(column: string, value: unknown): MonitoringQuery<T>;
  neq(column: string, value: unknown): MonitoringQuery<T>;
  gt(column: string, value: unknown): MonitoringQuery<T>;
  gte(column: string, value: unknown): MonitoringQuery<T>;
  lt(column: string, value: unknown): MonitoringQuery<T>;
  lte(column: string, value: unknown): MonitoringQuery<T>;
  in(column: string, values: readonly unknown[]): MonitoringQuery<T>;
  order(column: string, options?: Record<string, unknown>): MonitoringQuery<T>;
  limit(count: number): MonitoringQuery<T>;
  maybeSingle(): MonitoringQuery<T>;
  single(): MonitoringQuery<T>;
  insert(values: unknown): MonitoringQuery<T>;
  update(values: unknown): MonitoringQuery<T>;
  upsert(values: unknown, options?: Record<string, unknown>): MonitoringQuery<T>;
}

export interface MonitoringClient {
  from(table: string): MonitoringQuery;
  rpc(functionName: string, args?: Record<string, unknown>): Promise<DatabaseResult>;
}

export type RadarRecord = {
  id: string;
  user_id: string;
  name: string;
  original_prompt: string;
  rules: unknown;
  source_state?: Record<string, unknown>;
  status: "active" | "paused";
  interval_minutes: number;
  baseline_cutoff_at: string;
  tavily_baseline_completed_at?: string | null;
  last_checked_at?: string | null;
  next_check_at: string;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
};

export function getMonitoringClient(client?: MonitoringClient): MonitoringClient {
  return client ?? (createAdminClient() as unknown as MonitoringClient);
}

export function firstRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }

  return data === null || data === undefined ? null : (data as T);
}

export function throwDatabaseError(
  error: DatabaseError | null,
  fallbackCode: MonitoringErrorCode | string = "DATABASE_ERROR",
): void {
  if (!error) {
    return;
  }

  throw new MonitoringError(fallbackCode, error.message);
}

export async function createRadarFromSetup(
  setupId: string,
  userId: string,
  client?: MonitoringClient,
): Promise<RadarRecord> {
  const db = getMonitoringClient(client);
  const result = await db.rpc("create_radar_from_setup", {
    p_setup_id: setupId,
    p_user_id: userId,
  });

  if (result.error) {
    const code = result.error.message.match(
      /PROFILE_NOT_FOUND|SETUP_NOT_AVAILABLE|TELEGRAM_NOT_CONNECTED|ACTIVE_RADAR_LIMIT_REACHED/u,
    )?.[0];
    throw new MonitoringError(code ?? "DATABASE_ERROR", result.error.message);
  }

  const radar = firstRpcRow<RadarRecord>(result.data);

  if (!radar?.id) {
    throw new MonitoringError("DATABASE_ERROR", "Radar creation returned no row.");
  }

  return radar;
}
