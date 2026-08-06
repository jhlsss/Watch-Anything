import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";

import type { Locale } from "@/lib/i18n";
import type { RunStatus } from "@/types/contracts";

export interface RunHistoryRun {
  id: string;
  trigger: "baseline" | "schedule" | "manual";
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  candidateCount: number;
  relevantCount: number;
  notificationCount: number;
  sourceCount: number;
}

const copy = {
  en: {
    title: "Run history",
    description: "Every check leaves a short, user-readable record.",
    running: "Running",
    success: "Success",
    failed: "Failed",
    baseline: "First check",
    schedule: "Scheduled check",
    manual: "Manual check",
    sources: "sources",
    candidates: "candidates",
    relevant: "relevant",
    notified: "notified",
    failedDescription: "This check failed. Try again from the Radar actions.",
    emptyTitle: "No runs yet",
    emptyDescription: "The first check will appear here after the Radar starts.",
  },
  "zh-CN": {
    title: "运行记录",
    description: "每次检查都会留下简短、易读的运行记录。",
    running: "运行中",
    success: "成功",
    failed: "失败",
    baseline: "首次检查",
    schedule: "定时检查",
    manual: "立即检查",
    sources: "个来源",
    candidates: "条候选",
    relevant: "条相关",
    notified: "条通知",
    failedDescription: "本次检查失败。请从 Radar 操作中重试。",
    emptyTitle: "还没有运行记录",
    emptyDescription: "Radar 开始首次检查后，记录会显示在这里。",
  },
} as const;

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(startedAt: string, finishedAt: string | null, locale: Locale) {
  if (!finishedAt) {
    return null;
  }

  const duration = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  const seconds = (duration / 1000).toFixed(1);
  return locale === "zh-CN" ? `耗时 ${seconds} 秒` : `Completed in ${seconds}s`;
}

function statusLabel(status: RunStatus, labels: (typeof copy)[Locale]) {
  return status === "running" ? labels.running : status === "success" ? labels.success : labels.failed;
}

function triggerLabel(trigger: RunHistoryRun["trigger"], labels: (typeof copy)[Locale]) {
  return labels[trigger];
}

export function RunHistory({ runs, locale }: { runs: RunHistoryRun[]; locale: Locale }) {
  const labels = copy[locale];

  if (runs.length === 0) {
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="font-semibold text-slate-900">{labels.emptyTitle}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{labels.emptyDescription}</p>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{labels.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{labels.description}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {runs.map((run) => {
          const status = statusLabel(run.status, labels);
          const duration = formatDuration(run.startedAt, run.finishedAt, locale);
          const StatusIcon = run.status === "running" ? LoaderCircle : run.status === "success" ? CheckCircle2 : CircleAlert;

          return (
            <article key={run.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <StatusIcon
                    className={
                      run.status === "running"
                        ? "mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-600"
                        : run.status === "success"
                          ? "mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                          : "mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                    }
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{formatDate(run.startedAt, locale)}</p>
                    <p className="mt-1 text-xs text-slate-500">{triggerLabel(run.trigger, labels)}</p>
                  </div>
                </div>
                <span
                  className={
                    run.status === "failed"
                      ? "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                      : run.status === "running"
                        ? "rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700"
                        : "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                  }
                >
                  {status}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-white px-2.5 py-1">{run.sourceCount} {labels.sources}</span>
                <span className="rounded-full bg-white px-2.5 py-1">{run.candidateCount} {labels.candidates}</span>
                <span className="rounded-full bg-white px-2.5 py-1">{run.relevantCount} {labels.relevant}</span>
                <span className="rounded-full bg-white px-2.5 py-1">{run.notificationCount} {labels.notified}</span>
                {duration ? <span className="rounded-full bg-white px-2.5 py-1">{duration}</span> : null}
              </div>

              {run.status === "failed" ? (
                <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {labels.failedDescription}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
