import { randomUUID } from "node:crypto";

import { type CandidateEvaluation } from "@/lib/ai/evaluate-candidates";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  createStructuredOutput,
  evaluateCandidateItemSchema,
  evaluateCandidatesJsonSchema,
  type GroqLike,
  resolveGroqModel,
} from "@/lib/ai/schemas";
import { parseServerEnv } from "@/lib/env";
import {
  createPendingNotificationForRun as defaultCreatePendingNotificationForRun,
  sendPendingNotification as defaultSendPendingNotification,
  type NotificationRunContext,
  type NotificationSendResult,
} from "@/lib/monitoring/notifications";
import {
  createRadarFromSetup,
  firstRpcRow,
  getMonitoringClient,
  MonitoringError,
  throwDatabaseError,
  type MonitoringClient,
  type RadarRecord,
} from "@/lib/monitoring/create-radar";
import { fingerprintCandidate } from "@/lib/monitoring/fingerprint";
import { resolveRunStatus } from "@/lib/monitoring/run-status";
import { fetchMusicNewsRss } from "@/lib/sources/music-news-rss";
import { searchTavily } from "@/lib/sources/tavily";
import type {
  Candidate,
  RadarRules,
  RunResult,
  SourceOutcome,
} from "@/types/contracts";

export type RunTrigger = "baseline" | "manual" | "schedule";

export const MONITORING_ROUTE_BUDGET_MS = 55_000;

const DEFAULT_RUN_LEASE_MS = 50_000;
const LEASE_SAFETY_MARGIN_MS = 2_000;
const RECOVERY_CLEANUP_BUDGET_MS = 2_000;

type RunRecord = {
  id: string;
  radar_id: string;
  status: "running" | "success" | "failed";
  trigger: RunTrigger;
  lease_owner: string | null;
  lease_expires_at: string | null;
  source_outcomes: SourceOutcome[];
  source_success_count: number;
};

type FindingRecord = {
  id: string;
  radar_id: string;
  fingerprint: string;
  event_key: string | null;
  importance_score: number;
  first_seen_during_baseline: boolean;
  notification_eligible: boolean;
};

type PipelineRadar = RadarRecord & {
  rules: RadarRules;
  source_state?: Record<string, unknown>;
};

type SourceFetcher = () => Promise<Candidate[]>;
type CandidateEvaluator = (input: {
  rules: RadarRules;
  candidates: Candidate[];
}) => Promise<CandidateEvaluation[]>;
type PendingNotificationCreator = (
  findingId: string,
  destinationId: string,
  client?: MonitoringClient,
  context?: NotificationRunContext,
) => Promise<{ id: string; status: string }>;
type PendingNotificationSender = (
  notificationId: string,
  dependencies?: {
    client?: MonitoringClient;
    runId?: string;
    leaseOwner?: string;
    deadlineAt?: number;
    cleanupDeadlineAt?: number;
  },
) => Promise<NotificationSendResult | null>;

export type RunRadarDependencies = {
  client?: MonitoringClient;
  searchTavily?: SourceFetcher;
  fetchRss?: SourceFetcher;
  evaluate?: CandidateEvaluator;
  createNotification?: PendingNotificationCreator;
  sendNotification?: PendingNotificationSender;
  now?: () => Date;
  leaseDurationMs?: number;
  aiTimeoutMs?: number;
  outerDeadlineAt?: number;
  groq?: GroqLike;
};

type SourceBaselineState = {
  tavily: boolean;
  music_news_rss: boolean;
};

type EvaluationData = {
  relevant: boolean;
  relevance_score: number;
  importance_score: number;
  confidence: number;
  event_key: string | null;
  reason: string;
};

type SavedFinding = {
  finding: FindingRecord;
  eligible: boolean;
  evaluation: EvaluationData | null;
};

const DEFAULT_AI_TIMEOUT_MS = 20_000;
const MAX_TIMER_MS = 2_147_000_000;

function runDeadlineError(): MonitoringError {
  return new MonitoringError(
    "RUN_DEADLINE_EXCEEDED",
    "Run lease deadline was reached.",
  );
}

function assertRunDeadline(deadlineAt: number): void {
  if (Date.now() >= deadlineAt) {
    throw runDeadlineError();
  }
}

type DeadlineOperation<T> =
  | PromiseLike<T>
  | ((signal: AbortSignal) => PromiseLike<T>);

function withRunDeadline<T>(
  operation: DeadlineOperation<T>,
  deadlineAt: number,
  timeoutError = runDeadlineError(),
): Promise<T> {
  const controller = new AbortController();
  const promise =
    typeof operation === "function" ? operation(controller.signal) : operation;
  const abortablePromise = promise as PromiseLike<T> & {
    abortSignal?: (signal: AbortSignal) => PromiseLike<T>;
  };
  const observedRequest =
    typeof abortablePromise.abortSignal === "function"
      ? abortablePromise.abortSignal(controller.signal)
      : promise;
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    controller.abort();
    void Promise.resolve(observedRequest).catch(() => undefined);
    return Promise.reject(timeoutError);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  // Promise.race observes the underlying operation, but only the winner can
  // advance this pipeline; late provider results cannot change run state.
  const observedPromise = Promise.resolve(observedRequest);
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => {
        controller.abort();
        reject(timeoutError);
      },
      Math.min(remainingMs, MAX_TIMER_MS),
    );
  });

  return Promise.race([observedPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
}

export function withMonitoringDeadline<T>(
  operation: DeadlineOperation<T>,
  deadlineAt: number,
): Promise<T> {
  return withRunDeadline(operation, deadlineAt);
}

function withAiTimeout<T>(
  promise: PromiseLike<T>,
  deadlineAt: number,
  timeoutMs: number,
): Promise<T> {
  const aiDeadlineAt = Math.min(
    deadlineAt,
    Date.now() + Math.max(1, timeoutMs),
  );
  const timeoutError =
    aiDeadlineAt < deadlineAt
      ? new MonitoringError("AI_TIMEOUT", "AI evaluation exceeded its time budget.")
      : runDeadlineError();
  return withRunDeadline(promise, aiDeadlineAt, timeoutError);
}

type GroqRequestOptions = {
  signal: AbortSignal;
  timeout: number;
  maxRetries: 0;
};

type GroqCreateWithOptions = (
  this: GroqLike["chat"]["completions"],
  request: Record<string, unknown>,
  options: GroqRequestOptions,
) => Promise<Awaited<ReturnType<GroqLike["chat"]["completions"]["create"]>>>;

function createDeadlineGroq(
  groq: GroqLike,
  controller: AbortController,
  deadlineAt: number,
): GroqLike {
  const create = groq.chat.completions.create as unknown as GroqCreateWithOptions;

  return {
    chat: {
      completions: {
        create: (request) =>
          create.call(groq.chat.completions, request, {
            signal: controller.signal,
            timeout: Math.max(1, deadlineAt - Date.now()),
            maxRetries: 0,
          }),
      },
    },
  };
}

async function evaluateCandidatesWithDeadline(
  input: { rules: RadarRules; candidates: Candidate[] },
  deadlineAt: number,
  timeoutMs: number,
  groqOverride?: GroqLike,
): Promise<CandidateEvaluation[]> {
  const aiDeadlineAt = Math.min(
    deadlineAt,
    Date.now() + Math.max(1, timeoutMs),
  );
  const requestBudgetMs = aiDeadlineAt - Date.now();
  if (requestBudgetMs <= 0) {
    throw runDeadlineError();
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(
    () => controller.abort(),
    Math.min(requestBudgetMs, MAX_TIMER_MS),
  );

  try {
    const groq =
      groqOverride ??
      (new Groq({
        apiKey: parseServerEnv().GROQ_API_KEY,
        timeout: requestBudgetMs,
        maxRetries: 0,
      }) as unknown as GroqLike);
    const selectedCandidates = input.candidates.slice(0, 8);
    const promptCandidates = selectedCandidates.map((candidate) => ({
      ...candidate,
      excerpt: candidate.excerpt.slice(0, 800),
    }));
    const evaluationSchema = z
      .array(evaluateCandidateItemSchema)
      .length(selectedCandidates.length);
    const evaluations = await createStructuredOutput({
      groq: createDeadlineGroq(groq, controller, aiDeadlineAt),
      model: resolveGroqModel(),
      schemaName: "evaluate_candidates",
      jsonSchema: evaluateCandidatesJsonSchema,
      validator: evaluationSchema,
      messages: [
        {
          role: "system",
          content:
            "Score each candidate against the Radar rules. Return one JSON array item per candidate in order.",
        },
        {
          role: "user",
          content: JSON.stringify({
            rules: input.rules,
            candidates: promptCandidates,
          }),
        },
      ],
    });

    return selectedCandidates.map((candidate, index) => ({
      candidate,
      evaluation: evaluations[index],
    }));
  } finally {
    clearTimeout(abortTimer);
  }
}

function errorCode(error: unknown, fallback = "SOURCE_REQUEST_FAILED"): string {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return fallback;
}

function throwRunRpcError(
  error: { message: string; code?: string } | null,
): void {
  if (!error) {
    return;
  }

  const stableCode = error.message.match(
    /RUN_NOT_CLAIMED|FINDING_NOT_FOUND|INVALID_SOURCE_KEY/u,
  )?.[0];
  throw new MonitoringError(stableCode ?? "DATABASE_ERROR", error.message);
}

function rpcReturnedTrue(data: unknown): boolean {
  const row = firstRpcRow<unknown>(data);
  if (row === true) {
    return true;
  }

  return Boolean(
    row &&
      typeof row === "object" &&
      Object.values(row as Record<string, unknown>).some((value) => value === true),
  );
}

function asRadarRules(value: unknown): RadarRules {
  if (!value || typeof value !== "object") {
    throw new MonitoringError("RULES_INVALID", "Radar rules are invalid.");
  }

  const rules = value as Partial<RadarRules>;
  if (
    typeof rules.radarName !== "string" ||
    typeof rules.subject !== "string" ||
    !Array.isArray(rules.aliases) ||
    !Array.isArray(rules.includeTopics) ||
    !Array.isArray(rules.excludeTopics) ||
    typeof rules.searchQuery !== "string" ||
    typeof rules.importanceThreshold !== "number"
  ) {
    throw new MonitoringError("RULES_INVALID", "Radar rules are invalid.");
  }

  return {
    radarName: rules.radarName,
    subject: rules.subject,
    aliases: rules.aliases,
    includeTopics: rules.includeTopics,
    excludeTopics: rules.excludeTopics,
    searchQuery: rules.searchQuery,
    importanceThreshold: rules.importanceThreshold,
    intervalMinutes: 360,
  };
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

function asSourceOutcomes(value: unknown): SourceOutcome[] {
  return asRecordArray(value).flatMap((item) => {
    if (
      (item.source === "tavily" || item.source === "rss") &&
      typeof item.success === "boolean" &&
      typeof item.candidateCount === "number"
    ) {
      return [
        {
          source: item.source,
          success: item.success,
          candidateCount: item.candidateCount,
          errorCode: typeof item.errorCode === "string" ? item.errorCode : null,
        },
      ];
    }

    return [];
  });
}

function isRunNotClaimed(error: unknown): boolean {
  return error instanceof MonitoringError && error.code === "RUN_NOT_CLAIMED";
}

function isRunDeadlineExceeded(error: unknown): boolean {
  return (
    error instanceof MonitoringError && error.code === "RUN_DEADLINE_EXCEEDED"
  );
}

async function retryTerminalWrite<T>(
  operation: DeadlineOperation<T>,
  deadlineAt?: number,
  validate?: (result: T) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (deadlineAt !== undefined) {
        assertRunDeadline(deadlineAt);
        const result = await withRunDeadline(operation, deadlineAt);
        validate?.(result);
        return result;
      }

      const result = await (typeof operation === "function"
        ? operation(new AbortController().signal)
        : operation);
      validate?.(result);
      return result;
    } catch (error) {
      if (isRunNotClaimed(error) || isRunDeadlineExceeded(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

function isSourceBaselineComplete(
  radar: PipelineRadar,
  source: keyof SourceBaselineState,
  sourceRow: Record<string, unknown> | null,
): boolean {
  if (source === "tavily") {
    return Boolean(radar.tavily_baseline_completed_at);
  }

  if (sourceRow && typeof sourceRow.baseline_completed_at === "string") {
    return true;
  }

  const sourceState = radar.source_state?.[source];
  return Boolean(
    sourceState &&
      typeof sourceState === "object" &&
      "baselineCompletedAt" in sourceState &&
      sourceState.baselineCompletedAt,
  );
}

async function readRadar(
  client: MonitoringClient,
  radarId: string,
): Promise<PipelineRadar> {
  const result = await client
    .from("radars")
    .select(
      "id,user_id,name,original_prompt,rules,source_state,status,interval_minutes,baseline_cutoff_at,tavily_baseline_completed_at,last_checked_at,next_check_at,lease_owner,lease_expires_at",
    )
    .eq("id", radarId)
    .maybeSingle();
  throwDatabaseError(result.error);

  if (!result.data) {
    throw new MonitoringError("RADAR_NOT_FOUND", "Radar was not found.");
  }

  const row = result.data as RadarRecord;
  return {
    ...row,
    rules: asRadarRules(row.rules),
  };
}

async function readRun(
  client: MonitoringClient,
  runId: string,
  leaseOwner: string,
  now: Date,
): Promise<RunRecord> {
  const result = await client
    .from("radar_runs")
    .select(
      "id,radar_id,status,trigger,lease_owner,lease_expires_at,source_outcomes,source_success_count",
    )
    .eq("id", runId)
    .eq("status", "running")
    .eq("lease_owner", leaseOwner)
    .maybeSingle();
  throwDatabaseError(result.error);

  if (!result.data) {
    throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
  }

  const rawRun = result.data as RunRecord & {
    source_outcomes?: unknown;
    source_success_count?: unknown;
  };
  const run: RunRecord = {
    ...rawRun,
    source_outcomes: asSourceOutcomes(rawRun.source_outcomes),
    source_success_count:
      typeof rawRun.source_success_count === "number"
        ? rawRun.source_success_count
        : 0,
  };
  if (
    !run.lease_expires_at ||
    !Number.isFinite(Date.parse(run.lease_expires_at)) ||
    new Date(run.lease_expires_at) <= now
  ) {
    throw new MonitoringError("RUN_NOT_CLAIMED", "Run lease has expired.");
  }

  return run;
}

async function readSourceRow(
  client: MonitoringClient,
  radarId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client
    .from("radar_sources")
    .select("source_key,baseline_completed_at,last_error")
    .eq("radar_id", radarId)
    .eq("source_key", "music_news_rss")
    .maybeSingle();

  if (result.error?.code === "42P01") {
    return null;
  }

  throwDatabaseError(result.error);
  return (result.data as Record<string, unknown> | null) ?? null;
}

async function persistSourceOutcomes(
  client: MonitoringClient,
  runId: string,
  leaseOwner: string,
  outcomes: SourceOutcome[],
): Promise<void> {
  const result = await client.rpc("persist_run_source_outcomes", {
    p_run_id: runId,
    p_lease_owner: leaseOwner,
    p_source_outcomes: outcomes,
  });
  throwDatabaseError(result.error);
  if (!rpcReturnedTrue(result.data)) {
    throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
  }
}

async function fetchSource(
  source: "tavily" | "rss",
  fetcher: SourceFetcher,
  persistOutcomes: (outcomes: SourceOutcome[]) => Promise<void>,
  outcomes: SourceOutcome[],
  internalErrors: Array<Record<string, string>>,
): Promise<Candidate[]> {
  let candidates: Candidate[];

  try {
    candidates = await fetcher();
  } catch (error) {
    const code = errorCode(error);
    outcomes.push({
      source,
      success: false,
      candidateCount: 0,
      errorCode: code,
    });
    internalErrors.push({ source, errorCode: code });
    await persistOutcomes([...outcomes]);
    return [];
  }

  outcomes.push({
    source,
    success: true,
    candidateCount: candidates.length,
    errorCode: null,
  });
  await persistOutcomes([...outcomes]);
  return candidates;
}

function candidateKey(candidate: Candidate): string {
  return fingerprintCandidate(candidate);
}

function buildEvaluationMap(
  evaluations: CandidateEvaluation[],
): Map<string, EvaluationData> {
  return new Map(
    evaluations.map(({ candidate, evaluation }) => [
      candidateKey(candidate),
      evaluation,
    ]),
  );
}

async function saveFinding(
  client: MonitoringClient,
  run: RunRecord,
  radar: PipelineRadar,
  candidate: Candidate,
  evaluation: EvaluationData | null,
  sourceWasBaselined: boolean,
  leaseOwner: string,
  deadlineAt: number,
): Promise<SavedFinding> {
  assertRunDeadline(deadlineAt);
  const fingerprint = candidateKey(candidate);
  const eventKey = evaluation?.event_key ?? null;
  const relevant = evaluation?.relevant ?? false;
  const importanceScore = evaluation?.importance_score ?? 0;
  const result = await client.rpc("persist_run_finding", {
    p_run_id: run.id,
    p_lease_owner: leaseOwner,
    p_source_type: candidate.sourceType,
    p_source_domain: candidate.sourceDomain,
    p_source_url: candidate.sourceUrl,
    p_title: candidate.title,
    p_summary: candidate.excerpt,
    p_published_at: candidate.publishedAt,
    p_fingerprint: fingerprint,
    p_event_key: eventKey,
    p_source_was_baselined: sourceWasBaselined,
    p_relevant: relevant,
    p_relevance_score: evaluation?.relevance_score ?? 0,
    p_confidence: evaluation?.confidence ?? 0,
    p_importance_score: importanceScore,
    p_match_reason: evaluation?.reason ?? "evaluation_failed",
  });
  throwRunRpcError(result.error);

  const row = firstRpcRow<{
    finding_id: string;
    radar_id: string;
    fingerprint: string;
    event_key: string | null;
    importance_score: number;
    first_seen_during_baseline: boolean;
    notification_eligible: boolean;
  }>(result.data);
  if (!row?.finding_id) {
    throw new MonitoringError(
      "DATABASE_ERROR",
      "Finding persistence returned no row.",
    );
  }

  const finding: FindingRecord = {
    id: row.finding_id,
    radar_id: row.radar_id,
    fingerprint: row.fingerprint,
    event_key: row.event_key,
    importance_score: row.importance_score,
    first_seen_during_baseline: row.first_seen_during_baseline,
    notification_eligible: row.notification_eligible,
  };

  return {
    finding,
    eligible: Boolean(
      finding.notification_eligible &&
        !finding.first_seen_during_baseline &&
        relevant &&
        importanceScore >= radar.rules.importanceThreshold,
    ),
    evaluation,
  };
}

async function markSourceBaselineComplete(
  client: MonitoringClient,
  run: RunRecord,
  radar: PipelineRadar,
  successfulSources: Set<"tavily" | "rss">,
  leaseOwner: string,
  now: Date,
  deadlineAt: number,
): Promise<void> {
  if (successfulSources.has("tavily")) {
    assertRunDeadline(deadlineAt);
    const result = await client.rpc("mark_source_baseline_for_run", {
      p_run_id: run.id,
      p_lease_owner: leaseOwner,
      p_source_key: "tavily",
      p_completed_at: radar.tavily_baseline_completed_at ?? now.toISOString(),
    });
    throwRunRpcError(result.error);
    if (!rpcReturnedTrue(result.data)) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  }

  if (successfulSources.has("rss")) {
    assertRunDeadline(deadlineAt);
    const result = await client.rpc("mark_source_baseline_for_run", {
      p_run_id: run.id,
      p_lease_owner: leaseOwner,
      p_source_key: "music_news_rss",
      p_completed_at: now.toISOString(),
    });
    throwRunRpcError(result.error);
    if (!rpcReturnedTrue(result.data)) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  }
}

async function readTelegramDestination(
  client: MonitoringClient,
  userId: string,
): Promise<string | null> {
  const result = await client
    .from("telegram_connections")
    .select("chat_id")
    .eq("user_id", userId)
    .maybeSingle();
  throwDatabaseError(result.error);

  if (!result.data || !("chat_id" in (result.data as object))) {
    return null;
  }

  return String((result.data as { chat_id: string | number }).chat_id);
}

async function finalizeRun(
  client: MonitoringClient,
  run: RunRecord,
  leaseOwner: string,
  result: {
    status: "success" | "failed";
    candidateCount: number;
    relevantCount: number;
    notificationCount: number;
    sourceOutcomes: SourceOutcome[];
    internalErrors: Array<Record<string, string>>;
  },
  deadlineAt: number,
): Promise<RunResult> {
  await retryTerminalWrite(
    () =>
      client.rpc("finalize_run_for_owner", {
        p_run_id: run.id,
        p_lease_owner: leaseOwner,
        p_status: result.status,
        p_candidate_count: result.candidateCount,
        p_relevant_count: result.relevantCount,
        p_notification_count: result.notificationCount,
        p_source_outcomes: result.sourceOutcomes,
        p_internal_errors: result.internalErrors,
      }),
    deadlineAt,
    (resultRow) => {
      throwRunRpcError(resultRow.error);
      if (!rpcReturnedTrue(resultRow.data)) {
        throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
      }
    },
  );

  return {
    runId: run.id,
    status: result.status,
    candidateCount: result.candidateCount,
    relevantCount: result.relevantCount,
    notificationCount: result.notificationCount,
  };
}

async function recoverClaimedRun(
  client: MonitoringClient,
  run: RunRecord,
  leaseOwner: string,
  cause: unknown,
  cleanupDeadlineAt = Date.now() + RECOVERY_CLEANUP_BUDGET_MS,
): Promise<void> {
  await retryTerminalWrite(
    () =>
      client.rpc("recover_run_for_owner", {
        p_run_id: run.id,
        p_lease_owner: leaseOwner,
        p_error_code: errorCode(cause, "RUN_RECOVERY_FAILED"),
      }),
    cleanupDeadlineAt,
    (resultRow) => {
      throwRunRpcError(resultRow.error);
      if (!rpcReturnedTrue(resultRow.data)) {
        throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
      }
    },
  );
}

export async function runRadar(
  radarId: string,
  trigger: RunTrigger,
  dependencies: RunRadarDependencies = {},
): Promise<RunResult> {
  const db = getMonitoringClient(dependencies.client);
  const outerDeadlineAt =
    dependencies.outerDeadlineAt ?? Date.now() + MONITORING_ROUTE_BUDGET_MS;
  const radarResult = await withRunDeadline(
    db
      .from("radars")
      .select("id,user_id")
      .eq("id", radarId)
      .maybeSingle(),
    outerDeadlineAt,
  );
  throwDatabaseError(radarResult.error);

  if (!radarResult.data) {
    throw new MonitoringError("RADAR_NOT_FOUND", "Radar was not found.");
  }

  const ownerId = String((radarResult.data as { user_id: string }).user_id);
  const leaseOwner = randomUUID();
  const leaseStartedAt = Date.now();
  const leaseExpiresAtMs = Math.min(
    leaseStartedAt +
      Math.max(1, dependencies.leaseDurationMs ?? DEFAULT_RUN_LEASE_MS),
    outerDeadlineAt - LEASE_SAFETY_MARGIN_MS,
  );
  if (leaseExpiresAtMs <= leaseStartedAt) {
    throw runDeadlineError();
  }
  const leaseExpiresAt = new Date(leaseExpiresAtMs).toISOString();
  const claimResult = await withRunDeadline(
    db.rpc("claim_radar_run", {
      p_radar_id: radarId,
      p_user_id: ownerId,
      p_trigger: trigger,
      p_lease_owner: leaseOwner,
      p_lease_expires_at: leaseExpiresAt,
    }),
    outerDeadlineAt,
  );
  throwDatabaseError(claimResult.error);

  const claim = firstRpcRow<{
    run_id: string | null;
    lease_owner: string | null;
    error_code: string | null;
  }>(claimResult.data);

  if (!claim?.run_id) {
    throw new MonitoringError(
      claim?.error_code ?? "RADAR_ALREADY_LEASED",
      claim?.error_code ?? "Radar run could not be claimed.",
    );
  }

  return withRunDeadline(
    executeClaimedRun(claim.run_id, claim.lease_owner ?? leaseOwner, {
      ...dependencies,
      outerDeadlineAt,
    }),
    outerDeadlineAt,
  );
}

export async function executeClaimedRun(
  runId: string,
  leaseOwner: string,
  dependencies: RunRadarDependencies = {},
): Promise<RunResult> {
  const db = getMonitoringClient(dependencies.client);
  const outerDeadlineAt =
    dependencies.outerDeadlineAt ?? Date.now() + MONITORING_ROUTE_BUDGET_MS;
  const runStartedAt = dependencies.now?.() ?? new Date();
  const run = await withRunDeadline(
    readRun(db, runId, leaseOwner, runStartedAt),
    outerDeadlineAt,
  );
  const leaseDeadlineAt = Date.parse(run.lease_expires_at!);
  const deadlineAt = Math.min(outerDeadlineAt, leaseDeadlineAt) - LEASE_SAFETY_MARGIN_MS;
  let radar: PipelineRadar | undefined;

  try {
    assertRunDeadline(deadlineAt);
    radar = await withRunDeadline(readRadar(db, run.radar_id), deadlineAt);
    const sourceRow = await withRunDeadline(
      readSourceRow(db, radar.id),
      deadlineAt,
    );
    const sourceOutcomes: SourceOutcome[] = [];
    const internalErrors: Array<Record<string, string>> = [];
    const currentTime = () => dependencies.now?.() ?? new Date();
    const tavilyFetcher =
      dependencies.searchTavily ??
      (() => searchTavily({ query: radar!.rules.searchQuery }));
    const rssFetcher = dependencies.fetchRss ?? (() => fetchMusicNewsRss());
    let sourcePersistence = Promise.resolve();
    const persistOutcomes = (snapshot: SourceOutcome[]) => {
      sourcePersistence = sourcePersistence.then(() => {
        assertRunDeadline(deadlineAt);
        return withRunDeadline(
          persistSourceOutcomes(db, run.id, leaseOwner, snapshot),
          deadlineAt,
        );
      });
      return sourcePersistence;
    };

    const [tavilyCandidates, rssCandidates] = await withRunDeadline(
      Promise.all([
        fetchSource(
          "tavily",
          tavilyFetcher,
          persistOutcomes,
          sourceOutcomes,
          internalErrors,
        ),
        fetchSource(
          "rss",
          rssFetcher,
          persistOutcomes,
          sourceOutcomes,
          internalErrors,
        ),
      ]),
      deadlineAt,
    );
    await withRunDeadline(sourcePersistence, deadlineAt);
    assertRunDeadline(deadlineAt);
    const candidates = [...tavilyCandidates, ...rssCandidates];
    const uniqueCandidates = Array.from(
      new Map(candidates.map((candidate) => [candidateKey(candidate), candidate])).values(),
    );
    const sourceBaselineState: SourceBaselineState = {
      tavily: isSourceBaselineComplete(radar, "tavily", null),
      music_news_rss: isSourceBaselineComplete(radar, "music_news_rss", sourceRow),
    };
    let evaluations: CandidateEvaluation[] = [];
    let aiFailed = false;

    assertRunDeadline(deadlineAt);
    if (uniqueCandidates.length > 0) {
      try {
        const aiTimeoutMs = dependencies.aiTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
        const evaluate =
          dependencies.evaluate ??
          ((input: { rules: RadarRules; candidates: Candidate[] }) =>
            evaluateCandidatesWithDeadline(
              input,
              deadlineAt,
              aiTimeoutMs,
              dependencies.groq,
            ));
        evaluations = await withAiTimeout(
          evaluate({
            rules: radar.rules,
            candidates: uniqueCandidates.slice(0, 8),
          }),
          deadlineAt,
          aiTimeoutMs,
        );
      } catch (error) {
        if (errorCode(error) === "RUN_DEADLINE_EXCEEDED") {
          throw error;
        }
        aiFailed = true;
        internalErrors.push({
          source: "ai",
          errorCode: errorCode(error, "AI_EVALUATION_FAILED"),
        });
      }
    }

    assertRunDeadline(deadlineAt);
    const evaluationMap = buildEvaluationMap(evaluations);
    const savedFindings: SavedFinding[] = [];
    const successfulSources = new Set<"tavily" | "rss">(
      sourceOutcomes
        .filter((outcome) => outcome.success)
        .map((outcome) => outcome.source),
    );

    for (const candidate of uniqueCandidates) {
      assertRunDeadline(deadlineAt);
      const sourceKey: keyof SourceBaselineState =
        candidate.sourceType === "tavily" ? "tavily" : "music_news_rss";
      const saved = await withRunDeadline(
        saveFinding(
          db,
          run,
          radar,
          candidate,
          evaluationMap.get(candidateKey(candidate)) ?? null,
          sourceBaselineState[sourceKey],
          leaseOwner,
          deadlineAt,
        ),
        deadlineAt,
      );
      savedFindings.push(saved);
    }

    await withRunDeadline(
      markSourceBaselineComplete(
        db,
        run,
        radar,
        successfulSources,
        leaseOwner,
        currentTime(),
        deadlineAt,
      ),
      deadlineAt,
    );

    let telegramFailed = false;
    let notificationCount = 0;
    const destinationId = await withRunDeadline(
      readTelegramDestination(db, radar.user_id),
      deadlineAt,
    );
    const notificationFindings = new Map<string, SavedFinding>();
    for (const saved of savedFindings.filter((item) => item.eligible && !aiFailed)) {
      const key = saved.finding.event_key?.trim() || saved.finding.fingerprint;
      const existing = notificationFindings.get(key);
      if (
        !existing ||
        saved.finding.importance_score > existing.finding.importance_score
      ) {
        notificationFindings.set(key, saved);
      }
    }

    if (destinationId) {
      const createNotification = dependencies.createNotification ??
        ((findingId: string, destination: string, client?: MonitoringClient) =>
          defaultCreatePendingNotificationForRun(
            findingId,
            destination,
            { runId: run.id, leaseOwner },
            client,
          ));
      const sendNotification =
        dependencies.sendNotification ?? defaultSendPendingNotification;
      const notificationCleanupDeadlineAt = Math.min(
        outerDeadlineAt,
        leaseDeadlineAt,
      );

      const notificationResults = await withRunDeadline(
        Promise.all(
          [...notificationFindings.values()].map(async (saved) => {
            assertRunDeadline(deadlineAt);
            const notification = await withRunDeadline(
              createNotification(
                saved.finding.id,
                destinationId,
                db,
                { runId: run.id, leaseOwner },
              ),
              deadlineAt,
            );
            if (notification.status !== "pending") {
              return null;
            }

            const sendResult = await withRunDeadline(
              sendNotification(notification.id, {
                client: db,
                runId: run.id,
                leaseOwner,
                deadlineAt,
                cleanupDeadlineAt: notificationCleanupDeadlineAt,
              }),
              notificationCleanupDeadlineAt,
            );
            if (sendResult?.errorCode === "RUN_DEADLINE_EXCEEDED") {
              throw runDeadlineError();
            }
            return sendResult;
          }),
        ),
        notificationCleanupDeadlineAt,
      );

      for (const sendResult of notificationResults) {
        if (sendResult?.status === "sent") {
          notificationCount += 1;
        }
        if (sendResult?.status === "failed" || sendResult?.status === "unknown") {
          telegramFailed = true;
          internalErrors.push({
            source: "telegram",
            errorCode: sendResult.errorCode ?? "TELEGRAM_DELIVERY_FAILED",
          });
        }
      }
    } else if (notificationFindings.size > 0) {
      telegramFailed = true;
      internalErrors.push({ source: "telegram", errorCode: "TELEGRAM_NOT_CONNECTED" });
    }

    const status = resolveRunStatus(sourceOutcomes, { aiFailed, telegramFailed });
    assertRunDeadline(deadlineAt);
    return await withRunDeadline(
      finalizeRun(
        db,
        run,
        leaseOwner,
        {
          status,
          candidateCount: candidates.length,
          relevantCount: savedFindings.filter((item) => item.evaluation?.relevant).length,
          notificationCount,
          sourceOutcomes,
          internalErrors,
        },
        deadlineAt,
      ),
      deadlineAt,
    );
  } catch (error) {
    const recoveryDeadlineAt = Math.min(
      outerDeadlineAt,
      leaseDeadlineAt,
      Date.now() + RECOVERY_CLEANUP_BUDGET_MS,
    );
    try {
      await recoverClaimedRun(
        db,
        run,
        leaseOwner,
        error,
        recoveryDeadlineAt,
      );
    } catch {
      // Preserve the pipeline failure when best-effort terminal cleanup runs
      // out of budget or loses the lease itself.
    }
    throw error;
  }
}

export { createRadarFromSetup };
