import Link from "next/link";
import { ExternalLink } from "lucide-react";

import type { Locale } from "@/lib/i18n";
import type { NotificationStatus } from "@/types/contracts";

export interface FindingsListFinding {
  id: string;
  radarId: string;
  radarName?: string;
  title: string;
  summary: string;
  sourceDomain: string;
  sourceUrl: string;
  publishedAt: string | null;
  firstSeenAt: string | null;
  relevanceScore: number;
  importanceScore: number;
  matchReason: string;
  notificationStatus: NotificationStatus | null;
}

const copy = {
  en: {
    source: "Source",
    found: "Found",
    importance: "Importance",
    relevance: "Match",
    viewSource: "View source",
    sent: "Sent to Telegram",
    pending: "Notification pending",
    failed: "Notification failed",
    unknown: "Notification status unconfirmed",
    saved: "Saved in workspace",
    emptyTitle: "No important findings yet",
    emptyDescription: "Your next successful check will appear here.",
  },
  "zh-CN": {
    source: "来源",
    found: "发现于",
    importance: "重要度",
    relevance: "匹配度",
    viewSource: "查看来源",
    sent: "已发送到 Telegram",
    pending: "通知处理中",
    failed: "通知发送失败",
    unknown: "通知状态未确认",
    saved: "已保存到工作区",
    emptyTitle: "还没有重要发现",
    emptyDescription: "下一次成功检查后，新的结果会显示在这里。",
  },
} as const;

function formatDate(value: string | null, locale: Locale) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function notificationLabel(status: NotificationStatus | null, labels: (typeof copy)[Locale]) {
  if (status === "sent") return labels.sent;
  if (status === "pending" || status === "sending") return labels.pending;
  if (status === "failed") return labels.failed;
  if (status === "unknown") return labels.unknown;
  return labels.saved;
}

export function FindingsList({
  findings,
  locale,
  limit,
}: {
  findings: FindingsListFinding[];
  locale: Locale;
  limit?: number;
}) {
  const labels = copy[locale];
  const visibleFindings = findings
    .filter((finding) => finding.relevanceScore > 0 && finding.importanceScore > 0)
    .slice(0, limit);

  if (visibleFindings.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="font-semibold text-slate-900">{labels.emptyTitle}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">{labels.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      {visibleFindings.map((finding) => (
        <article key={finding.id} className="min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {finding.radarName ? (
                <Link
                  href={`/radars/${finding.radarId}?lang=${locale}`}
                  className="text-xs font-extrabold uppercase tracking-[0.12em] text-violet-600 hover:text-violet-800"
                >
                  {finding.radarName}
                </Link>
              ) : null}
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{labels.source}</span>
                <span aria-hidden="true">·</span>
                <span>{finding.sourceDomain}</span>
                <span aria-hidden="true">·</span>
                <span>{labels.found} {formatDate(finding.firstSeenAt ?? finding.publishedAt, locale)}</span>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
              {notificationLabel(finding.notificationStatus, labels)}
            </span>
          </div>

          <h3 className="mt-3 break-words text-base font-semibold leading-6 text-slate-950">{finding.title}</h3>
          <p className="mt-2 break-words text-sm leading-6 text-slate-600">{finding.summary}</p>

          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-700">
              {labels.importance} {finding.importanceScore}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">
              {labels.relevance} {finding.relevanceScore}
            </span>
          </div>

          <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 break-words text-xs leading-5 text-slate-500">
              {finding.matchReason}
            </p>
            <Link
              href={finding.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet-700 hover:text-violet-900"
            >
              {labels.viewSource}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
