"use client";

import { use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { RulesForm } from "@/components/radar/rules-form";
import { normalizeLocale, getMessages } from "@/lib/i18n";
import type { RadarRules } from "@/types/contracts";

export default function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const lang = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const request = Array.isArray(params.request) ? params.request[0] : params.request;
  const locale = normalizeLocale(lang);
  const copy = getMessages(locale);
  const router = useRouter();

  const initialRules = useMemo<RadarRules>(
    () => ({
      radarName: copy.rules.defaults.radarName,
      subject: request?.trim() || copy.rules.defaults.subject,
      aliases: [...copy.rules.defaults.aliases],
      includeTopics: [...copy.rules.defaults.includeTopics],
      excludeTopics: [...copy.rules.defaults.excludeTopics],
      searchQuery: copy.rules.defaults.searchQuery,
      importanceThreshold: 75,
      intervalMinutes: 360,
    }),
    [copy.rules.defaults, request],
  );

  return (
    <main className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/rules" />
      <div className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-6xl">
          <RulesForm
            initialRules={initialRules}
            locale={locale}
            onConfirmRules={() => {
              router.push(`/auth?lang=${locale}&mode=signup`);
            }}
          />
        </div>
      </div>
    </main>
  );
}
