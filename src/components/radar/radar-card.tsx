import Link from "next/link";
import { Radar as RadarIcon } from "lucide-react";

import type { Locale } from "@/lib/i18n";
import type { RadarStatus } from "@/types/contracts";

export interface RadarCardRadar {
  id: string;
  name: string;
  status: RadarStatus;
  includeTopics: string[];
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  newFindings: number;
}

const copy = {
  en: {
    active: "Running",
    paused: "Paused",
    lastCheck: "Last check",
    nextCheck: "Next check",
    newFindings: "New findings",
    pausedNext: "—",
    noCheck: "Not checked yet",
    view: "View Radar →",
  },
  "zh-CN": {
    active: "运行中",
    paused: "已暂停",
    lastCheck: "上次检查",
    nextCheck: "下次检查",
    newFindings: "新发现",
    pausedNext: "—",
    noCheck: "尚未检查",
    view: "查看 Radar →",
  },
} as const;

function formatDate(value: string | null, locale: Locale, empty: string) {
  if (!value) {
    return empty;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return empty;
  }

  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function RadarCard({ radar, locale }: { radar: RadarCardRadar; locale: Locale }) {
  const labels = copy[locale];
  const statusLabel = radar.status === "paused" ? labels.paused : labels.active;
  const nextCheck = radar.status === "paused"
    ? labels.pausedNext
    : formatDate(radar.nextCheckAt, locale, labels.noCheck);

  return (
    <article className="min-w-0 rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md">
      <Link
        href={`/radars/${radar.id}?lang=${locale}`}
        aria-label={radar.name}
        className="block min-w-0 p-5 outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-700">
              <RadarIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-slate-950">{radar.name}</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {radar.includeTopics.slice(0, 3).map((topic) => (
                  <span key={topic} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <span
            className={
              radar.status === "paused"
                ? "shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
                : "shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
            }
          >
            {statusLabel}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-xs">
          <div className="min-w-0">
            <p className="text-slate-500">{labels.lastCheck}</p>
            <p className="mt-1 truncate font-semibold text-slate-900">
              {formatDate(radar.lastCheckedAt, locale, labels.noCheck)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-slate-500">{labels.newFindings}</p>
            <p className="mt-1 font-semibold text-slate-900">{radar.newFindings}</p>
          </div>
          <div className="min-w-0">
            <p className="text-slate-500">{labels.nextCheck}</p>
            <p className="mt-1 truncate font-semibold text-slate-900">{nextCheck}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end text-xs font-semibold text-violet-700">
          {labels.view}
        </div>
      </Link>
    </article>
  );
}
