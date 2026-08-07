import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Send } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { FindingsList, type FindingsListFinding } from "@/components/radar/findings-list";
import { LogoutButton } from "@/components/auth/logout-button";
import { WorkspaceLocaleSwitcher, WorkspaceNavigation } from "@/components/radar/radar-actions";
import { createClient } from "@/lib/supabase/server";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import type { NotificationStatus, RadarStatus, RunStatus } from "@/types/contracts";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type RadarRow = {
  id: string;
  name: string;
  status: RadarStatus;
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
  radar_id: string;
  status: RunStatus;
  created_at: string;
};

type NotificationRow = {
  finding_id: string;
  status: NotificationStatus;
};

const copy = {
  en: {
    title: (name: string) => `Good morning, ${name}`,
    subtitle: "Here’s what your Radars found.",
    newRadar: "New Radar",
    logout: "Log out",
    loggingOut: "Logging out…",
    logoutError: "Logout failed. Please try again.",
    telegramConnected: "Telegram connected",
    telegramNotConnected: "Telegram not connected",
    telegramConnectedDescription: (username: string | null) =>
      username
        ? `Alerts from all your Radars will be delivered to ${username}.`
        : "Alerts from all your Radars will be delivered to your private chat.",
    telegramNotConnectedDescription: "Connect Telegram before activating a Radar.",
    manage: "Manage",
    connect: "Connect",
    running: "Running",
    paused: "Paused",
    needsAttention: "Needs attention",
    attentionTitle: "Needs attention",
    healthyTitle: "Everything looks healthy",
    healthyDescription: "Your Radars are ready for their next check.",
    telegramAttention: "Telegram is not connected",
    telegramAttentionDescription: "Connect Telegram to receive important findings.",
    radarLimitAttention: "Radar limit reached",
    radarLimitAttentionDescription: "Pause one active Radar before creating another.",
    failedAttention: (name: string) => `${name} needs a retry`,
    failedAttentionDescription: "The latest check failed. Open the Radar to try again.",
    dataAttention: "Workspace data needs attention",
    dataAttentionDescription: "Some live data could not be loaded. Refresh and try again.",
    latestTitle: "Latest important findings",
    acrossAll: "Across all Radars",
    viewAll: "View all Radars",
    emptyTitle: "No important findings yet",
    emptyDescription: "Your next successful check will appear here.",
    activeSummary: (active: number) => `${active} of 3 active`,
  },
  "zh-CN": {
    title: (name: string) => `早上好，${name}`,
    subtitle: "看看你的 Radar 最近发现了什么。",
    newRadar: "+ 新建 Radar",
    logout: "退出登录",
    loggingOut: "退出中…",
    logoutError: "退出失败，请重试。",
    telegramConnected: "Telegram 已连接",
    telegramNotConnected: "Telegram 未连接",
    telegramConnectedDescription: (username: string | null) =>
      username
        ? `所有 Radar 的提醒都会发送到 ${username}。`
        : "所有 Radar 的提醒都会发送到你的 Telegram 私聊。",
    telegramNotConnectedDescription: "启用 Radar 前，请先连接 Telegram。",
    manage: "管理",
    connect: "连接",
    running: "运行中",
    paused: "已暂停",
    needsAttention: "需要处理",
    attentionTitle: "需要处理",
    healthyTitle: "一切运行正常",
    healthyDescription: "你的 Radar 已准备好进行下一次检查。",
    telegramAttention: "Telegram 尚未连接",
    telegramAttentionDescription: "连接 Telegram 后才能收到重要发现。",
    radarLimitAttention: "已达到 Radar 数量上限",
    radarLimitAttentionDescription: "请先暂停一个启用中的 Radar，再创建新的 Radar。",
    failedAttention: (name: string) => `${name} 需要重试`,
    failedAttentionDescription: "最近一次检查失败，请打开 Radar 重试。",
    dataAttention: "工作区数据需要处理",
    dataAttentionDescription: "部分实时数据加载失败，请刷新后重试。",
    latestTitle: "最新重要发现",
    acrossAll: "来自全部 Radar",
    viewAll: "查看全部 Radar",
    emptyTitle: "还没有重要发现",
    emptyDescription: "下一次成功检查后，新的结果会显示在这里。",
    activeSummary: (active: number) => `${active} / 3 个正在运行`,
  },
} as const;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

async function resolveLocale(searchParams: Record<string, string | string[] | undefined>, profileLocale: string | null) {
  const requested = firstParam(searchParams.lang);
  if (isLocale(requested)) {
    return requested;
  }

  const cookieLocale = (await cookies()).get("wa_locale")?.value;
  return isLocale(cookieLocale) ? cookieLocale : normalizeLocale(profileLocale);
}

function isNotificationStatus(value: string): value is NotificationStatus {
  return ["pending", "sending", "sent", "failed", "unknown"].includes(value);
}

function parseFinding(
  row: FindingRow,
  radarNames: Map<string, string>,
  notificationStatuses: Map<string, NotificationStatus>,
): FindingsListFinding {
  return {
    id: row.id,
    radarId: row.radar_id,
    radarName: radarNames.get(row.radar_id),
    title: row.title,
    summary: row.summary,
    sourceDomain: row.source_domain,
    sourceUrl: row.source_url,
    publishedAt: row.published_at,
    firstSeenAt: row.first_seen_at,
    relevanceScore: row.relevance_score,
    importanceScore: row.importance_score,
    matchReason: row.match_reason,
    notificationStatus: notificationStatuses.get(row.id) ?? (row.notification_eligible ? "pending" : null),
  };
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const redirectLocale = await resolveLocale(params, null);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth?mode=login&next=dashboard&lang=${redirectLocale}`);
  }

  const [{ data: profile, error: profileError }, { data: connection, error: connectionError }, { data: radarData, error: radarError }] =
    await Promise.all([
      supabase.from("profiles").select("locale").eq("id", user.id).maybeSingle(),
      supabase.from("telegram_connections").select("telegram_username").eq("user_id", user.id).maybeSingle(),
      supabase.from("radars").select("id,name,status").eq("user_id", user.id).order("created_at", { ascending: false }),
    ]);

  const locale = await resolveLocale(params, (profile as { locale?: string } | null)?.locale ?? null);
  const labels = copy[locale];
  const localize = (href: string) => `${href}?lang=${locale}`;
  const radars = (radarData ?? []) as RadarRow[];
  const radarNames = new Map(radars.map((radar) => [radar.id, radar.name]));
  const radarIds = radars.map((radar) => radar.id);

  let findingRows: FindingRow[] = [];
  let runRows: RunRow[] = [];
  let notificationRows: NotificationRow[] = [];
  let childQueryError = false;

  if (radarIds.length > 0) {
    const [{ data: findingData, error: findingError }, { data: runData, error: runError }] = await Promise.all([
      supabase
        .from("findings")
        .select("id,radar_id,title,summary,source_domain,source_url,published_at,first_seen_at,relevance_score,importance_score,match_reason,notification_eligible")
        .in("radar_id", radarIds)
        .eq("notification_eligible", true)
        .gt("relevance_score", 0)
        .gt("importance_score", 0)
        .order("first_seen_at", { ascending: false })
        .limit(3),
      supabase
        .from("radar_runs")
        .select("radar_id,status,created_at")
        .in("radar_id", radarIds)
        .order("created_at", { ascending: false })
        .limit(Math.max(3, radarIds.length * 3)),
    ]);

    findingRows = (findingData ?? []) as FindingRow[];
    runRows = (runData ?? []) as RunRow[];
    childQueryError = Boolean(findingError || runError);

    const findingIds = findingRows.map((finding) => finding.id);
    if (findingIds.length > 0) {
      const { data: notificationData, error: notificationError } = await supabase
        .from("notifications")
        .select("finding_id,status")
        .in("finding_id", findingIds)
        .order("sent_at", { ascending: false });

      notificationRows = ((notificationData ?? []) as Array<{ finding_id: string; status: string }>).filter(
        (row): row is NotificationRow => isNotificationStatus(row.status),
      );
      childQueryError = childQueryError || Boolean(notificationError);
    }
  }

  const workspaceDataError = Boolean(profileError || connectionError || radarError || childQueryError);

  const notificationStatuses = new Map<string, NotificationStatus>();
  notificationRows.forEach((row) => {
    if (!notificationStatuses.has(row.finding_id)) {
      notificationStatuses.set(row.finding_id, row.status);
    }
  });

  const latestRunByRadar = new Map<string, RunRow>();
  runRows.forEach((run) => {
    if (!latestRunByRadar.has(run.radar_id)) {
      latestRunByRadar.set(run.radar_id, run);
    }
  });

  const attentionItems = [] as Array<{ title: string; description: string; href: string }>;
  if (firstParam(params.notice) === "radar-limit") {
    attentionItems.push({
      title: labels.radarLimitAttention,
      description: labels.radarLimitAttentionDescription,
      href: localize("/radars"),
    });
  }
  if (!connection) {
    attentionItems.push({
      title: labels.telegramAttention,
      description: labels.telegramAttentionDescription,
      href: localize("/connect-telegram"),
    });
  }
  radars.forEach((radar) => {
    if (latestRunByRadar.get(radar.id)?.status === "failed") {
      attentionItems.push({
        title: labels.failedAttention(radar.name),
        description: labels.failedAttentionDescription,
        href: localize(`/radars/${radar.id}`),
      });
    }
  });
  if (workspaceDataError) {
    attentionItems.push({
      title: labels.dataAttention,
      description: labels.dataAttentionDescription,
      href: localize("/dashboard"),
    });
  }

  const activeCount = radars.filter((radar) => radar.status === "active").length;
  const pausedCount = radars.filter((radar) => radar.status === "paused").length;
  const displayName = String(user.user_metadata?.full_name || user.email?.split("@")[0] || "there");
  const findings = findingRows.map((row) => parseFinding(row, radarNames, notificationStatuses));
  const username = connection?.telegram_username ? `@${String(connection.telegram_username).replace(/^@/, "")}` : null;

  return (
    <div className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <WorkspaceNavigation locale={locale} currentPath="/dashboard" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-8">
        <div className="mx-auto w-full max-w-6xl min-w-0">
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{labels.title(displayName)}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">{labels.subtitle}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <LogoutButton
                labels={{
                  logout: labels.logout,
                  loggingOut: labels.loggingOut,
                  error: labels.logoutError,
                }}
              />
              <WorkspaceLocaleSwitcher locale={locale} userId={user.id} path="/dashboard" />
              <Link
                href={`/rules?lang=${locale}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-500"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {labels.newRadar}
              </Link>
            </div>
          </header>

          <section className="mt-7 flex min-w-0 flex-wrap items-center gap-4 rounded-3xl border border-violet-100 bg-violet-50 p-4 sm:p-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white">
              <Send className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-slate-950">{connection ? labels.telegramConnected : labels.telegramNotConnected}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {connection ? labels.telegramConnectedDescription(username) : labels.telegramNotConnectedDescription}
              </p>
            </div>
            <Link
              href={localize("/connect-telegram")}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-700 transition hover:bg-violet-100"
            >
              {connection ? labels.manage : labels.connect}
            </Link>
          </section>

          {workspaceDataError ? (
            <p role="alert" className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              {labels.dataAttentionDescription}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <span><strong className="text-slate-950">{activeCount}</strong> <span className="text-slate-600">{labels.running}</span></span>
            <span><strong className="text-slate-950">{pausedCount}</strong> <span className="text-slate-600">{labels.paused}</span></span>
            <span><strong className="text-slate-950">{attentionItems.length}</strong> <span className="text-slate-600">{labels.needsAttention}</span></span>
            <span className="ml-auto text-xs text-slate-500">{labels.activeSummary(activeCount)}</span>
          </div>

          <div className="mt-6 grid min-w-0 gap-6 min-[850px]:grid-cols-[0.78fr_1.22fr]">
            <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-950">{labels.attentionTitle}</h2>
                {attentionItems.length === 0 ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />}
              </div>
              {attentionItems.length === 0 ? (
                <div className="mt-4 rounded-2xl bg-emerald-50 p-4">
                  <p className="font-semibold text-emerald-900">{labels.healthyTitle}</p>
                  <p className="mt-1 text-sm leading-6 text-emerald-800">{labels.healthyDescription}</p>
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  {attentionItems.map((item) => (
                    <Link key={`${item.href}-${item.title}`} href={item.href} className="flex gap-3 rounded-2xl border-t border-slate-100 py-3 first:border-t-0 hover:bg-slate-50">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-600">{item.description}</span>
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section className="min-w-0">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">{labels.latestTitle}</h2>
                  <p className="mt-1 text-sm text-slate-500">{labels.acrossAll}</p>
                </div>
                <Link href={localize("/radars")} className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
                  {labels.viewAll}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
              {workspaceDataError ? (
                <div className="rounded-3xl border border-amber-100 bg-amber-50 p-8 text-center">
                  <p className="font-semibold text-amber-900">{labels.dataAttention}</p>
                  <p className="mt-2 text-sm leading-6 text-amber-800">{labels.dataAttentionDescription}</p>
                </div>
              ) : findings.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <p className="font-semibold text-slate-900">{labels.emptyTitle}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{labels.emptyDescription}</p>
                </div>
              ) : (
                <FindingsList findings={findings} locale={locale} limit={3} />
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
