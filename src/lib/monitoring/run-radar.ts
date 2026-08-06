import { randomUUID } from "node:crypto";

import { evaluateCandidates, type CandidateEvaluation } from "@/lib/ai/evaluate-candidates";
import {
  createPendingNotification as defaultCreatePendingNotification,
  sendPendingNotification as defaultSendPendingNotification,
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
) => Promise<{ id: string; status: string }>;
type PendingNotificationSender = (
  notificationId: string,
  dependencies?: { client?: MonitoringClient },
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

function errorCode(error: unknown, fallback = "SOURCE_REQUEST_FAILED"): string {
  if (error && typeof error === "object" && "code" in error) {
    return String(error.code);
  }

  return fallback;
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

async function retryTerminalWrite<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isRunNotClaimed(error)) {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutError: Error): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(timeoutError), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
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
  if (run.lease_expires_at && new Date(run.lease_expires_at) <= now) {
    throw new MonitoringError("RUN_NOT_CLAIMED", "Run lease has expired.");
  }

  return run;
}

async function assertClaimedRun(
  client: MonitoringClient,
  runId: string,
  leaseOwner: string,
  now: Date,
): Promise<void> {
  await readRun(client, runId, leaseOwner, now);
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
  const result = await client
    .from("radar_runs")
    .update({
      source_outcomes: outcomes,
      source_success_count: outcomes.filter((outcome) => outcome.success).length,
    })
    .eq("id", runId)
    .eq("status", "running")
    .eq("lease_owner", leaseOwner)
    .select("id")
    .maybeSingle();
  throwDatabaseError(result.error);
  if (!result.data) {
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

async function readExistingFindings(
  client: MonitoringClient,
  radarId: string,
): Promise<FindingRecord[]> {
  const result = await client
    .from("findings")
    .select(
      "id,radar_id,fingerprint,event_key,importance_score,first_seen_during_baseline,notification_eligible",
    )
    .eq("radar_id", radarId);
  throwDatabaseError(result.error);
  return asRecordArray(result.data) as unknown as FindingRecord[];
}

async function saveFinding(
  client: MonitoringClient,
  run: RunRecord,
  radar: PipelineRadar,
  candidate: Candidate,
  evaluation: EvaluationData | null,
  sourceWasBaselined: boolean,
  existingFindings: FindingRecord[],
  leaseOwner: string,
  now: Date,
): Promise<SavedFinding> {
  await assertClaimedRun(client, run.id, leaseOwner, now);
  const fingerprint = candidateKey(candidate);
  const eventKey = evaluation?.event_key ?? null;
  const existingByFingerprint = existingFindings.find(
    (finding) => finding.fingerprint === fingerprint,
  );
  const existing = existingByFingerprint;
  const firstSeenDuringBaseline = existing?.first_seen_during_baseline ?? !sourceWasBaselined;
  const relevant = evaluation?.relevant ?? false;
  const importanceScore = evaluation?.importance_score ?? 0;
  const eligible =
    !firstSeenDuringBaseline &&
    relevant &&
    importanceScore >= radar.rules.importanceThreshold;
  const values = {
    radar_id: radar.id,
    first_run_id: existing ? undefined : run.id,
    source_type: candidate.sourceType,
    source_domain: candidate.sourceDomain,
    source_url: candidate.sourceUrl,
    canonical_url: candidate.sourceUrl,
    fingerprint,
    event_key: eventKey,
    title: candidate.title,
    summary: candidate.excerpt,
    published_at: candidate.publishedAt,
    last_seen_at: new Date().toISOString(),
    relevance_score: evaluation?.relevance_score ?? 0,
    importance_score: importanceScore,
    match_reason: evaluation?.reason ?? "evaluation_failed",
    notification_eligible: existing?.notification_eligible || eligible,
    first_seen_during_baseline: firstSeenDuringBaseline,
  };

  let finding: FindingRecord;

  if (existing) {
    const updateResult = await client
      .from("findings")
      .update({
        last_seen_at: values.last_seen_at,
        event_key: existing.event_key ?? values.event_key,
        relevance_score: values.relevance_score,
        importance_score: values.importance_score,
        match_reason: values.match_reason,
        notification_eligible: values.notification_eligible,
      })
      .eq("id", existing.id)
      .select(
        "id,radar_id,fingerprint,event_key,importance_score,first_seen_during_baseline,notification_eligible",
      )
      .single();
    throwDatabaseError(updateResult.error);
    if (!updateResult.data) {
      throw new MonitoringError("DATABASE_ERROR", "Finding update returned no row.");
    }
    finding = updateResult.data as FindingRecord;
  } else {
    const insertResult = await client
      .from("findings")
      .insert(values)
      .select(
        "id,radar_id,fingerprint,event_key,importance_score,first_seen_during_baseline,notification_eligible",
      )
      .single();
    throwDatabaseError(insertResult.error);
    if (!insertResult.data) {
      throw new MonitoringError("DATABASE_ERROR", "Finding insert returned no row.");
    }
    finding = insertResult.data as FindingRecord;
  }

  await assertClaimedRun(client, run.id, leaseOwner, now);
  const runFindingResult = await client
    .from("run_findings")
    .upsert(
      {
        run_id: run.id,
        finding_id: finding.id,
        relevant,
        relevance_score: evaluation?.relevance_score ?? 0,
        confidence: evaluation?.confidence ?? 0,
        importance_score: importanceScore,
        decision: evaluation ? (relevant ? "relevant" : "not_relevant") : "evaluation_failed",
        explanation: evaluation?.reason ?? "evaluation_failed",
      },
      { onConflict: "run_id,finding_id" },
    );
  throwDatabaseError(runFindingResult.error);

  return {
    finding,
    eligible: Boolean(finding.notification_eligible && eligible),
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
): Promise<void> {
  if (successfulSources.has("tavily")) {
    await assertClaimedRun(client, run.id, leaseOwner, now);
    const result = await client
      .from("radars")
      .update({
        tavily_baseline_completed_at: radar.tavily_baseline_completed_at ?? now.toISOString(),
      })
      .eq("id", radar.id)
      .eq("lease_owner", leaseOwner)
      .select("id")
      .maybeSingle();
    throwDatabaseError(result.error);
    if (!result.data) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  }

  if (successfulSources.has("rss")) {
    await assertClaimedRun(client, run.id, leaseOwner, now);
    const result = await client
      .from("radar_sources")
      .update({
        baseline_completed_at: now.toISOString(),
        last_error: null,
        updated_at: now.toISOString(),
      })
      .eq("radar_id", radar.id)
      .eq("source_key", "music_news_rss")
      .select("radar_id")
      .maybeSingle();

    if (result.error?.code !== "42P01") {
      throwDatabaseError(result.error);
      if (!result.data) {
        throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
      }
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
  radar: PipelineRadar,
  leaseOwner: string,
  result: {
    status: "success" | "failed";
    candidateCount: number;
    relevantCount: number;
    notificationCount: number;
    sourceOutcomes: SourceOutcome[];
    internalErrors: Array<Record<string, string>>;
  },
  now: Date,
): Promise<RunResult> {
  const finishedAt = now.toISOString();
  await retryTerminalWrite(async () => {
    const runUpdate = await client
      .from("radar_runs")
      .update({
        status: result.status,
        finished_at: finishedAt,
        candidate_count: result.candidateCount,
        relevant_count: result.relevantCount,
        notification_count: result.notificationCount,
        source_outcomes: result.sourceOutcomes,
        source_success_count: result.sourceOutcomes.filter((outcome) => outcome.success).length,
        internal_errors: result.internalErrors,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", run.id)
      .eq("status", "running")
      .eq("lease_owner", leaseOwner)
      .select("id")
      .maybeSingle();
    throwDatabaseError(runUpdate.error);
    if (!runUpdate.data) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  });

  const nextCheckAt = new Date(
    now.getTime() +
      (result.status === "failed" ? 15 * 60_000 : radar.interval_minutes * 60_000),
  ).toISOString();
  await retryTerminalWrite(async () => {
    const radarUpdate = await client
      .from("radars")
      .update({
        last_checked_at: finishedAt,
        next_check_at: nextCheckAt,
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", radar.id)
      .eq("lease_owner", leaseOwner)
      .select("id")
      .maybeSingle();
    throwDatabaseError(radarUpdate.error);
    if (!radarUpdate.data) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  });

  return {
    runId: run.id,
    status: result.status,
    candidateCount: result.candidateCount,
    relevantCount: result.relevantCount,
    notificationCount: result.notificationCount,
  };
}

type RecoveryRun = {
  id: string;
  radar_id: string;
  source_outcomes: unknown;
  source_success_count: unknown;
};

async function readRecoveryRun(
  client: MonitoringClient,
  runId: string,
  leaseOwner: string,
): Promise<RecoveryRun> {
  const result = await client
    .from("radar_runs")
    .select("id,radar_id,source_outcomes,source_success_count")
    .eq("id", runId)
    .eq("status", "running")
    .eq("lease_owner", leaseOwner)
    .maybeSingle();
  throwDatabaseError(result.error);

  if (!result.data) {
    throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
  }

  return result.data as RecoveryRun;
}

async function recoverClaimedRun(
  client: MonitoringClient,
  run: RunRecord,
  leaseOwner: string,
  cause: unknown,
  now: Date,
  intervalMinutes = 360,
): Promise<void> {
  const persistedRun = await readRecoveryRun(client, run.id, leaseOwner);
  const sourceOutcomes = asSourceOutcomes(persistedRun.source_outcomes);
  const persistedSuccessCount =
    typeof persistedRun.source_success_count === "number"
      ? persistedRun.source_success_count
      : 0;
  const status =
    persistedSuccessCount >= 1 || sourceOutcomes.some((outcome) => outcome.success)
      ? "success"
      : "failed";
  const finishedAt = now.toISOString();

  await retryTerminalWrite(async () => {
    const runUpdate = await client
      .from("radar_runs")
      .update({
        status,
        finished_at: finishedAt,
        source_outcomes: sourceOutcomes,
        source_success_count: Math.max(
          persistedSuccessCount,
          sourceOutcomes.filter((outcome) => outcome.success).length,
        ),
        internal_errors: [
          {
            source: "runtime",
            errorCode: errorCode(cause, "RUN_RECOVERY_FAILED"),
          },
        ],
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", run.id)
      .eq("status", "running")
      .eq("lease_owner", leaseOwner)
      .select("id")
      .maybeSingle();
    throwDatabaseError(runUpdate.error);
    if (!runUpdate.data) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  });

  await retryTerminalWrite(async () => {
    const radarUpdate = await client
      .from("radars")
      .update({
        last_checked_at: finishedAt,
        next_check_at: new Date(
          now.getTime() +
            (status === "failed" ? 15 * 60_000 : intervalMinutes * 60_000),
        ).toISOString(),
        lease_owner: null,
        lease_expires_at: null,
      })
      .eq("id", run.radar_id)
      .eq("lease_owner", leaseOwner)
      .select("id")
      .maybeSingle();
    throwDatabaseError(radarUpdate.error);
    if (!radarUpdate.data) {
      throw new MonitoringError("RUN_NOT_CLAIMED", "Run is no longer claimed.");
    }
  });
}

export async function runRadar(
  radarId: string,
  trigger: RunTrigger,
  dependencies: RunRadarDependencies = {},
): Promise<RunResult> {
  const db = getMonitoringClient(dependencies.client);
  const radarResult = await db
    .from("radars")
    .select("id,user_id")
    .eq("id", radarId)
    .maybeSingle();
  throwDatabaseError(radarResult.error);

  if (!radarResult.data) {
    throw new MonitoringError("RADAR_NOT_FOUND", "Radar was not found.");
  }

  const ownerId = String((radarResult.data as { user_id: string }).user_id);
  const leaseOwner = randomUUID();
  const leaseExpiresAt = new Date(
    (dependencies.now?.() ?? new Date()).getTime() +
      (dependencies.leaseDurationMs ?? 60_000),
  ).toISOString();
  const claimResult = await db.rpc("claim_radar_run", {
    p_radar_id: radarId,
    p_user_id: ownerId,
    p_trigger: trigger,
    p_lease_owner: leaseOwner,
    p_lease_expires_at: leaseExpiresAt,
  });
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

  return executeClaimedRun(claim.run_id, claim.lease_owner ?? leaseOwner, dependencies);
}

export async function executeClaimedRun(
  runId: string,
  leaseOwner: string,
  dependencies: RunRadarDependencies = {},
): Promise<RunResult> {
  const db = getMonitoringClient(dependencies.client);
  const runStartedAt = dependencies.now?.() ?? new Date();
  const run = await readRun(db, runId, leaseOwner, runStartedAt);
  let radar: PipelineRadar | undefined;

  try {
    radar = await readRadar(db, run.radar_id);
    const sourceRow = await readSourceRow(db, radar.id);
    const sourceOutcomes: SourceOutcome[] = [];
    const internalErrors: Array<Record<string, string>> = [];
    const currentTime = () => dependencies.now?.() ?? new Date();
    const tavilyFetcher =
      dependencies.searchTavily ??
      (() => searchTavily({ query: radar!.rules.searchQuery }));
    const rssFetcher = dependencies.fetchRss ?? (() => fetchMusicNewsRss());
    let sourcePersistence = Promise.resolve();
    const persistOutcomes = (snapshot: SourceOutcome[]) => {
      sourcePersistence = sourcePersistence.then(() =>
        persistSourceOutcomes(db, run.id, leaseOwner, snapshot),
      );
      return sourcePersistence;
    };

    const [tavilyCandidates, rssCandidates] = await Promise.all([
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
    ]);
    await sourcePersistence;
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

    await assertClaimedRun(db, run.id, leaseOwner, currentTime());
    if (uniqueCandidates.length > 0) {
      try {
        const evaluate =
          dependencies.evaluate ??
          ((input: { rules: RadarRules; candidates: Candidate[] }) =>
            evaluateCandidates(input));
        evaluations = await withTimeout(
          evaluate({
            rules: radar.rules,
            candidates: uniqueCandidates.slice(0, 8),
          }),
          Math.max(1, dependencies.aiTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS),
          new MonitoringError("AI_TIMEOUT", "AI evaluation exceeded its time budget."),
        );
      } catch (error) {
        aiFailed = true;
        internalErrors.push({
          source: "ai",
          errorCode: errorCode(error, "AI_EVALUATION_FAILED"),
        });
      }
    }

    await assertClaimedRun(db, run.id, leaseOwner, currentTime());
    const evaluationMap = buildEvaluationMap(evaluations);
    const existingFindings = await readExistingFindings(db, radar.id);
    const savedFindings: SavedFinding[] = [];
    const successfulSources = new Set<"tavily" | "rss">(
      sourceOutcomes
        .filter((outcome) => outcome.success)
        .map((outcome) => outcome.source),
    );

    for (const candidate of uniqueCandidates) {
      const sourceKey: keyof SourceBaselineState =
        candidate.sourceType === "tavily" ? "tavily" : "music_news_rss";
      const saved = await saveFinding(
        db,
        run,
        radar,
        candidate,
        evaluationMap.get(candidateKey(candidate)) ?? null,
        sourceBaselineState[sourceKey],
        existingFindings,
        leaseOwner,
        currentTime(),
      );
      existingFindings.push(saved.finding);
      savedFindings.push(saved);
    }

    await markSourceBaselineComplete(
      db,
      run,
      radar,
      successfulSources,
      leaseOwner,
      currentTime(),
    );

    let telegramFailed = false;
    let notificationCount = 0;
    const destinationId = await readTelegramDestination(db, radar.user_id);
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
      const createNotification =
        dependencies.createNotification ?? defaultCreatePendingNotification;
      const sendNotification =
        dependencies.sendNotification ?? defaultSendPendingNotification;

      for (const saved of notificationFindings.values()) {
        await assertClaimedRun(db, run.id, leaseOwner, currentTime());
        const notification = await createNotification(
          saved.finding.id,
          destinationId,
          db,
        );
        if (notification.status !== "pending") {
          continue;
        }

        await assertClaimedRun(db, run.id, leaseOwner, currentTime());
        const sendResult = await sendNotification(notification.id, { client: db });
        await assertClaimedRun(db, run.id, leaseOwner, currentTime());
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
    return finalizeRun(
      db,
      run,
      radar,
      leaseOwner,
      {
        status,
        candidateCount: candidates.length,
        relevantCount: savedFindings.filter((item) => item.evaluation?.relevant).length,
        notificationCount,
        sourceOutcomes,
        internalErrors,
      },
      currentTime(),
    );
  } catch (error) {
    await recoverClaimedRun(
      db,
      run,
      leaseOwner,
      error,
      dependencies.now?.() ?? new Date(),
      radar?.interval_minutes,
    );
    throw error;
  }
}

export { createRadarFromSetup };
