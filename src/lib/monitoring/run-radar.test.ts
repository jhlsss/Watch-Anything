import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(),
}));

import {
  fingerprintCandidate,
  fingerprintWithoutStableUrl,
} from "@/lib/monitoring/fingerprint";
import { createPendingNotification, sendPendingNotification } from "@/lib/monitoring/notifications";
import type {
  DatabaseResult,
  MonitoringClient,
  MonitoringQuery,
} from "@/lib/monitoring/create-radar";
import { createRadarFromSetup } from "@/lib/monitoring/create-radar";
import {
  executeClaimedRun,
  runRadar,
  withMonitoringDeadline,
} from "@/lib/monitoring/run-radar";
import type { AiLike } from "@/lib/ai/schemas";
import type { Candidate, RadarRules } from "@/types/contracts";
import { resolveRunStatus } from "@/lib/monitoring/run-status";
import type { SourceOutcome } from "@/types/contracts";

const success: SourceOutcome = {
  source: "tavily",
  success: true,
  candidateCount: 1,
  errorCode: null,
};

const failure: SourceOutcome = {
  source: "rss",
  success: false,
  candidateCount: 0,
  errorCode: "RSS_TIMEOUT",
};

describe("resolveRunStatus", () => {
  it("marks a run successful when at least one source succeeds", () => {
    expect(resolveRunStatus([success, failure])).toBe("success");
  });

  it("marks a run failed when every source fails", () => {
    expect(resolveRunStatus([failure, { ...failure, source: "tavily" }])).toBe(
      "failed",
    );
  });

  it("does not turn a source-successful run into failed for AI or Telegram errors", () => {
    expect(resolveRunStatus([success], { aiFailed: true })).toBe("success");
    expect(resolveRunStatus([success], { telegramFailed: true })).toBe("success");
  });
});

describe("fingerprintCandidate", () => {
  it("ignores utm tracking parameters when fingerprinting a stable URL", () => {
    const base = {
      sourceDomain: "example.com",
      title: "A new event",
    };

    expect(
      fingerprintCandidate({
        ...base,
        sourceUrl: "https://example.com/news?id=42",
      }),
    ).toBe(
      fingerprintCandidate({
        ...base,
        sourceUrl:
          "https://example.com/news?utm_source=newsletter&id=42&utm_medium=email",
      }),
    );
  });

  it("uses normalized title and source domain when no stable URL exists", () => {
    expect(
      fingerprintWithoutStableUrl({
        title: "  New   Event ",
        sourceDomain: "WWW.Example.com",
      }),
    ).toBe(
      fingerprintWithoutStableUrl({
        title: "new event",
        sourceDomain: "example.com",
      }),
    );
  });
});

function queryFor(
  result: { data: unknown; error: null | { code?: string; message: string } },
  onFilter?: (filters: Record<string, unknown>) => typeof result,
  onOperation?: (operation: string, payload: unknown) => void,
  delayMs = 0,
) {
  const filters: Record<string, unknown> = {};
  let operationPayload: unknown;
  let operationNotified = false;
  const resolveResult = () => {
    const resolved = onFilter ? onFilter(filters) : result;
    if (!operationNotified && operationPayload !== undefined) {
      operationNotified = true;
      onOperation?.("update", operationPayload);
    }
    return resolved;
  };
  const resolvePromise = () => {
    if (delayMs <= 0) {
      return Promise.resolve(resolveResult());
    }
    return new Promise<typeof result>((resolve) => {
      setTimeout(() => resolve(resolveResult()), delayMs);
    });
  };
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    neq: () => query,
    gt: () => query,
    gte: () => query,
    lt: () => query,
    lte: () => query,
    in: () => query,
    order: () => query,
    limit: () => query,
    insert: () => query,
    update: (values: unknown) => {
      operationPayload = values;
      return query;
    },
    upsert: () => query,
    maybeSingle: () => resolvePromise(),
    single: () => resolvePromise(),
    then: (
      onFulfilled?: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => resolvePromise().then(onFulfilled, onRejected),
  };
  return query;
}

describe("notification claiming", () => {
  it("returns the existing notification when the event-key unique constraint wins the race", async () => {
    const existing = {
      id: "notification-1",
      finding_id: "finding-1",
      radar_id: "radar-1",
      user_id: "user-1",
      destination_id: "chat-1",
      status: "pending",
    };
    let notificationCall = 0;
    const client = {
      from(table: string) {
        if (table === "findings") {
          return queryFor({
            data: {
              id: "finding-1",
              radar_id: "radar-1",
              fingerprint: "fp-1",
              event_key: "event-1",
              title: "Finding",
              summary: "Summary",
              source_domain: "example.com",
              source_url: "https://example.com/finding",
            },
            error: null,
          });
        }
        if (table === "radars") {
          return queryFor({
            data: { id: "radar-1", user_id: "user-1", name: "Radar" },
            error: null,
          });
        }
        notificationCall += 1;
        if (notificationCall === 1) {
          return queryFor({ data: null, error: { code: "23505", message: "duplicate" } });
        }
        return queryFor(
          { data: null, error: null },
          (filters) =>
            filters.dedupe_key === "event-1"
              ? { data: existing, error: null }
              : { data: null, error: null },
        );
      },
      rpc: vi.fn(),
    } as unknown as MonitoringClient;

    await expect(createPendingNotification("finding-1", "chat-1", client)).resolves.toEqual(
      existing,
    );
  });

  it("does not send a Telegram message when claiming a pending notification loses", async () => {
    const telegram = { sendMessage: vi.fn() };
    const client = {
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as MonitoringClient;

    await expect(
      sendPendingNotification("notification-1", { client, telegram }),
    ).resolves.toBeNull();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("aborts an abortable notification database request at the deadline", async () => {
    let abortCount = 0;
    const request = {
      abortSignal(signal: AbortSignal) {
        signal.addEventListener("abort", () => {
          abortCount += 1;
        });
        return request;
      },
      then() {
        return new Promise<never>(() => undefined);
      },
    };
    const client = {
      from: vi.fn(),
      rpc: vi.fn().mockReturnValue(request),
    } as unknown as MonitoringClient;

    await expect(
      sendPendingNotification("notification-1", {
        client,
        deadlineAt: Date.now() + 5,
      }),
    ).rejects.toMatchObject({ code: "RUN_DEADLINE_EXCEEDED" });
    expect(abortCount).toBe(1);
  });

  it("finishes a claimed notification as failed when finding preparation fails", async () => {
    const updates: Record<string, unknown>[] = [];
    const client = {
      from(table: string) {
        if (table === "findings") {
          return queryFor({
            data: null,
            error: { code: "PGRST500", message: "read failed" },
          });
        }
        if (table === "notifications") {
          return queryFor(
            { data: { id: "notification-1" }, error: null },
            undefined,
            (_operation, values) => updates.push(values as Record<string, unknown>),
          );
        }
        return queryFor({ data: null, error: null });
      },
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            notification_id: "notification-1",
            finding_id: "finding-1",
            radar_id: "radar-1",
            user_id: "user-1",
            destination_id: "chat-1",
          },
        ],
        error: null,
      }),
    } as unknown as MonitoringClient;

    const result = await sendPendingNotification("notification-1", {
      client,
      telegram: { sendMessage: vi.fn() },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCode: "NOTIFICATION_PREPARATION_FAILED",
    });
    expect(updates).toEqual([
      { status: "failed", error_code: "NOTIFICATION_PREPARATION_FAILED" },
    ]);
  });

  it("does not report a terminal notification status without CAS confirmation", async () => {
    const client = {
      from(table: string) {
        if (table === "findings") {
          return queryFor({
            data: null,
            error: { code: "PGRST500", message: "read failed" },
          }, undefined, undefined, 10);
        }
        if (table === "notifications") {
          return queryFor({ data: null, error: null });
        }
        return queryFor({ data: null, error: null });
      },
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            notification_id: "notification-1",
            finding_id: "finding-1",
            radar_id: "radar-1",
            user_id: "user-1",
            destination_id: "chat-1",
          },
        ],
        error: null,
      }),
    } as unknown as MonitoringClient;

    await expect(
      sendPendingNotification("notification-1", {
        client,
        deadlineAt: Date.now() + 5,
      }),
    ).rejects.toMatchObject({ code: "DATABASE_ERROR" });
  });

  it("uses a bounded cleanup budget to confirm a delivery timeout as unknown", async () => {
    const updates: Record<string, unknown>[] = [];
    const client = {
      from(table: string) {
        if (table === "findings") {
          return queryFor({
            data: {
              id: "finding-1",
              radar_id: "radar-1",
              fingerprint: "fp-1",
              event_key: null,
              title: "Finding",
              summary: "Summary",
              source_domain: "example.com",
              source_url: "https://example.com/finding",
            },
            error: null,
          });
        }
        if (table === "radars") {
          return queryFor({
            data: { id: "radar-1", user_id: "user-1", name: "Radar" },
            error: null,
          });
        }
        if (table === "telegram_connections") {
          return queryFor({ data: { chat_id: "chat-1" }, error: null });
        }
        if (table === "notifications") {
          return queryFor(
            { data: { id: "notification-1" }, error: null },
            undefined,
            (_operation, values) => updates.push(values as Record<string, unknown>),
            10,
          );
        }
        return queryFor({ data: null, error: null });
      },
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            notification_id: "notification-1",
            finding_id: "finding-1",
            radar_id: "radar-1",
            user_id: "user-1",
            destination_id: "chat-1",
          },
        ],
        error: null,
      }),
    } as unknown as MonitoringClient;

    const result = await sendPendingNotification("notification-1", {
      client,
      deadlineAt: Date.now() + 20,
      cleanupDeadlineAt: Date.now() + 200,
      telegram: {
        sendMessage: () => new Promise(() => undefined),
      },
    });

    expect(result).toMatchObject({
      status: "unknown",
      errorCode: "RUN_DEADLINE_EXCEEDED",
    });
    expect(updates).toEqual([
      { status: "unknown", error_code: "RUN_DEADLINE_EXCEEDED" },
    ]);
  });

  it("finishes a claimed notification as failed when the destination is gone", async () => {
    const updatedStatuses: unknown[] = [];
    const client = {
      from(table: string) {
        if (table === "findings") {
          return queryFor({
            data: {
              id: "finding-1",
              radar_id: "radar-1",
              fingerprint: "fp-1",
              event_key: null,
              title: "Finding",
              summary: "Summary",
              source_domain: "example.com",
              source_url: "https://example.com/finding",
            },
            error: null,
          });
        }
        if (table === "radars") {
          return queryFor({
            data: { id: "radar-1", user_id: "user-1", name: "Radar" },
            error: null,
          });
        }
        if (table === "telegram_connections") {
          return queryFor({ data: null, error: null });
        }
        if (table === "notifications") {
          return queryFor(
            { data: { id: "notification-1" }, error: null },
            undefined,
            (_operation, values) => updatedStatuses.push((values as { status?: unknown }).status),
          );
        }
        return queryFor({ data: null, error: null });
      },
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            notification_id: "notification-1",
            finding_id: "finding-1",
            radar_id: "radar-1",
            user_id: "user-1",
            destination_id: "chat-1",
          },
        ],
        error: null,
      }),
    } as unknown as MonitoringClient;

    const result = await sendPendingNotification("notification-1", {
      client,
      telegram: { sendMessage: vi.fn() },
    });

    expect(result).toMatchObject({ status: "failed", errorCode: "TELEGRAM_NOT_CONNECTED" });
    expect(updatedStatuses).toEqual(["failed"]);
  });

  it.each(["radars", "telegram_connections"] as const)(
    "finishes as failed when %s preparation reads fail",
    async (failedTable) => {
      const updates: Record<string, unknown>[] = [];
      const client = {
        from(table: string) {
          if (table === "findings") {
            return queryFor({
              data: {
                id: "finding-1",
                radar_id: "radar-1",
                fingerprint: "fp-1",
                event_key: null,
                title: "Finding",
                summary: "Summary",
                source_domain: "example.com",
                source_url: "https://example.com/finding",
              },
              error: null,
            });
          }
          if (table === failedTable) {
            return queryFor({
              data: null,
              error: { code: "PGRST500", message: "read failed" },
            });
          }
          if (table === "radars") {
            return queryFor({
              data: { id: "radar-1", user_id: "user-1", name: "Radar" },
              error: null,
            });
          }
          if (table === "notifications") {
            return queryFor(
              { data: { id: "notification-1" }, error: null },
              undefined,
              (_operation, values) => updates.push(values as Record<string, unknown>),
            );
          }
          return queryFor({ data: { chat_id: "chat-1" }, error: null });
        },
        rpc: vi.fn().mockResolvedValue({
          data: [
            {
              notification_id: "notification-1",
              finding_id: "finding-1",
              radar_id: "radar-1",
              user_id: "user-1",
              destination_id: "chat-1",
            },
          ],
          error: null,
        }),
      } as unknown as MonitoringClient;

      await expect(
        sendPendingNotification("notification-1", {
          client,
          telegram: { sendMessage: vi.fn() },
        }),
      ).resolves.toMatchObject({
        status: "failed",
        errorCode: "NOTIFICATION_PREPARATION_FAILED",
      });
      expect(updates).toEqual([
        { status: "failed", error_code: "NOTIFICATION_PREPARATION_FAILED" },
      ]);
    },
  );
});

describe("deadline cancellation", () => {
  it("cancels the original create RPC before a locked setup can commit", async () => {
    vi.useFakeTimers();
    let abortCount = 0;
    let aborted = false;
    let radarCount = 0;
    let setupStatus: "pending" | "consumed" = "pending";
    let releaseRpc!: (result: DatabaseResult) => void;
    const rpcResult = new Promise<DatabaseResult>((resolve) => {
      releaseRpc = resolve;
    });
    const request = {
      abortSignal(signal: AbortSignal) {
        signal.addEventListener("abort", () => {
          abortCount += 1;
          aborted = true;
        });
        return request;
      },
      then(
        onFulfilled?: (value: DatabaseResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return rpcResult.then(onFulfilled, onRejected);
      },
    };
    const client = {
      from: vi.fn(),
      rpc: vi.fn(() => request),
    } as unknown as MonitoringClient;

    let creation!: Promise<{ id: string }>;
    const deadlineOutcome = withMonitoringDeadline(
      (signal) => {
        creation = createRadarFromSetup(
          "setup-1",
          "user-1",
          Date.now() + 100,
          client,
          signal,
        );
        return creation;
      },
      Date.now() + 100,
    ).then(
      () => ({ kind: "resolved" as const }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    const creationOutcome = creation.then(
      () => ({ kind: "resolved" as const }),
      () => ({ kind: "rejected" as const }),
    );

    try {
      await vi.advanceTimersByTimeAsync(100);
      await expect(deadlineOutcome).resolves.toMatchObject({
        kind: "rejected",
        error: { code: "RUN_DEADLINE_EXCEEDED" },
      });

      releaseRpc({
        data: aborted
          ? null
          : (() => {
              radarCount += 1;
              setupStatus = "consumed";
              return [{ id: "radar-1" }];
            })(),
        error: aborted ? { message: "request aborted" } : null,
      });
      await expect(creationOutcome).resolves.toMatchObject({
        kind: aborted ? "rejected" : "resolved",
      });
      expect(abortCount).toBe(1);
      expect(radarCount).toBe(0);
      expect(setupStatus).toBe("pending");
    } finally {
      vi.useRealTimers();
    }
  });
});

const testRules: RadarRules = {
  radarName: "Task 5 Radar",
  subject: "Track Task 5 music updates",
  aliases: [],
  includeTopics: ["music updates"],
  excludeTopics: [],
  searchQuery: "Task 5 music updates",
  importanceThreshold: 50,
  intervalMinutes: 360,
};

const testRadar = {
  id: "radar-1",
  user_id: "user-1",
  name: "Task 5 Radar",
  original_prompt: "Task 5",
  rules: testRules,
  source_state: {},
  status: "active" as const,
  interval_minutes: 360,
  baseline_cutoff_at: "2026-08-06T00:00:00.000Z",
  tavily_baseline_completed_at: null,
  last_checked_at: null,
  next_check_at: "2026-08-06T00:00:00.000Z",
  lease_owner: "claim-owner",
  lease_expires_at: "2099-08-06T00:00:00.000Z",
};

const testCandidate: Candidate = {
  sourceType: "tavily",
  sourceDomain: "example.com",
  sourceUrl: "https://example.com/task-5",
  title: "Task 5 finding",
  excerpt: "A relevant Task 5 finding.",
  publishedAt: "2026-08-06T00:00:00.000Z",
};

class MonitoringFakeClient implements MonitoringClient {
  readonly rpcCalls: string[] = [];
  readonly findingInserts: Record<string, unknown>[] = [];
  readonly terminalRunUpdates: Record<string, unknown>[] = [];
  radarRules: RadarRules = testRules;
  runStatus: "running" | "success" | "failed" = "running";
  sourceUpdateRows = true;
  terminalRunUpdateRows = true;
  radarUpdateRows = true;
  terminalUpdateFailures = 0;
  terminalUpdateDelayMs = 0;
  recoveryRequestPending = false;
  recoveryRequestAbortCount = 0;
  sourcePersistenceFailures = 0;
  persistFindingRpcError: string | null = null;
  persistedSourceSuccessCount = 0;
  recoveryStatus: "success" | "failed" = "failed";
  recoveryNextCheckAt: string | null = null;
  tavilyBaselineCompletedAt: string | null = null;
  runLeaseExpiresAt = "2099-08-06T00:00:00.000Z";
  existingNotificationStatus: "pending" | "sending" | "failed" | "unknown" = "pending";
  existingNotificationExpiredSending = false;
  private findingCounter = 0;

  from(table: string): MonitoringQuery {
    const filters: Record<string, unknown> = {};
    let operation: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Record<string, unknown> = {};
    const resolve = (): { data: unknown; error: null | { message: string; code?: string } } => {
      if (operation === "update") {
        if (table === "radar_runs" && "status" in payload) {
          this.terminalRunUpdates.push(payload);
          if (this.terminalUpdateFailures > 0) {
            this.terminalUpdateFailures -= 1;
            return { data: null, error: { code: "PGRST500", message: "temporary write failure" } };
          }
          if (!this.terminalRunUpdateRows) {
            return { data: null, error: null };
          }
          this.runStatus = payload.status === "success" ? "success" : "running";
          return { data: { id: "run-1" }, error: null };
        }
        if (table === "radar_runs" && "source_outcomes" in payload) {
          if (this.sourcePersistenceFailures > 0) {
            this.sourcePersistenceFailures -= 1;
            return { data: null, error: { code: "PGRST500", message: "source write failed" } };
          }
          if (!this.sourceUpdateRows) {
            return { data: null, error: null };
          }
          return { data: { id: "run-1" }, error: null };
        }
        if (table === "radars" && !this.radarUpdateRows) {
          return { data: null, error: null };
        }
        return { data: { id: table === "radars" ? "radar-1" : "run-1" }, error: null };
      }
      if (operation === "upsert") {
        return { data: null, error: null };
      }
      if (table === "radars") {
        return {
          data: {
            ...testRadar,
            rules: this.radarRules,
            tavily_baseline_completed_at: this.tavilyBaselineCompletedAt,
          },
          error: null,
        };
      }
      if (table === "radar_runs") {
        if (filters.status === "running" && this.runStatus !== "running") {
          return { data: null, error: null };
        }
        return {
          data: {
            id: "run-1",
            radar_id: "radar-1",
            status: this.runStatus,
            trigger: "baseline",
            lease_owner: "claim-owner",
            lease_expires_at: this.runLeaseExpiresAt,
          },
          error: null,
        };
      }
      if (table === "radar_sources") {
        return { data: { source_key: "music_news_rss", baseline_completed_at: null }, error: null };
      }
      if (table === "findings" && operation === "insert") {
        this.findingCounter += 1;
        this.findingInserts.push(payload);
        return {
          data: {
            id: `finding-${this.findingCounter}`,
            radar_id: "radar-1",
            fingerprint: String(payload.fingerprint),
            event_key: payload.event_key ?? null,
            importance_score: Number(payload.importance_score ?? 0),
            first_seen_during_baseline: Boolean(payload.first_seen_during_baseline),
            notification_eligible: Boolean(payload.notification_eligible),
          },
          error: null,
        };
      }
      if (table === "findings") {
        return { data: [], error: null };
      }
      if (table === "telegram_connections") {
        return { data: { chat_id: "chat-1" }, error: null };
      }
      return { data: null, error: null };
    };

    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return query;
      },
      neq: () => query,
      gt: () => query,
      gte: () => query,
      lt: () => query,
      lte: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () => {
        const result = resolve();
        if (
          this.terminalUpdateDelayMs > 0 &&
          table === "radar_runs" &&
          operation === "update" &&
          "status" in payload
        ) {
          return new Promise((resolveDelayed) => {
            setTimeout(() => resolveDelayed(result), this.terminalUpdateDelayMs);
          });
        }
        return Promise.resolve(result);
      },
      single: () => Promise.resolve(resolve()),
      insert: (values: unknown) => {
        operation = "insert";
        payload = (values ?? {}) as Record<string, unknown>;
        return query;
      },
      update: (values: unknown) => {
        operation = "update";
        payload = (values ?? {}) as Record<string, unknown>;
        return query;
      },
      upsert: (values: unknown) => {
        operation = "upsert";
        payload = (values ?? {}) as Record<string, unknown>;
        return query;
      },
      then: (
        onFulfilled?: (value: ReturnType<typeof resolve>) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    return query as unknown as MonitoringQuery;
  }

  rpc(
    functionName: string,
    args: Record<string, unknown> = {},
  ): Promise<DatabaseResult> {
    this.rpcCalls.push(functionName);
    if (functionName === "claim_radar_run") {
      if (
        this.existingNotificationStatus === "sending" &&
        this.existingNotificationExpiredSending
      ) {
        this.existingNotificationStatus = "unknown";
      }
      return Promise.resolve({
        data: [{ run_id: "run-1", lease_owner: "claim-owner", error_code: null }],
        error: null,
      });
    }
    if (functionName === "persist_run_source_outcomes") {
      if (this.sourcePersistenceFailures > 0) {
        this.sourcePersistenceFailures -= 1;
        return Promise.resolve({
          data: null,
          error: { code: "PGRST500", message: "source write failed" },
        });
      }
      const outcomes = Array.isArray(args.p_source_outcomes)
        ? args.p_source_outcomes
        : [];
      this.persistedSourceSuccessCount = outcomes.filter(
        (outcome) =>
          typeof outcome === "object" &&
          outcome !== null &&
          (outcome as { success?: unknown }).success === true,
      ).length;
      return Promise.resolve({
        data: this.sourceUpdateRows ? [true] : [],
        error: null,
      });
    }
    if (functionName === "finalize_run_for_owner") {
      const finalize = () => {
        const update = {
          status: args.p_status,
          lease_owner: null,
          lease_expires_at: null,
        };
        this.terminalRunUpdates.push(update);
        if (this.terminalUpdateFailures > 0) {
          this.terminalUpdateFailures -= 1;
          return {
            data: null,
            error: { code: "PGRST500", message: "temporary write failure" },
          };
        }
        if (
          !this.terminalRunUpdateRows ||
          !this.radarUpdateRows ||
          this.runStatus !== "running"
        ) {
          return { data: [], error: null };
        }
        this.runStatus = args.p_status === "success" ? "success" : "failed";
        return { data: [true], error: null };
      };
      if (this.terminalUpdateDelayMs > 0) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(finalize()), this.terminalUpdateDelayMs);
        });
      }
      return Promise.resolve(finalize());
    }
    if (functionName === "recover_run_for_owner") {
      if (this.recoveryRequestPending) {
        let resolveRequest!: (result: DatabaseResult) => void;
        const pendingRequest = new Promise<DatabaseResult>((resolve) => {
          resolveRequest = resolve;
        });
        const request = {
          abortSignal: (signal: AbortSignal) => {
            signal.addEventListener("abort", () => {
              this.recoveryRequestAbortCount += 1;
              resolveRequest({ data: [], error: null });
            });
            return request;
          },
          then: (
            onFulfilled?: (value: DatabaseResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => pendingRequest.then(onFulfilled, onRejected),
        };
        return request as unknown as Promise<DatabaseResult>;
      }
      const recover = () => {
        const recoveredStatus = "failed" as const;
        this.recoveryStatus = recoveredStatus;
        this.recoveryNextCheckAt = new Date(
          Date.now() + (recoveredStatus === "failed" ? 15 * 60_000 : 6 * 60 * 60_000),
        ).toISOString();
        const update = {
          status: recoveredStatus,
          lease_owner: null,
          lease_expires_at: null,
          next_check_at: this.recoveryNextCheckAt,
        };
        this.terminalRunUpdates.push(update);
        if (!this.radarUpdateRows || this.runStatus !== "running") {
          return { data: [], error: null };
        }
        this.runStatus = recoveredStatus;
        return { data: [true], error: null };
      };
      if (this.terminalUpdateDelayMs > 0) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(recover()), this.terminalUpdateDelayMs);
        });
      }
      return Promise.resolve(recover());
    }
    if (functionName === "persist_run_finding") {
      if (this.persistFindingRpcError) {
        return Promise.resolve({
          data: null,
          error: { message: this.persistFindingRpcError },
        });
      }
      if (this.runStatus !== "running") {
        return Promise.resolve({
          data: null,
          error: { message: "RUN_NOT_CLAIMED" },
        });
      }
      this.findingCounter += 1;
      this.findingInserts.push({
        source_url: args.p_source_url,
        fingerprint: args.p_fingerprint,
        event_key: args.p_event_key,
      });
      return Promise.resolve({
        data: [
          {
            finding_id: `finding-rpc-${this.findingCounter}`,
            radar_id: "radar-1",
            fingerprint: String(args.p_fingerprint),
            event_key: (args.p_event_key as string | null) ?? null,
            importance_score: Number(args.p_importance_score ?? 0),
            first_seen_during_baseline: !Boolean(args.p_source_was_baselined),
            notification_eligible:
              Boolean(args.p_source_was_baselined) && Boolean(args.p_relevant),
          },
        ],
        error: null,
      });
    }
    if (functionName === "mark_source_baseline_for_run") {
      return Promise.resolve({
        data: this.radarUpdateRows ? [true] : [],
        error: null,
      });
    }
    if (functionName === "create_pending_notification_for_run") {
      if (this.existingNotificationStatus === "failed") {
        this.existingNotificationStatus = "pending";
      }
      if (
        this.existingNotificationStatus === "sending" &&
        this.existingNotificationExpiredSending
      ) {
        this.existingNotificationStatus = "unknown";
      }
      return Promise.resolve({
        data: [
          {
            notification_id: "notification-1",
            finding_id: "finding-rpc-1",
            radar_id: "radar-1",
            user_id: "user-1",
            destination_id: "chat-1",
            status: this.existingNotificationStatus,
          },
        ],
        error: null,
      });
    }
    if (functionName === "requeue_failed_notifications_for_run") {
      if (this.existingNotificationStatus !== "failed") {
        return Promise.resolve({ data: [], error: null });
      }
      this.existingNotificationStatus = "pending";
      return Promise.resolve({
        data: [
          {
            notification_id: "notification-1",
            finding_id: "finding-rpc-1",
            radar_id: "radar-1",
            user_id: "user-1",
            destination_id: "chat-1",
            status: "pending",
          },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: [], error: null });
  }
}

describe("run pipeline", () => {
  it("does not fetch the fixed Music News feed for an OpenAI radar", async () => {
    const client = new MonitoringFakeClient();
    client.radarRules = {
      ...testRules,
      radarName: "OpenAI Product and Model Updates",
      subject: "Track official OpenAI product releases and model updates.",
      aliases: ["OpenAI"],
      includeTopics: ["product releases", "model updates"],
      searchQuery: "OpenAI product release model update",
    };
    const fetchRss = vi.fn<() => Promise<Candidate[]>>(async () => []);

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [testCandidate],
        fetchRss,
        evaluate: async () => [],
      }),
    ).resolves.toMatchObject({ status: "success", candidateCount: 1 });

    expect(fetchRss).not.toHaveBeenCalled();
  });

  it("claims once and reuses the claimed run for baseline execution", async () => {
    const client = new MonitoringFakeClient();

    const result = await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [],
      fetchRss: async () => [],
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(result.status).toBe("success");
    expect(client.rpcCalls).toEqual([
      "claim_radar_run",
      "persist_run_source_outcomes",
      "persist_run_source_outcomes",
      "mark_source_baseline_for_run",
      "mark_source_baseline_for_run",
      "requeue_failed_notifications_for_run",
      "finalize_run_for_owner",
    ]);
  });

  it("does not fetch when the claimed run is no longer running", async () => {
    const client = new MonitoringFakeClient();
    client.runStatus = "success";
    const searchTavily = vi.fn<() => Promise<Candidate[]>>();
    const fetchRss = vi.fn<() => Promise<Candidate[]>>();

    await expect(
      executeClaimedRun("run-1", "claim-owner", {
        client,
        searchTavily,
        fetchRss,
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_CLAIMED" });
    expect(searchTavily).not.toHaveBeenCalled();
    expect(fetchRss).not.toHaveBeenCalled();
  });

  it("does not create a notification for a candidate first seen during baseline", async () => {
    const client = new MonitoringFakeClient();
    const createNotification = vi.fn();

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: async () => [
        {
          candidate: testCandidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "task-5-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        },
      ],
      createNotification,
    });

    expect(createNotification).not.toHaveBeenCalled();
  });

  it("keeps different fingerprints as separate findings even when event_key matches", async () => {
    const client = new MonitoringFakeClient();
    const secondCandidate = {
      ...testCandidate,
      sourceUrl: "https://example.com/task-5-follow-up",
      title: "Task 5 follow-up",
    };

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate, secondCandidate],
      fetchRss: async () => [],
      evaluate: async () =>
        [testCandidate, secondCandidate].map((candidate) => ({
          candidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "same-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        })),
    });

    expect(client.findingInserts).toHaveLength(2);
    expect(client.findingInserts.map((finding) => finding.source_url)).toEqual([
      testCandidate.sourceUrl,
      secondCandidate.sourceUrl,
    ]);
  });

  it("fails with RUN_NOT_CLAIMED when finalization updates zero rows", async () => {
    const client = new MonitoringFakeClient();
    client.terminalRunUpdateRows = false;

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [],
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_CLAIMED" });
  });

  it("fails with RUN_NOT_CLAIMED when source persistence updates zero rows", async () => {
    const client = new MonitoringFakeClient();
    client.sourceUpdateRows = false;

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [],
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_CLAIMED" });
    expect(client.terminalRunUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("fails with RUN_NOT_CLAIMED when baseline updates zero rows", async () => {
    const client = new MonitoringFakeClient();
    client.radarUpdateRows = false;

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [],
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_CLAIMED" });
  });

  it("retries terminal writes twice and releases a run after source persistence fails", async () => {
    const retryClient = new MonitoringFakeClient();
    retryClient.terminalUpdateFailures = 2;

    const retryResult = await runRadar("radar-1", "baseline", {
      client: retryClient,
      searchTavily: async () => [],
      fetchRss: async () => [],
    });

    expect(retryResult.status).toBe("success");
    expect(retryClient.terminalRunUpdates).toHaveLength(3);

    const recoveryClient = new MonitoringFakeClient();
    recoveryClient.sourcePersistenceFailures = 1;

    await expect(
      runRadar("radar-1", "baseline", {
        client: recoveryClient,
        searchTavily: async () => [],
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "DATABASE_ERROR" });
    expect(recoveryClient.terminalRunUpdates.at(-1)).toMatchObject({
      status: "failed",
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("recovers source success plus later DB failure as failed with a short retry", async () => {
    const client = new MonitoringFakeClient();
    client.persistFindingRpcError = "finding write failed";

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [testCandidate],
        fetchRss: async () => [],
        evaluate: async () => [
          {
            candidate: testCandidate,
            evaluation: {
              relevant: true,
              relevance_score: 90,
              importance_score: 90,
              confidence: 0.9,
              event_key: "recovery-source-success-event",
              duplicate_of_event_key: null,
              reason: "matches",
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "DATABASE_ERROR" });

    expect(client.persistedSourceSuccessCount).toBeGreaterThan(0);
    expect(client.recoveryStatus).toBe("failed");
    const retryAt = Date.parse(client.recoveryNextCheckAt ?? "");
    expect(retryAt).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(retryAt).toBeLessThan(Date.now() + 16 * 60_000);
  });

  it("does not write findings after the run loses its lease", async () => {
    const client = new MonitoringFakeClient();

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [testCandidate],
        fetchRss: async () => [],
        evaluate: async () => {
          client.runStatus = "success";
          return [
            {
              candidate: testCandidate,
              evaluation: {
                relevant: true,
                relevance_score: 90,
                importance_score: 90,
                confidence: 0.9,
                event_key: "lease-lost-event",
                duplicate_of_event_key: null,
                reason: "matches",
              },
            },
          ];
        },
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_CLAIMED" });

    expect(client.findingInserts).toHaveLength(0);
  });

  it("treats an AI evaluation timeout as a recoverable AI failure", async () => {
    const client = new MonitoringFakeClient();

    const result = await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: () => new Promise<never>(() => undefined),
      aiTimeoutMs: 5,
    });

    expect(result.status).toBe("success");
    expect(client.findingInserts).toHaveLength(1);
  });

  it("passes the remaining budget, abort signal, and zero retries to production Gemini", async () => {
    const client = new MonitoringFakeClient();
    const requestOptions: {
      signal: AbortSignal;
      timeout: number;
      maxRetries: number;
    }[] = [];
    const create = vi.fn(
      async (
        _request: Record<string, unknown>,
        options: {
          signal: AbortSignal;
          timeout: number;
          maxRetries: number;
        },
      ) => {
        requestOptions.push(options);
        return new Promise<never>((_, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("provider aborted")),
            { once: true },
          );
        });
      },
    );
    const ai = {
      chat: {
        completions: {
          create,
        },
      },
    } as unknown as AiLike;

    for (const [name, value] of Object.entries({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      CRON_SECRET: "cron-secret",
      RULE_TOKEN_SECRET: "r".repeat(32),
      TAVILY_API_KEY: "tavily-key",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "test-model",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_BOT_USERNAME: "telegram-user",
      TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    })) {
      vi.stubEnv(name, value);
    }

    try {
      await expect(
        runRadar("radar-1", "baseline", {
          client,
          ai,
          aiTimeoutMs: 20,
          searchTavily: async () => [testCandidate],
          fetchRss: async () => [],
        }),
      ).resolves.toMatchObject({ status: "success" });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(create).toHaveBeenCalledTimes(1);
    expect(requestOptions[0]).toMatchObject({
      maxRetries: 0,
      signal: expect.any(AbortSignal),
      timeout: expect.any(Number),
    });
    expect(requestOptions[0]?.timeout).toBeGreaterThan(0);
    expect(requestOptions[0]?.timeout).toBeLessThanOrEqual(20);
    expect(requestOptions[0]?.signal.aborted).toBe(true);
  });

  it("preserves the Gemini completions receiver and sends evaluated findings", async () => {
    const client = new MonitoringFakeClient();
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    const createNotification = vi.fn().mockResolvedValue({
      id: "notification-1",
      status: "pending",
    });
    const sendNotification = vi.fn().mockResolvedValue({
      notificationId: "notification-1",
      status: "sent",
      messageId: 1,
    });
    type Receiver = {
      requestCount: number;
      create: (
        this: Receiver,
        request: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    const completions: Receiver = {
      requestCount: 0,
      async create(this: Receiver) {
        this.requestCount += 1;
        return {
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    relevant: true,
                    relevance_score: 90,
                    importance_score: 90,
                    confidence: 0.9,
                    event_key: "receiver-event",
                    duplicate_of_event_key: null,
                    reason: "matches",
                  },
                ]),
              },
            },
          ],
        };
      },
    };
    const ai = {
      chat: { completions },
    } as unknown as AiLike;

    for (const [name, value] of Object.entries({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      CRON_SECRET: "cron-secret",
      RULE_TOKEN_SECRET: "r".repeat(32),
      TAVILY_API_KEY: "tavily-key",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "test-model",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_BOT_USERNAME: "telegram-user",
      TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    })) {
      vi.stubEnv(name, value);
    }

    try {
      await expect(
        runRadar("radar-1", "baseline", {
          client,
          ai,
          searchTavily: async () => [testCandidate],
          fetchRss: async () => [],
          createNotification,
          sendNotification,
        }),
      ).resolves.toMatchObject({ status: "success", notificationCount: 1 });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(completions.requestCount).toBe(1);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("uses the real Gemini OpenAI-compatible SDK receiver with one fake-fetch request", async () => {
    const client = new MonitoringFakeClient();
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    const createNotification = vi.fn().mockResolvedValue({
      id: "notification-1",
      status: "pending",
    });
    const sendNotification = vi.fn().mockResolvedValue({
      notificationId: "notification-1",
      status: "sent",
      messageId: 1,
    });
    const requestInits: RequestInit[] = [];
    const fakeFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestInits.push(init ?? {});
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      relevant: true,
                      relevance_score: 90,
                      importance_score: 90,
                      confidence: 0.9,
                      event_key: "real-sdk-event",
                      duplicate_of_event_key: null,
                      reason: "matches",
                    },
                  ]),
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );

    for (const [name, value] of Object.entries({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      CRON_SECRET: "cron-secret",
      RULE_TOKEN_SECRET: "r".repeat(32),
      TAVILY_API_KEY: "tavily-key",
      GEMINI_API_KEY: "gemini-key",
      GEMINI_MODEL: "test-model",
      TELEGRAM_BOT_TOKEN: "telegram-token",
      TELEGRAM_BOT_USERNAME: "telegram-user",
      TELEGRAM_WEBHOOK_SECRET: "telegram-secret",
    })) {
      vi.stubEnv(name, value);
    }

    try {
      await expect(
        runRadar("radar-1", "baseline", {
          client,
          ai: new OpenAI({
            apiKey: "gemini-key",
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
            fetch: fakeFetch as never,
            dangerouslyAllowBrowser: true,
          }) as unknown as AiLike,
          searchTavily: async () => [testCandidate],
          fetchRss: async () => [],
          createNotification,
          sendNotification,
        }),
      ).resolves.toMatchObject({ status: "success", notificationCount: 1 });
    } finally {
      vi.unstubAllEnvs();
    }

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(requestInits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not write a Finding when the lease-safe persistence RPC loses the lease", async () => {
    const client = new MonitoringFakeClient();
    client.persistFindingRpcError = "RUN_NOT_CLAIMED";

    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [testCandidate],
        fetchRss: async () => [],
        evaluate: async () => [
          {
            candidate: testCandidate,
            evaluation: {
              relevant: true,
              relevance_score: 90,
              importance_score: 90,
              confidence: 0.9,
              event_key: "lease-race-event",
              duplicate_of_event_key: null,
              reason: "matches",
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "RUN_NOT_CLAIMED" });

    expect(client.rpcCalls).toContain("persist_run_finding");
    expect(client.findingInserts).toHaveLength(0);
  });

  it("passes run lease context to notification creation and sending", async () => {
    const client = new MonitoringFakeClient();
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    const createNotification = vi.fn().mockResolvedValue({
      id: "notification-1",
      status: "pending",
    });
    const sendNotification = vi.fn().mockResolvedValue({
      notificationId: "notification-1",
      status: "sent",
      messageId: 1,
    });

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: async () => [
        {
          candidate: testCandidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "notification-context-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        },
      ],
      createNotification,
      sendNotification,
    });

    expect(createNotification.mock.calls[0]?.[3]).toEqual({
      runId: "run-1",
      leaseOwner: "claim-owner",
    });
    expect(sendNotification.mock.calls[0]?.[1]).toMatchObject({
      runId: "run-1",
      leaseOwner: "claim-owner",
      cleanupDeadlineAt: expect.any(Number),
    });
  });

  it("does not send an expired sending notification through the full run path", async () => {
    const client = new MonitoringFakeClient();
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    client.existingNotificationStatus = "sending";
    client.existingNotificationExpiredSending = true;
    const sendNotification = vi.fn();

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: async () => [
        {
          candidate: testCandidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "expired-sending-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        },
      ],
      sendNotification,
    });

    expect(client.existingNotificationStatus).toBe("unknown");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("cleans stale sending during a zero-candidate run and never reopens it", async () => {
    const client = new MonitoringFakeClient();
    client.existingNotificationStatus = "sending";
    client.existingNotificationExpiredSending = true;
    const sendNotification = vi.fn();

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [],
      fetchRss: async () => [],
      sendNotification,
    });

    expect(client.existingNotificationStatus).toBe("unknown");
    expect(sendNotification).not.toHaveBeenCalled();

    client.runStatus = "running";
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: async () => [
        {
          candidate: testCandidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "expired-sending-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        },
      ],
      sendNotification,
    });

    expect(client.existingNotificationStatus).toBe("unknown");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("requeues a failed notification on the next production run", async () => {
    const client = new MonitoringFakeClient();
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    client.existingNotificationStatus = "failed";
    const sendNotification = vi.fn().mockResolvedValue({
      notificationId: "notification-1",
      status: "sent",
      messageId: 1,
    });

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: async () => [
        {
          candidate: testCandidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "failed-notification-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        },
      ],
      sendNotification,
    });

    expect(client.existingNotificationStatus).toBe("pending");
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("requeues a failed notification worklist with zero current candidates", async () => {
    const client = new MonitoringFakeClient();
    client.existingNotificationStatus = "failed";
    const sendNotification = vi.fn().mockResolvedValue({
      notificationId: "notification-1",
      status: "sent",
      messageId: 1,
    });

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [],
      fetchRss: async () => [],
      sendNotification,
    });

    expect(client.existingNotificationStatus).toBe("pending");
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(client.findingInserts).toHaveLength(0);
    expect(client.rpcCalls).toContain("requeue_failed_notifications_for_run");
  });

  it("keeps an unknown notification terminal and never sends it", async () => {
    const client = new MonitoringFakeClient();
    client.tavilyBaselineCompletedAt = "2026-08-05T00:00:00.000Z";
    client.existingNotificationStatus = "unknown";
    const sendNotification = vi.fn();

    await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [testCandidate],
      fetchRss: async () => [],
      evaluate: async () => [
        {
          candidate: testCandidate,
          evaluation: {
            relevant: true,
            relevance_score: 90,
            importance_score: 90,
            confidence: 0.9,
            event_key: "unknown-notification-event",
            duplicate_of_event_key: null,
            reason: "matches",
          },
        },
      ],
      sendNotification,
    });

    expect(client.existingNotificationStatus).toBe("unknown");
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("stops waiting for source work at the claimed lease deadline", async () => {
    const client = new MonitoringFakeClient();
    client.runLeaseExpiresAt = new Date(Date.now() + 20).toISOString();
    const startedAt = Date.now();

    await expect(
      executeClaimedRun("run-1", "claim-owner", {
        client,
        searchTavily: () => new Promise<Candidate[]>(() => undefined),
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "RUN_DEADLINE_EXCEEDED" });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(client.terminalRunUpdates.at(-1)).toMatchObject({
      lease_owner: null,
      lease_expires_at: null,
    });
  });

  it("aborts an abortable database request when the outer budget expires", async () => {
    vi.useFakeTimers();
    let abortCount = 0;
    const request = {
      abortSignal(signal: AbortSignal) {
        signal.addEventListener("abort", () => {
          abortCount += 1;
        });
        return request;
      },
      then() {
        return new Promise<never>(() => undefined);
      },
    } as unknown as PromiseLike<unknown>;

    try {
      const pending = withMonitoringDeadline(request, Date.now() + 100);
      const outcome = pending.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      await vi.advanceTimersByTimeAsync(100);
      await expect(outcome).resolves.toMatchObject({
        kind: "rejected",
        error: { code: "RUN_DEADLINE_EXCEEDED" },
      });
      expect(abortCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds recovery terminal cleanup by the remaining lease budget", async () => {
    const client = new MonitoringFakeClient();
    client.runLeaseExpiresAt = new Date(Date.now() + 50).toISOString();
    client.terminalUpdateDelayMs = 1_000;
    const startedAt = Date.now();

    await expect(
      executeClaimedRun("run-1", "claim-owner", {
        client,
        searchTavily: () => new Promise<Candidate[]>(() => undefined),
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "RUN_DEADLINE_EXCEEDED" });

    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("does not recover an expired lease after a recovery lock wait", async () => {
    const client = new MonitoringFakeClient();
    client.runLeaseExpiresAt = new Date(Date.now() + 100).toISOString();
    client.recoveryRequestPending = true;

    await expect(
      executeClaimedRun("run-1", "claim-owner", {
        client,
        searchTavily: async () => [],
        fetchRss: async () => [],
      }),
    ).rejects.toMatchObject({ code: "RUN_DEADLINE_EXCEEDED" });

    expect(client.recoveryRequestAbortCount).toBe(1);
    expect(client.terminalRunUpdates).toHaveLength(0);

    client.recoveryRequestPending = false;
    client.runLeaseExpiresAt = "2099-08-06T00:00:00.000Z";
    await expect(
      runRadar("radar-1", "baseline", {
        client,
        searchTavily: async () => [],
        fetchRss: async () => [],
      }),
    ).resolves.toMatchObject({ status: "success" });
  });

  it("recomputes recovery cleanup budget when a late infrastructure failure occurs", async () => {
    vi.useFakeTimers();
    const client = new MonitoringFakeClient();
    client.persistFindingRpcError = "PERSIST_FAILED";
    const searchTavily = vi.fn(
      () =>
        new Promise<Candidate[]>((resolve) => {
          setTimeout(() => resolve([testCandidate]), 2_100);
        }),
    );

    try {
      const execution = executeClaimedRun("run-1", "claim-owner", {
        client,
        searchTavily,
        fetchRss: async () => [],
      });
      const executionOutcome = execution.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      );
      await vi.waitFor(() => expect(searchTavily).toHaveBeenCalled());
      await vi.advanceTimersByTimeAsync(2_100);

      await expect(executionOutcome).resolves.toMatchObject({
        kind: "rejected",
        error: { code: "DATABASE_ERROR" },
      });
      expect(client.terminalRunUpdates.at(-1)).toMatchObject({
        status: "failed",
        lease_owner: null,
        lease_expires_at: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
