import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, Radar as RadarIcon, Send } from "lucide-react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { FindingsList, type FindingsListFinding } from "@/components/radar/findings-list";
import { RadarActions, WorkspaceLocaleSwitcher, WorkspaceNavigation } from "@/components/radar/radar-actions";
import { RadarRulesCard } from "@/components/radar/radar-rules-card";
import { RunHistory, type RunHistoryRun } from "@/components/radar/run-history";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { NotificationStatus, RadarStatus, RunStatus } from "@/types/contracts";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type RadarRow = {
  id: string;
  user_id: string;
  name: string;
  original_prompt: string;
  rules: unknown;
  status: RadarStatus;
  interval_minutes: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  created_at: string;
};

type FindingRow = {
  id: string;
  radar_id: string;
  title: string;
  summary: string;
  source_domain: string;
  source_url: string;
  published_at: string | null;
  first_seen_at: string | null;
  relevance_score: number;
  importance_score: number;
  match_reason: string;
  notification_eligible: boolean;
};

type RunRow = {
  id: string;
  trigger: "baseline" | "schedule" | "manual";
  status: RunStatus;
  started_at: string;
  finished_at: string | null;
  candidate_count: number;
  relevant_count: number;
  notification_count: number;
  source_outcomes: unknown;
};

type NotificationRow = {
  finding_id: string;
  status: string;
};

type DetailRules = {
  radarName: string;
  subject: string;
  aliases: string[];
  includeTopics: string[];
  excludeTopics: string[];
  searchQuery: string;
  importanceThreshold: number;
  intervalMinutes: number;
};

const copy = {
  en: {
    back: "My Radars",
    created: (date: string, hours: number) => `Created ${date} · Checks every ${hours} hours`,
    statusActive: "Running",
    statusPaused: "Paused",
    lastCheck: "Last check",
    nextCheck: "Next check",
    candidates: "Candidates",
    relevant: "Relevant",
    notified: "Notified",
    title: "Monitoring rules",
    edit: "Edit rules",
    save: "Save rules",
    cancel: "Cancel",
    saving: "Saving…",
    radarName: "Radar name",
    include: "Include topics",
    exclude: "Exclude topics",
    includeHint: "One topic per line",
    validationName: "Radar name must be 2–80 characters.",
    validationInclude: "Include 1–8 topics, with each topic 1–60 characters.",
    validationExclude: "Exclude up to 8 topics, with each topic 1–60 characters.",
    actionError: "The rules could not be saved. Please try again.",
    notifyAbout: "Notify about",
    ignore: "Ignore",
    subject: "Subject",
    searchQuery: "Search query",
    threshold: "Threshold",
    frequency: "Frequency",
    everyHours: (hours: number) => `Every ${hours} hours`,
    noCheck: "Not checked yet",
    pausedNext: "Paused",
    telegramConnected: "Telegram connected",
    telegramDescription: "Important findings from this Radar are sent to your connected private chat.",
    telegramNotConnected: "Telegram not connected",
    telegramNotConnectedDescription: "Connect Telegram to receive important findings.",
    telegramDataError: "Telegram status could not be loaded.",
    manage: "Manage Telegram",
    findingsTitle: "Latest findings",
    findingsDescription: "Important results saved for this Radar.",
    runTitle: "Run history",
    dataErrorTitle: "Radar data is temporarily unavailable",
    dataError: "Some live details could not be loaded. Refresh and try again.",
    retry: "Retry",
    runStats: "Latest run",
    runSummary: (relevant: number, candidates: number) => `Relevant ${relevant} / Candidates ${candidates}`,
    noLatestRun: "No completed run yet",
    sources: "sources",
    emptyRules: "No topics configured",
  },
  "zh-CN": {
    back: "我的 Radars",
    created: (date: string, hours: number) => `创建于 ${date} · 每 ${hours} 小时检查`,
    statusActive: "运行中",
    statusPaused: "已暂停",
    lastCheck: "上次检查",
    nextCheck: "下次检查",
    candidates: "候选结果",
    relevant: "相关结果",
    notified: "已通知",
    title: "监控规则",
    edit: "编辑规则",
    save: "保存规则",
    cancel: "取消",
    saving: "保存中…",
    radarName: "Radar 名称",
    include: "关注项",
    exclude: "排除项",
    includeHint: "每行填写一项",
    validationName: "Radar 名称需为 2–80 个字符。",
    validationInclude: "关注项需为 1–8 项，每项 1–60 个字符。",
    validationExclude: "排除项最多 8 项，每项 1–60 个字符。",
    actionError: "规则保存失败，请稍后重试。",
    notifyAbout: "关注内容",
    ignore: "忽略",
    subject: "监控主题",
    searchQuery: "搜索语句",
    threshold: "匹配阈值",
    frequency: "检查频率",
    everyHours: (hours: number) => `每 ${hours} 小时`,
    noCheck: "尚未检查",
    pausedNext: "已暂停",
    telegramConnected: "Telegram 已连接",
    telegramDescription: "这个 Radar 的重要发现会发送到你已连接的 Telegram 私聊。",
    telegramNotConnected: "Telegram 未连接",
    telegramNotConnectedDescription: "连接 Telegram 后才能收到重要发现。",
    telegramDataError: "Telegram 状态加载失败，请稍后重试。",
    manage: "管理 Telegram",
    findingsTitle: "最新发现",
    findingsDescription: "保存到这个 Radar 的重要结果。",
    runTitle: "运行记录",
    dataErrorTitle: "Radar 数据暂时不可用",
    dataError: "部分实时详情加载失败，请刷新后重试。",
    retry: "重试",
    runStats: "最近一次运行",
    runSummary: (relevant: number, candidates: number) => `相关 ${relevant} / 候选 ${candidates}`,
    noLatestRun: "还没有完成的运行记录",
    sources: "个来源",
    emptyRules: "还没有配置关注内容",
  },
} as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveLocale(searchParams: Record<string, string | string[] | undefined>, profileLocale: string | null) {
  const requested = firstParam(searchParams.lang);
  if (isLocale(requested)) return requested;
  const cookieLocale = (await cookies()).get("wa_locale")?.value;
  return isLocale(cookieLocale) ? cookieLocale : normalizeLocale(profileLocale);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseRules(row: RadarRow): DetailRules {
  const rules = isRecord(row.rules) ? row.rules : {};
  return {
    radarName: row.name,
    subject: typeof rules.subject === "string" ? rules.subject : row.original_prompt,
    aliases: strings(rules.aliases),
    includeTopics: strings(rules.includeTopics),
    excludeTopics: strings(rules.excludeTopics),
    searchQuery: typeof rules.searchQuery === "string" ? rules.searchQuery : "",
    importanceThreshold: numberValue(rules.importanceThreshold, 75),
    intervalMinutes: numberValue(rules.intervalMinutes, row.interval_minutes),
  };
}

function formatDate(value: string | null, locale: Locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function sourceCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function isNotificationStatus(value: string): value is NotificationStatus {
  return ["pending", "sending", "sent", "failed", "unknown"].includes(value);
}

export default async function RadarDetailPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  const paramsValue = await searchParams;
  const redirectLocale = await resolveLocale(paramsValue, null);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth?mode=login&next=dashboard&lang=${redirectLocale}`);
  }

  const [{ data: profile, error: profileError }, { data: radarData, error: radarError }, { data: connection, error: connectionError }] = await Promise.all([
    supabase.from("profiles").select("locale").eq("id", user.id).maybeSingle(),
    supabase
      .from("radars")
      .select("id,user_id,name,original_prompt,rules,status,interval_minutes,last_checked_at,next_check_at,created_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("telegram_connections").select("telegram_username").eq("user_id", user.id).maybeSingle(),
  ]);

  const locale = await resolveLocale(paramsValue, (profile as { locale?: string } | null)?.locale ?? null);
  const labels = copy[locale];
  const localize = (href: string) => `${href}?lang=${locale}`;

  if (radarError) {
    return (
      <div className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
        <WorkspaceNavigation locale={locale} currentPath={`/radars/${id}`} />
        <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-8">
          <div className="mx-auto w-full max-w-3xl min-w-0">
            <Link href={`/radars?lang=${locale}`} className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {labels.back}
            </Link>
            <section className="mt-8 rounded-3xl border border-amber-100 bg-amber-50 p-6 shadow-sm">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{labels.dataErrorTitle}</h1>
              <p role="alert" className="mt-3 text-sm leading-6 text-amber-800">{labels.dataError}</p>
              <Link
                href={`/radars/${id}?lang=${locale}`}
                className="mt-5 inline-flex rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500"
              >
                {labels.retry}
              </Link>
            </section>
          </div>
        </main>
      </div>
    );
  }

  if (!radarData) {
    notFound();
  }

  const radar = radarData as RadarRow;
  const rules = parseRules(radar);

  const [{ data: findingData, error: findingError }, { data: runData, error: runError }] = await Promise.all([
    supabase
      .from("findings")
      .select("id,radar_id,title,summary,source_domain,source_url,published_at,first_seen_at,relevance_score,importance_score,match_reason,notification_eligible")
      .eq("radar_id", radar.id)
      .order("first_seen_at", { ascending: false })
      .limit(20),
    supabase
      .from("radar_runs")
      .select("id,trigger,status,started_at,finished_at,candidate_count,relevant_count,notification_count,source_outcomes")
      .eq("radar_id", radar.id)
      .order("started_at", { ascending: false })
      .limit(20),
  ]);

  const findings = (findingData ?? []) as FindingRow[];
  const runs = (runData ?? []) as RunRow[];
  const notificationMap = new Map<string, NotificationStatus>();
  let notificationError = false;
  const findingIds = findings.map((finding) => finding.id);

  if (findingIds.length > 0) {
    const { data: notificationData, error } = await supabase
      .from("notifications")
      .select("finding_id,status")
      .in("finding_id", findingIds)
      .order("sent_at", { ascending: false });
    notificationError = Boolean(error);
    ((notificationData ?? []) as NotificationRow[]).forEach((notification) => {
      if (isNotificationStatus(notification.status) && !notificationMap.has(notification.finding_id)) {
        notificationMap.set(notification.finding_id, notification.status);
      }
    });
  }

  const findingCards: FindingsListFinding[] = findings.map((finding) => ({
    id: finding.id,
    radarId: finding.radar_id,
    title: finding.title,
    summary: finding.summary,
    sourceDomain: finding.source_domain,
    sourceUrl: finding.source_url,
    publishedAt: finding.published_at,
    firstSeenAt: finding.first_seen_at,
    relevanceScore: finding.relevance_score,
    importanceScore: finding.importance_score,
    matchReason: finding.match_reason,
    notificationStatus: notificationMap.get(finding.id) ?? (finding.notification_eligible ? "pending" : null),
  }));

  const runCards: RunHistoryRun[] = runs.map((run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    candidateCount: run.candidate_count,
    relevantCount: run.relevant_count,
    notificationCount: run.notification_count,
    sourceCount: sourceCount(run.source_outcomes),
  }));

  const latestRun = runs[0] ?? null;
  const hours = Math.max(1, Math.round(rules.intervalMinutes / 60));
  const statusLabel = radar.status === "paused" ? labels.statusPaused : labels.statusActive;
  const username = connection?.telegram_username ? `@${String(connection.telegram_username).replace(/^@/, "")}` : null;
  const dataError = Boolean(profileError || connectionError || findingError || runError || notificationError);
  const lastCheckLabel = radar.last_checked_at ? formatDate(radar.last_checked_at, locale) : labels.noCheck;
  const nextCheckLabel = radar.status === "paused"
    ? labels.pausedNext
    : radar.next_check_at
      ? formatDate(radar.next_check_at, locale)
      : labels.noCheck;

  return (
    <div className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <WorkspaceNavigation locale={locale} currentPath={`/radars/${radar.id}`} />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-8">
        <div className="mx-auto w-full max-w-6xl min-w-0">
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <Link href={localize("/radars")} className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {labels.back}
              </Link>
              <div className="mt-5 flex min-w-0 items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700">
                  <RadarIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-950">{radar.name}</h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {labels.created(formatDate(radar.created_at, locale), hours)}
                  </p>
                  <span
                    className={
                      radar.status === "paused"
                        ? "mt-3 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
                        : "mt-3 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                    }
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col items-stretch gap-3 sm:items-end">
              <div className="flex justify-end">
                <WorkspaceLocaleSwitcher locale={locale} userId={user.id} path={`/radars/${radar.id}`} />
              </div>
              <RadarActions
                radarId={radar.id}
                status={radar.status}
                locale={locale}
              />
            </div>
          </header>

          {dataError ? (
            <p role="alert" className="mt-5 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              {labels.dataError}
            </p>
          ) : null}

          <div className="mt-7 grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{labels.lastCheck}</p>
              <p className="mt-2 truncate text-sm font-semibold text-slate-950">{lastCheckLabel}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{labels.nextCheck}</p>
              <p className="mt-2 truncate text-sm font-semibold text-slate-950">{nextCheckLabel}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{labels.runStats}</p>
              <p className="mt-2 truncate text-sm font-semibold text-slate-950">{latestRun ? labels.runSummary(latestRun.relevant_count, latestRun.candidate_count) : labels.noLatestRun}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">{labels.notified}</p>
              <p className="mt-2 truncate text-sm font-semibold text-slate-950">{latestRun?.notification_count ?? 0}</p>
            </div>
          </div>

          <div className="mt-7 grid min-w-0 gap-6 min-[850px]:grid-cols-[minmax(0,1.2fr)_minmax(270px,0.8fr)]">
            <div className="min-w-0 space-y-6">
              <section className="min-w-0">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">{labels.findingsTitle}</h2>
                    <p className="mt-1 text-sm text-slate-500">{labels.findingsDescription}</p>
                  </div>
                  <Link href="#runs" className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
                    {labels.runTitle}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                <FindingsList findings={findingCards} locale={locale} />
              </section>

              <div id="runs">
                <RunHistory runs={runCards} locale={locale} />
              </div>
            </div>

            <aside className="min-w-0 space-y-4 self-start min-[850px]:sticky min-[850px]:top-6">
              <RadarRulesCard
                radarId={radar.id}
                locale={locale}
                rules={rules}
                labels={labels}
                nextCheckLabel={nextCheckLabel}
              />

              <section className="rounded-3xl border border-violet-100 bg-violet-50 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  {connectionError ? <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" /> : connection ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" /> : <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />}
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-950">{connectionError ? labels.telegramDataError : connection ? labels.telegramConnected : labels.telegramNotConnected}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{connectionError ? labels.dataError : connection ? labels.telegramDescription : labels.telegramNotConnectedDescription}</p>
                    {connectionError ? null : (
                      <Link href={localize("/connect-telegram")} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
                        {labels.manage}
                        <Send className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    )}
                    {username ? <p className="mt-2 text-xs text-slate-500">{username}</p> : null}
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
