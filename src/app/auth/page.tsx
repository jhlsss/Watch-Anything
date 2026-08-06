"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteHeader } from "@/components/layout/site-header";
import { getMessages, normalizeLocale } from "@/lib/i18n";

export default function AuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const lang = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const locale = normalizeLocale(lang);
  const copy = getMessages(locale);
  const initialMode = mode === "signup" ? "signup" : "login";
  const router = useRouter();

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <SiteHeader
        locale={locale}
        brand={copy.common.brand}
        localeLabel={copy.common.localeLabel}
        localeNames={copy.common.locales}
        basePath="/auth"
        primaryAction={{ href: "/rules", label: copy.nav.getStarted }}
      />

      <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-10 px-4 py-10 sm:px-6 min-[850px]:grid-cols-[1fr_360px] min-[850px]:items-center min-[850px]:py-16">
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
              router.push(`/connect-telegram?lang=${locale}`);
            }}
          />
        </div>
      </div>
    </main>
  );
}
