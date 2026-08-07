import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authGetUser = vi.hoisted(() => vi.fn());
const setupId = vi.hoisted(() => "550e8400-e29b-41d4-a716-446655440000");
const adminFrom = vi.hoisted(() =>
  vi.fn((table: string) => {
    let operation: "select" | "insert" = "select";
    const query = {
      select: () => query,
      eq: () => query,
      neq: () => query,
      gt: () => query,
      gte: () => query,
      lt: () => query,
      lte: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      insert: () => {
        operation = "insert";
        return query;
      },
      update: () => query,
      upsert: () => query,
      maybeSingle: async () => {
        if (table === "telegram_connections") {
          return { data: { user_id: "user-1" }, error: null };
        }
        return { data: null, error: null };
      },
      single: async () =>
        operation === "insert"
          ? { data: { id: setupId }, error: null }
          : { data: null, error: null },
      then: (
        onFulfilled?: (value: { data: unknown; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected),
    };
    return query;
  }),
);
const cookieStore = vi.hoisted(() => ({
  get: vi.fn(() => ({ value: setupId })),
  delete: vi.fn(),
  set: vi.fn(),
}));
const createRadarFromSetup = vi.hoisted(() => vi.fn());
const runRadar = vi.hoisted(() => vi.fn());
const withMonitoringDeadline = vi.hoisted(() =>
  vi.fn(async (operation: unknown) => {
    if (typeof operation === "function") {
      return operation(new AbortController().signal);
    }
    return operation;
  }),
);
const ruleTokenVerify = vi.hoisted(() =>
  vi.fn(() => ({
    radarName: "LISA Radar",
    subject: "LISA",
    aliases: [],
    includeTopics: ["official news"],
    excludeTopics: [],
    searchQuery: "LISA official news",
    importanceThreshold: 70,
    intervalMinutes: 360,
  })),
);
const radarRulesSafeParse = vi.hoisted(() =>
  vi.fn((input: unknown) => ({ success: true as const, data: input })),
);
const pendingSetupSafeParse = vi.hoisted(() =>
  vi.fn((input: unknown) => ({ success: true as const, data: input })),
);

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(() => ({ from: adminFrom })),
}));

vi.mock("@/lib/security/rule-token", () => ({
  hashRuleToken: vi.fn(() => "hashed-rule-token"),
  verifyRuleToken: ruleTokenVerify,
}));

vi.mock("@/lib/validation/radar-rules", () => ({
  pendingSetupRequestSchema: { safeParse: pendingSetupSafeParse },
  radarRulesSchema: { safeParse: radarRulesSafeParse },
}));

vi.mock("@/lib/monitoring/create-radar", () => ({
  createRadarFromSetup,
  firstRpcRow: (data: unknown) =>
    Array.isArray(data) ? (data[0] ?? null) : data ?? null,
  getMonitoringClient: vi.fn((client) => client),
  MonitoringError: class MonitoringError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  toPublicRadar: vi.fn((row) => row),
  toPublicRunResult: vi.fn((run) => run),
  throwDatabaseError: (error: { message?: string } | null) => {
    if (error) {
      throw new Error(error.message ?? "database error");
    }
  },
}));

vi.mock("@/lib/monitoring/run-radar", () => ({
  MONITORING_ROUTE_BUDGET_MS: 55_000,
  runRadar,
  withMonitoringDeadline,
}));

import { POST as createRadarFromPendingSetup } from "@/app/api/pending-setups/route";
import { POST as createRadarFromCookie } from "@/app/api/radars/route";
import type {
  DatabaseResult,
  MonitoringClient,
  MonitoringQuery,
} from "@/lib/monitoring/create-radar";
import type { Candidate, RadarRules } from "@/types/contracts";

describe("Task 7 deployment artifacts", () => {
  it("includes the webhook configuration and notification smoke-test scripts", () => {
    const webhookScript = resolve(
      process.cwd(),
      "scripts/configure-telegram-webhook.mjs",
    );
    const smokeScript = resolve(
      process.cwd(),
      "scripts/smoke-telegram-notification.ts",
    );

    expect(existsSync(webhookScript)).toBe(true);
    expect(existsSync(smokeScript)).toBe(true);

    if (!existsSync(webhookScript) || !existsSync(smokeScript)) {
      return;
    }

    const webhookSource = readFileSync(webhookScript, "utf8");
    const smokeSource = readFileSync(smokeScript, "utf8");

    expect(webhookSource).toContain("setWebhook");
    expect(webhookSource).toContain("getWebhookInfo");
    expect(webhookSource).toContain("drop_pending_updates");
    expect(webhookSource).toContain("process.env.TELEGRAM_BOT_TOKEN");
    expect(webhookSource).not.toContain("console.log(botToken)");
    expect(smokeSource).toContain("createPendingNotification");
    expect(smokeSource).toContain("sendPendingNotification");
    expect(smokeSource).toContain("randomUUID");
    expect(smokeSource).toContain("radar-id");
  });
});

describe("Task 7 activation handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    createRadarFromSetup.mockResolvedValue({
      id: "radar-1",
      user_id: "user-1",
      name: "LISA Radar",
    });
    runRadar.mockResolvedValue({
      runId: "run-1",
      status: "success",
      candidateCount: 1,
      relevantCount: 0,
      notificationCount: 0,
    });
  });

  it("creates and baselines a pending setup immediately when Telegram is already connected", async () => {
    const response = await createRadarFromPendingSetup(
      new Request("http://localhost/api/pending-setups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalPrompt: "Track LISA official news",
          ruleToken: "rule-token",
          editableDelta: {
            radarName: "LISA Radar",
            includeTopics: ["official news"],
            excludeTopics: [],
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      next: "radar",
      radarId: "radar-1",
    });
    expect(createRadarFromSetup).toHaveBeenCalledWith(
      setupId,
      "user-1",
      expect.any(Number),
      expect.anything(),
    );
    expect(runRadar).toHaveBeenCalledWith(
      "radar-1",
      "baseline",
      expect.objectContaining({ outerDeadlineAt: expect.any(Number) }),
    );
    expect(cookieStore.delete).toHaveBeenCalledWith("wa_setup");
  });

  it("allows the activation route to consume the HttpOnly setup cookie without a JSON body", async () => {
    const response = await createRadarFromCookie(
      new Request("http://localhost/api/radars", { method: "POST" }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      radar: { id: "radar-1" },
    });
    expect(createRadarFromSetup).toHaveBeenCalledWith(
      setupId,
      "user-1",
      expect.any(Number),
      expect.anything(),
      expect.any(AbortSignal),
    );
  });
});

type PipelineRow = Record<string, unknown>;

const pipelineRules: RadarRules = {
  radarName: "LISA Radar",
  subject: "Track official LISA music news",
  aliases: ["LISA"],
  includeTopics: ["official music news"],
  excludeTopics: [],
  searchQuery: "LISA official music news",
  importanceThreshold: 70,
  intervalMinutes: 360,
};

class PipelineMemoryClient implements MonitoringClient {
  readonly radars = new Map<string, PipelineRow>([
    [
      "radar-1",
      {
        id: "radar-1",
        user_id: "user-1",
        name: "LISA Radar",
        original_prompt: "Track LISA official news",
        rules: pipelineRules,
        source_state: {},
        status: "active",
        interval_minutes: 360,
        baseline_cutoff_at: "2026-08-07T00:00:00.000Z",
        tavily_baseline_completed_at: null,
        last_checked_at: null,
        next_check_at: "2026-08-07T00:00:00.000Z",
        lease_owner: null,
        lease_expires_at: null,
      },
    ],
  ]);
  readonly runs = new Map<string, PipelineRow>();
  readonly findings = new Map<string, PipelineRow>();
  notification: PipelineRow | null = null;
  private runNumber = 0;
  private findingNumber = 0;
  private readonly rssBaselineCompletedAt = new Map<string, string>();

  from(table: string): MonitoringQuery {
    const filters: Record<string, unknown> = {};
    let operation: "select" | "insert" | "update" = "select";
    let payload: PipelineRow = {};

    const matches = (row: PipelineRow | null) =>
      row &&
      Object.entries(filters).every(([key, value]) => row[key] === value)
        ? row
        : null;

    const resolve = (): DatabaseResult => {
      if (operation === "update" && table === "notifications") {
        if (!matches(this.notification)) {
          return { data: null, error: null };
        }

        Object.assign(this.notification!, payload);
        return { data: { id: this.notification?.id }, error: null };
      }

      if (operation === "insert") {
        return { data: payload, error: null };
      }

      if (table === "radars") {
        const radarId = typeof filters.id === "string" ? filters.id : "radar-1";
        return { data: this.radars.get(radarId) ?? null, error: null };
      }

      if (table === "radar_runs") {
        const runId = typeof filters.id === "string" ? filters.id : "";
        const run = this.runs.get(runId) ?? null;
        return { data: matches(run), error: null };
      }

      if (table === "radar_sources") {
        const radarId = String(filters.radar_id ?? "radar-1");
        return {
          data: {
            source_key: "music_news_rss",
            baseline_completed_at: this.rssBaselineCompletedAt.get(radarId) ?? null,
            last_error: null,
          },
          error: null,
        };
      }

      if (table === "telegram_connections") {
        return { data: { chat_id: "chat-1" }, error: null };
      }

      if (table === "findings") {
        const findingId = typeof filters.id === "string" ? filters.id : "";
        return { data: matches(this.findings.get(findingId) ?? null), error: null };
      }

      if (table === "notifications") {
        return { data: matches(this.notification), error: null };
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
      insert: (values: unknown) => {
        operation = "insert";
        payload = (values ?? {}) as PipelineRow;
        return query;
      },
      update: (values: unknown) => {
        operation = "update";
        payload = (values ?? {}) as PipelineRow;
        return query;
      },
      upsert: (values: unknown) => {
        operation = "insert";
        payload = (values ?? {}) as PipelineRow;
        return query;
      },
      maybeSingle: () => Promise.resolve(resolve()),
      single: () => Promise.resolve(resolve()),
      then: (
        onFulfilled?: (value: DatabaseResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };

    return query as unknown as MonitoringQuery;
  }

  rpc(functionName: string, args: Record<string, unknown> = {}): Promise<DatabaseResult> {
    if (functionName === "claim_radar_run") {
      const runId = `run-${++this.runNumber}`;
      const run = {
        id: runId,
        radar_id: args.p_radar_id,
        status: "running",
        trigger: args.p_trigger,
        lease_owner: args.p_lease_owner,
        lease_expires_at: args.p_lease_expires_at,
        source_outcomes: [],
        source_success_count: 0,
      };
      this.runs.set(runId, run);
      return Promise.resolve({
        data: [
          {
            run_id: runId,
            lease_owner: args.p_lease_owner,
            error_code: null,
          },
        ],
        error: null,
      });
    }

    if (functionName === "persist_run_source_outcomes") {
      const run = this.runs.get(String(args.p_run_id));
      const outcomes = Array.isArray(args.p_source_outcomes)
        ? args.p_source_outcomes
        : [];
      if (run) {
        run.source_outcomes = outcomes;
        run.source_success_count = outcomes.filter(
          (outcome) =>
            Boolean(outcome) &&
            typeof outcome === "object" &&
            (outcome as { success?: unknown }).success === true,
        ).length;
      }
      return Promise.resolve({ data: [true], error: null });
    }

    if (functionName === "persist_run_finding") {
      const run = this.runs.get(String(args.p_run_id));
      const radar = this.radars.get(String(run?.radar_id));
      const sourceWasBaselined = Boolean(args.p_source_was_baselined);
      const relevant = Boolean(args.p_relevant);
      const importanceScore = Number(args.p_importance_score ?? 0);
      const findingId = `finding-${++this.findingNumber}`;
      const finding = {
        id: findingId,
        radar_id: run?.radar_id,
        fingerprint: args.p_fingerprint,
        event_key: args.p_event_key ?? null,
        title: args.p_title,
        summary: args.p_summary,
        source_domain: args.p_source_domain,
        source_url: args.p_source_url,
        importance_score: importanceScore,
        first_seen_during_baseline: !sourceWasBaselined,
        notification_eligible:
          sourceWasBaselined &&
          relevant &&
          importanceScore >= Number((radar?.rules as RadarRules).importanceThreshold),
      };
      this.findings.set(findingId, finding);
      return Promise.resolve({
        data: [
          {
            finding_id: findingId,
            radar_id: finding.radar_id,
            fingerprint: finding.fingerprint,
            event_key: finding.event_key,
            importance_score: finding.importance_score,
            first_seen_during_baseline: finding.first_seen_during_baseline,
            notification_eligible: finding.notification_eligible,
          },
        ],
        error: null,
      });
    }

    if (functionName === "mark_source_baseline_for_run") {
      const run = this.runs.get(String(args.p_run_id));
      const radarId = String(run?.radar_id ?? "radar-1");
      if (args.p_source_key === "tavily") {
        const radar = this.radars.get(radarId);
        if (radar) {
          radar.tavily_baseline_completed_at = args.p_completed_at;
        }
      } else {
        this.rssBaselineCompletedAt.set(radarId, String(args.p_completed_at));
      }
      return Promise.resolve({ data: [true], error: null });
    }

    if (functionName === "requeue_failed_notifications_for_run") {
      return Promise.resolve({ data: [], error: null });
    }

    if (functionName === "finalize_run_for_owner") {
      const run = this.runs.get(String(args.p_run_id));
      if (run) {
        run.status = args.p_status;
        run.lease_owner = null;
        run.lease_expires_at = null;
      }
      return Promise.resolve({ data: [true], error: null });
    }

    if (functionName === "recover_run_for_owner") {
      return Promise.resolve({ data: [true], error: null });
    }

    if (functionName === "claim_notification") {
      if (!this.notification || this.notification.status !== "pending") {
        return Promise.resolve({ data: [], error: null });
      }

      this.notification.status = "sending";
      return Promise.resolve({
        data: [
          {
            notification_id: this.notification.id,
            finding_id: this.notification.finding_id,
            radar_id: this.notification.radar_id,
            user_id: this.notification.user_id,
            destination_id: this.notification.destination_id,
          },
        ],
        error: null,
      });
    }

    return Promise.resolve({ data: [], error: null });
  }
}

function candidate(number: number): Candidate {
  return {
    sourceType: "tavily",
    sourceDomain: "example.com",
    sourceUrl: `https://example.com/lisa-${number}`,
    title: `LISA finding ${number}`,
    excerpt: `Official LISA update ${number}`,
    publishedAt: "2026-08-07T00:00:00.000Z",
  };
}

describe("Task 7 monitoring pipeline", () => {
  it("baselines without notifying, notifies one later finding, and atomically claims one sender", async () => {
    const { runRadar: executeRunRadar } = await vi.importActual<
      typeof import("@/lib/monitoring/run-radar")
    >("@/lib/monitoring/run-radar");
    const { sendPendingNotification } = await vi.importActual<
      typeof import("@/lib/monitoring/notifications")
    >("@/lib/monitoring/notifications");
    const client = new PipelineMemoryClient();
    client.radars.set("radar-2", {
      ...client.radars.get("radar-1"),
      id: "radar-2",
      name: "OpenAI Radar",
      original_prompt: "Track OpenAI official news",
      rules: {
        ...pipelineRules,
        radarName: "OpenAI Radar",
        subject: "Track official OpenAI product releases and model updates",
        aliases: ["OpenAI"],
        includeTopics: ["product releases", "model updates"],
        searchQuery: "OpenAI product release model update",
      },
    });
    const createdNotifications: string[] = [];
    const fetchRss = vi.fn(async () => [] as Candidate[]);
    const evaluate = async ({ candidates }: { candidates: Candidate[] }) =>
      candidates.map((item) => ({
        candidate: item,
        evaluation: {
          relevant: true,
          relevance_score: 95,
          importance_score: 90,
          confidence: 0.95,
          event_key: null,
          duplicate_of_event_key: null,
          reason: "official match",
        },
      }));
    const runDependencies = (items: Candidate[]) => ({
      client,
      searchTavily: async () => items,
      fetchRss,
      evaluate,
      createNotification: async (findingId: string, destinationId: string) => {
        const finding = client.findings.get(findingId);
        client.notification = {
          id: "notification-1",
          finding_id: findingId,
          radar_id: finding?.radar_id,
          user_id: "user-1",
          destination_id: destinationId,
          status: "pending",
        };
        createdNotifications.push(findingId);
        return { id: "notification-1", status: "pending" };
      },
      sendNotification: async () => ({
        notificationId: "notification-1",
        status: "sent" as const,
      }),
      outerDeadlineAt: Date.now() + 20_000,
      leaseDurationMs: 10_000,
    });

    await expect(
      executeRunRadar("radar-1", "baseline", runDependencies([candidate(1)])),
    ).resolves.toMatchObject({ status: "success", notificationCount: 0 });
    expect(createdNotifications).toHaveLength(0);

    await expect(
      executeRunRadar("radar-1", "manual", runDependencies([candidate(2)])),
    ).resolves.toMatchObject({ status: "success", notificationCount: 1 });
    expect(createdNotifications).toHaveLength(1);
    expect([...client.findings.values()]).toHaveLength(2);

    const sendMessage = vi.fn(async () => ({ message_id: 9 }));
    const [firstSender, secondSender] = await Promise.all([
      sendPendingNotification("notification-1", {
        client,
        telegram: { sendMessage },
      }),
      sendPendingNotification("notification-1", {
        client,
        telegram: { sendMessage },
      }),
    ]);

    expect(firstSender ?? secondSender).toMatchObject({ status: "sent" });
    expect(firstSender === null || secondSender === null).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await expect(
      executeRunRadar("radar-2", "baseline", runDependencies([candidate(3)])),
    ).resolves.toMatchObject({ status: "success", notificationCount: 0 });
    expect([...client.findings.values()]).toHaveLength(3);
    expect(
      [...client.findings.values()].filter((finding) => finding.radar_id === "radar-2"),
    ).toHaveLength(1);
    expect(fetchRss).not.toHaveBeenCalled();
  });
});
