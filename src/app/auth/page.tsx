"use client";

import { useMemo, useState } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteHeader } from "@/components/layout/site-header";
import { getMessages, normalizeLocale } from "@/lib/i18n";

export default function AuthPage({
  searchParams,
}: {
  searchParams?: { lang?: string; mode?: string };
}) {
  const locale = normalizeLocale(searchParams?.lang);
  const copy = getMessages(locale);
  const initialMode = searchParams?.mode === "signup" ? "signup" : "login";
  const [message, setMessage] = useState("");

  const actions = useMemo(
    () => ({
      locale,
      brand: copy.common.brand,
      localeLabel: copy.common.localeLabel,
      localeNames: copy.common.locales,
    }),
    [copy.common.brand, copy.common.localeLabel, copy.common.locales, locale],
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader
        {...actions}
        basePath="/auth"
        primaryAction={{ href: "/rules", label: copy.nav.getStarted }}
      />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-10 sm:px-6 min-[850px]:grid-cols-[1fr_360px] min-[850px]:items-center min-[850px]:py-16">
        <section className="space-y-5">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.auth.eyebrow}</p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950">{copy.auth.title}</h1>
            <p className="max-w-xl text-sm leading-7 text-slate-600">{copy.auth.description}</p>
          </div>
          <div className="max-w-md rounded-3xl border border-violet-100 bg-violet-50 p-4 text-sm leading-6 text-violet-800">
            {copy.auth.returnNote}
          </div>
        </section>

        <div>
          <AuthForm
            locale={locale}
            initialMode={initialMode}
            onAuthenticate={() => {
              setMessage(copy.auth.success);
            }}
          />
          {message ? <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p> : null}
        </div>
      </div>
    </main>
  );
}
