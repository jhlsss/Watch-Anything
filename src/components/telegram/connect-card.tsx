"use client";

import { Send } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

interface ConnectCardProps {
  locale: Locale;
  botUrl?: string | null;
  isPreparing?: boolean;
  onConnectTelegram: (payload: { username: string }) => void;
}

export function ConnectCard({ locale, botUrl, isPreparing = false, onConnectTelegram }: ConnectCardProps) {
  const copy = getMessages(locale).telegram;

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="space-y-2">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.eyebrow}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
        <p className="text-sm leading-6 text-slate-600">{copy.description}</p>
      </div>

      <div className="mt-6 flex min-w-0 flex-wrap items-center gap-4 rounded-3xl border border-violet-100 bg-violet-50 p-4">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-violet-600 text-white">
          <Send className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">{copy.botLabel}</p>
          <p className="text-sm text-slate-600">@watchanything_bot · {copy.botHint}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-3">
        {copy.steps.map((step, index) => (
          <div key={step} className="flex gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-bold text-violet-700">
              {index + 1}
            </span>
            <p>{step}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3 min-[850px]:flex-row">
        {botUrl ? (
          <a
            href={botUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            {copy.openBot}
          </a>
        ) : null}
        <Button
          disabled={isPreparing}
          className="h-11 rounded-2xl bg-violet-600 text-white hover:bg-violet-500"
          onClick={() => {
            onConnectTelegram({ username: "@watchanything_bot" });
          }}
        >
          {isPreparing ? copy.preparing : copy.connect}
        </Button>
        <Link
          href={`/rules?lang=${locale}`}
          className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
        >
          {copy.skip}
        </Link>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        {copy.waiting}
      </div>
    </section>
  );
}
