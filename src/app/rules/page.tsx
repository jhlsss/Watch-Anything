"use client";

import { useMemo, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { RulesForm } from "@/components/radar/rules-form";
import { normalizeLocale, getMessages } from "@/lib/i18n";
import type { RadarRules } from "@/types/contracts";

export default function RulesPage({
  searchParams,
}: {
  searchParams?: { lang?: string };
}) {
  const locale = normalizeLocale(searchParams?.lang);
  const copy = getMessages(locale);
  const [latestSubmission, setLatestSubmission] = useState<RadarRules | null>(null);

  const initialRules = useMemo<RadarRules>(
    () => ({
      radarName: "LISA Official Radar",
      subject:
        locale === "zh-CN"
          ? "关注 LISA 的官方音乐发布、巡演和重要合作，只使用可信公开来源。"
          : "Track important official LISA music releases, tours and partnerships from trusted public sources.",
      aliases: ["Lalisa Manobal"],
      includeTopics: locale === "zh-CN" ? ["官方采访", "巡演安排"] : ["Official interviews", "Tour schedules"],
      excludeTopics: locale === "zh-CN" ? ["二创剪辑"] : ["Fan edits"],
      searchQuery: "LISA official interview OR official release OR tour",
      importanceThreshold: 75,
      intervalMinutes: 360,
    }),
    [locale],
  );

  return (
    <main className="flex min-h-screen bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/rules" />
      <div className="flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-6xl">
          <RulesForm initialRules={initialRules} locale={locale} onConfirmRules={setLatestSubmission} />
          {latestSubmission ? (
            <div className="mt-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
              {copy.rules.success}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
