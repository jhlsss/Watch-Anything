import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(),
}));

import {
  fingerprintCandidate,
  fingerprintWithoutStableUrl,
} from "@/lib/monitoring/fingerprint";
import { createPendingNotification, sendPendingNotification } from "@/lib/monitoring/notifications";
import type {
  MonitoringClient,
  MonitoringQuery,
} from "@/lib/monitoring/create-radar";
import { executeClaimedRun, runRadar } from "@/lib/monitoring/run-radar";
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
) {
  const filters: Record<string, unknown> = {};
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
      onOperation?.("update", values);
      return query;
    },
    upsert: () => query,
    maybeSingle: () => Promise.resolve(onFilter ? onFilter(filters) : result),
    single: () => Promise.resolve(onFilter ? onFilter(filters) : result),
    then: (
      onFulfilled?: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(onFilter ? onFilter(filters) : result).then(onFulfilled, onRejected),
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

  it("finishes a claimed notification as unknown when finding preparation fails", async () => {
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

    expect(result).toMatchObject({ status: "unknown" });
    expect(updates).toEqual([
      { status: "unknown", error_code: "NOTIFICATION_PREPARATION_FAILED" },
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
    "finishes as unknown when %s preparation reads fail",
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
        status: "unknown",
        errorCode: "NOTIFICATION_PREPARATION_FAILED",
      });
      expect(updates).toEqual([
        { status: "unknown", error_code: "NOTIFICATION_PREPARATION_FAILED" },
      ]);
    },
  );
});

const testRules: RadarRules = {
  radarName: "Task 5 Radar",
  subject: "Task 5",
  aliases: [],
  includeTopics: ["test"],
  excludeTopics: [],
  searchQuery: "Task 5",
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
  runStatus: "running" | "success" = "running";
  sourceUpdateRows = true;
  terminalRunUpdateRows = true;
  radarUpdateRows = true;
  terminalUpdateFailures = 0;
  sourcePersistenceFailures = 0;
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
        return { data: testRadar, error: null };
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
            lease_expires_at: "2099-08-06T00:00:00.000Z",
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
      maybeSingle: () => Promise.resolve(resolve()),
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

  rpc(functionName: string) {
    this.rpcCalls.push(functionName);
    if (functionName === "claim_radar_run") {
      return Promise.resolve({
        data: [{ run_id: "run-1", lease_owner: "claim-owner", error_code: null }],
        error: null,
      });
    }
    return Promise.resolve({ data: [], error: null });
  }
}

describe("run pipeline", () => {
  it("claims once and reuses the claimed run for baseline execution", async () => {
    const client = new MonitoringFakeClient();

    const result = await runRadar("radar-1", "baseline", {
      client,
      searchTavily: async () => [],
      fetchRss: async () => [],
      now: () => new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(result.status).toBe("success");
    expect(client.rpcCalls).toEqual(["claim_radar_run"]);
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
});
