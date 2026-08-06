"use client";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { ConnectCard } from "@/components/telegram/connect-card";
import { getMessages, normalizeLocale } from "@/lib/i18n";

export default function ConnectTelegramPage({
  searchParams,
}: {
  searchParams?: { lang?: string };
}) {
  const locale = normalizeLocale(searchParams?.lang);
  const copy = getMessages(locale);

  return (
    <main className="flex min-h-screen bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/connect-telegram" />
      <div className="flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <ConnectCard locale={locale} onConnectTelegram={() => undefined} />
          <p className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{copy.telegram.waiting}</p>
        </div>
      </div>
    </main>
  );
}
