import { createClient as createAdminClient } from "@/lib/supabase/admin";
import type { RunResult } from "@/types/contracts";

export type MonitoringErrorCode =
  | "CREATE_DEADLINE_EXCEEDED"
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

export type PublicRadar = {
  id: unknown;
  user_id: unknown;
  name: unknown;
  original_prompt: unknown;
  rules: unknown;
  status: unknown;
  interval_minutes: unknown;
  baseline_cutoff_at: unknown;
  last_checked_at: unknown;
  next_check_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

export type PublicFinding = {
  id: unknown;
  radar_id: unknown;
  source_type: unknown;
  source_domain: unknown;
  source_url: unknown;
  canonical_url: unknown;
  title: unknown;
  summary: unknown;
  published_at: unknown;
  first_seen_at: unknown;
  last_seen_at: unknown;
  relevance_score: unknown;
  importance_score: unknown;
  match_reason: unknown;
};

export type PublicRun = {
  id: unknown;
  radar_id: unknown;
  trigger: unknown;
  status: unknown;
  started_at: unknown;
  finished_at: unknown;
  candidate_count: unknown;
  relevant_count: unknown;
  notification_count: unknown;
};

export function toPublicRadar(row: Record<string, unknown>): PublicRadar {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    original_prompt: row.original_prompt,
    rules: row.rules,
    status: row.status,
    interval_minutes: row.interval_minutes,
    baseline_cutoff_at: row.baseline_cutoff_at,
    last_checked_at: row.last_checked_at ?? null,
    next_check_at: row.next_check_at,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

export function toPublicFinding(row: Record<string, unknown>): PublicFinding {
  return {
    id: row.id,
    radar_id: row.radar_id,
    source_type: row.source_type,
    source_domain: row.source_domain,
    source_url: row.source_url,
    canonical_url: row.canonical_url,
    title: row.title,
    summary: row.summary,
    published_at: row.published_at,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    relevance_score: row.relevance_score,
    importance_score: row.importance_score,
    match_reason: row.match_reason,
  };
}

export function toPublicRun(row: Record<string, unknown>): PublicRun {
  return {
    id: row.id,
    radar_id: row.radar_id,
    trigger: row.trigger,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    candidate_count: row.candidate_count,
    relevant_count: row.relevant_count,
    notification_count: row.notification_count,
  };
}

export function toPublicRunResult(run: RunResult) {
  return {
    runId: run.runId,
    status: run.status,
    candidateCount: run.candidateCount,
    relevantCount: run.relevantCount,
    notificationCount: run.notificationCount,
  };
}

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
  deadlineAt: number,
  client?: MonitoringClient,
  signal?: AbortSignal,
): Promise<RadarRecord> {
  const db = getMonitoringClient(client);
  const request = db.rpc("create_radar_from_setup", {
    p_setup_id: setupId,
    p_user_id: userId,
    p_deadline_at: new Date(deadlineAt).toISOString(),
  });
  const abortableRequest = request as PromiseLike<DatabaseResult> & {
    abortSignal?: (abortSignal: AbortSignal) => PromiseLike<DatabaseResult>;
  };
  const observedRequest =
    signal && typeof abortableRequest.abortSignal === "function"
      ? abortableRequest.abortSignal(signal)
      : request;
  const result = await observedRequest;

  if (result.error) {
    const code = result.error.message.match(
      /CREATE_DEADLINE_EXCEEDED|PROFILE_NOT_FOUND|SETUP_NOT_AVAILABLE|TELEGRAM_NOT_CONNECTED|ACTIVE_RADAR_LIMIT_REACHED/u,
    )?.[0];
    throw new MonitoringError(code ?? "DATABASE_ERROR", result.error.message);
  }

  const radar = firstRpcRow<RadarRecord>(result.data);

  if (!radar?.id) {
    throw new MonitoringError("DATABASE_ERROR", "Radar creation returned no row.");
  }

  return radar;
}
