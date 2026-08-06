"use client";

import { Hero } from "@/components/landing/hero";
import { SiteHeader } from "@/components/layout/site-header";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { use } from "react";

const RULE_FLOW_STORAGE_KEY = "watch-anything.rule-flow";

export default function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const rawLocale = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const locale = normalizeLocale(rawLocale);
  const copy = getMessages(locale);

  const saveOriginalPrompt = (prompt: string) => {
    if (typeof window === "undefined") {
      return;
    }

    if (!prompt) {
      window.localStorage.removeItem(RULE_FLOW_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      RULE_FLOW_STORAGE_KEY,
      JSON.stringify({ originalPrompt: prompt }),
    );
  };

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-slate-50 text-slate-950">
      <SiteHeader
        locale={locale}
        brand={copy.common.brand}
        localeLabel={copy.common.localeLabel}
        localeNames={copy.common.locales}
        navLinks={[
          { href: "/#how", label: copy.nav.howItWorks },
          { href: "/#templates", label: copy.nav.examples },
        ]}
        secondaryAction={{ href: "/auth", label: copy.nav.login }}
        primaryAction={{ href: "/rules", label: copy.nav.getStarted }}
      />

      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(167,139,250,0.18),_transparent_30%),linear-gradient(#ffffff,#faf7ff)]">
        <div className="mx-auto w-full max-w-6xl min-w-0 px-4 sm:px-6">
          <Hero
            locale={locale}
            title={copy.landing.title}
            kicker={copy.landing.kicker}
            description={copy.landing.description}
            inputPlaceholder={copy.landing.inputPlaceholder}
            primaryCta={copy.landing.primaryCta}
            helper={copy.landing.helper}
            examples={copy.landing.examples}
            onParseRequest={saveOriginalPrompt}
          />
        </div>
      </div>

      <section className="bg-[#f5f2fb] py-16">
        <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-6 px-4 sm:px-6 min-[850px]:grid-cols-[0.78fr_1.22fr]">
          <div className="space-y-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.landing.proofEyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.landing.proofTitle}</h2>
            <p className="text-sm leading-7 text-slate-600">{copy.landing.proofDescription}</p>
          </div>
          <div className="rounded-3xl border border-violet-100 bg-white p-6 shadow-sm">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-950">{copy.landing.proofRadarName}</p>
              <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
                <Activity className="h-4 w-4" aria-hidden="true" />
                {copy.landing.proofStatus}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{copy.landing.proofSummary}</p>
            <div className="mt-5 grid grid-cols-1 gap-3 min-[850px]:grid-cols-4">
              {[2, 8, 2, 1].map((value, index) => (
                <div key={copy.landing.proofMetrics[index]} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-2xl font-semibold text-slate-950">{value}</p>
                  <p className="mt-1 text-xs text-slate-500">{copy.landing.proofMetrics[index]}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="py-16">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.landing.flowEyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.landing.flowTitle}</h2>
            <p className="text-sm leading-7 text-slate-600">{copy.landing.flowDescription}</p>
          </div>

          <div className="mt-8 grid gap-4 min-[850px]:grid-cols-3">
            {copy.landing.stages.map((stage) => (
              <article key={stage.step} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-sm font-extrabold text-violet-600">{stage.step}</p>
                <h3 className="mt-6 text-xl font-semibold text-slate-950">{stage.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{stage.description}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {stage.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                      {tag}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="templates" className="bg-white py-16">
        <div className="mx-auto w-full max-w-6xl min-w-0 px-4 sm:px-6">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.landing.templateEyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.landing.templateTitle}</h2>
            <p className="text-sm leading-7 text-slate-600">{copy.landing.templateDescription}</p>
          </div>

          <div className="mt-8 grid gap-4 min-[850px]:grid-cols-2">
            {copy.landing.templates.map(([title, description]) => (
              <Link
                key={title}
                href={`/rules?lang=${locale}`}
                className="flex min-w-0 items-center justify-between rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200"
              >
                <div>
                  <h3 className="font-semibold text-slate-950">{title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{description}</p>
                </div>
                <ArrowUpRight className="h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto w-full max-w-5xl min-w-0 px-4 sm:px-6">
          <div className="rounded-[2rem] border border-violet-100 bg-[linear-gradient(135deg,#ede9fe,#ffffff)] p-8 text-center shadow-sm">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.landing.finalTitle}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-600">{copy.landing.finalDescription}</p>
            <div className="mx-auto mt-6 flex max-w-2xl flex-col gap-3 rounded-3xl bg-white p-3 shadow-lg shadow-violet-100/50 min-[850px]:flex-row">
              <input
                placeholder={copy.landing.inputPlaceholder}
                className="min-h-12 flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-violet-300"
              />
              <Link
                href={`/rules?lang=${locale}`}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-violet-600 px-5 text-sm font-semibold text-white"
              >
                {copy.landing.secondaryCta}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
