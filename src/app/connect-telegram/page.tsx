"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ConnectCard } from "@/components/telegram/connect-card";
import { getMessages, normalizeLocale } from "@/lib/i18n";

export default function ConnectTelegramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const lang = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const locale = normalizeLocale(lang);
  const copy = getMessages(locale);
  const router = useRouter();

  return (
    <main className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/connect-telegram" />
      <div className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <ConnectCard
            locale={locale}
            onConnectTelegram={() => {
              router.push(`/rules?lang=${locale}&telegram=pending`);
            }}
          />
          <p className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{copy.telegram.waiting}</p>
        </div>
      </div>
    </main>
  );
}
