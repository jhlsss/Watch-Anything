import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { RadarCard, type RadarCardRadar } from "@/components/radar/radar-card";
import { WorkspaceLocaleSwitcher, WorkspaceNavigation } from "@/components/radar/radar-actions";
import { normalizeLocale, type Locale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import type { RadarStatus } from "@/types/contracts";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type RadarRow = {
  id: string;
  name: string;
  status: RadarStatus;
  rules: unknown;
  last_checked_at: string | null;
  next_check_at: string | null;
};

type FindingCountRow = {
  radar_id: string;
  notification_eligible: boolean;
};

const copy = {
  en: {
    eyebrow: "Workspace",
    title: "My Radars",
    description: "Manage every Radar from one place.",
    newRadar: "New Radar",
    activeSummary: (active: number, total: number) => `${active} of 3 active · ${total} total`,
    limit: "You can run up to 3 Radars at once. Pause one before activating another.",
    emptyTitle: "No Radars yet",
    emptyDescription: "Start with a topic you want to keep an eye on.",
    createFirst: "Create your first Radar",
    loadError: "Some Radar data could not be loaded. Refresh and try again.",
    backDashboard: "Back to Dashboard",
  },
  "zh-CN": {
    eyebrow: "工作区",
    title: "我的 Radars",
    description: "在一个页面管理全部 Radar。",
    newRadar: "+ 新建 Radar",
    activeSummary: (active: number, total: number) => `${active} / 3 个运行中 · 共 ${total} 个`,
    limit: "最多同时运行 3 个 Radar。需要启用新的 Radar 时，请先暂停一个。",
    emptyTitle: "还没有 Radar",
    emptyDescription: "从一个你想持续关注的主题开始。",
    createFirst: "创建第一个 Radar",
    loadError: "部分 Radar 数据加载失败，请刷新后重试。",
    backDashboard: "返回 Dashboard",
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
  if (isLocale(requested)) return requested;
  const cookieLocale = (await cookies()).get("wa_locale")?.value;
  return isLocale(cookieLocale) ? cookieLocale : normalizeLocale(profileLocale);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function cardRadar(row: RadarRow, newFindings: number): RadarCardRadar {
  const rules = isRecord(row.rules) ? row.rules : {};
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    includeTopics: stringArray(rules.includeTopics),
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    newFindings,
  };
}

export default async function RadarsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const redirectLocale = await resolveLocale(params, null);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/auth?mode=login&next=dashboard&lang=${redirectLocale}`);
  }

  const [{ data: profile }, { data: radarData, error: radarError }] = await Promise.all([
    supabase.from("profiles").select("locale").eq("id", user.id).maybeSingle(),
    supabase
      .from("radars")
      .select("id,name,status,rules,last_checked_at,next_check_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const locale = await resolveLocale(params, (profile as { locale?: string } | null)?.locale ?? null);
  const labels = copy[locale];
  const localize = (href: string) => `${href}?lang=${locale}`;
  const radars = (radarData ?? []) as RadarRow[];
  const radarIds = radars.map((radar) => radar.id);
  let findingRows: FindingCountRow[] = [];
  let findingError = false;

  if (radarIds.length > 0) {
    const { data, error } = await supabase
      .from("findings")
      .select("radar_id,notification_eligible")
      .in("radar_id", radarIds)
      .eq("notification_eligible", true);
    findingRows = (data ?? []) as FindingCountRow[];
    findingError = Boolean(error);
  }

  const findingCounts = new Map<string, number>();
  findingRows.forEach((finding) => {
    if (finding.notification_eligible) {
      findingCounts.set(finding.radar_id, (findingCounts.get(finding.radar_id) ?? 0) + 1);
    }
  });

  const activeCount = radars.filter((radar) => radar.status === "active").length;
  const dataError = Boolean(radarError || findingError);

  return (
    <div className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <WorkspaceNavigation locale={locale} currentPath="/radars" />
      <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-8">
        <div className="mx-auto w-full max-w-6xl min-w-0">
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{labels.eyebrow}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{labels.title}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">{labels.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <WorkspaceLocaleSwitcher locale={locale} userId={user.id} path="/radars" />
              <Link
                href={`/rules?lang=${locale}`}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-500"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {labels.newRadar}
              </Link>
            </div>
          </header>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <p className="font-semibold text-slate-900">{labels.activeSummary(activeCount, radars.length)}</p>
            <Link href={localize("/dashboard")} className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:text-violet-900">
              {labels.backDashboard}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          {dataError ? (
            <p role="alert" className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
              {labels.loadError}
            </p>
          ) : null}

          {radars.length === 0 && !dataError ? (
            <section className="mt-7 rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">{labels.emptyTitle}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{labels.emptyDescription}</p>
              <Link
                href={`/rules?lang=${locale}`}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white transition hover:bg-violet-500"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {labels.createFirst}
              </Link>
            </section>
          ) : (
            <>
              <section className="mt-7 grid min-w-0 gap-4 min-[850px]:grid-cols-2">
                {radars.map((radar) => (
                  <RadarCard key={radar.id} radar={cardRadar(radar, findingCounts.get(radar.id) ?? 0)} locale={locale} />
                ))}
              </section>
              <p className="mt-4 rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-sm leading-6 text-slate-600">
                {labels.limit}
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
