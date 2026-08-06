"use client";

import { Hero } from "@/components/landing/hero";
import { SiteHeader } from "@/components/layout/site-header";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { Activity, ArrowRight, ArrowUpRight, BriefcaseBusiness, Building2, Radio, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState, type MouseEvent, type SyntheticEvent } from "react";

const RULE_FLOW_STORAGE_KEY = "watch-anything.rule-flow";
const LANDING_RAIL = "mx-auto w-[calc(100%_-_28px)] max-w-[1160px] min-w-0 min-[850px]:w-[calc(100%_-_44px)]";
const TEMPLATE_ICONS = [Sparkles, Building2, Radio, BriefcaseBusiness];

export default function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const rawLocale = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const locale = normalizeLocale(rawLocale);
  const copy = getMessages(locale);
  const router = useRouter();
  const [heroRequest, setHeroRequest] = useState("");
  const [ctaRequest, setCtaRequest] = useState("");
  const [ctaRequestError, setCtaRequestError] = useState(false);
  const [currentHash, setCurrentHash] = useState("");

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const updateHash = () => setCurrentHash(window.location.hash);

    updateHash();
    window.addEventListener("hashchange", updateHash);

    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

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

  const ctaHref = `/rules?lang=${locale}${ctaRequest.trim() ? `&request=${encodeURIComponent(ctaRequest.trim())}` : ""}`;

  const handleCtaClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!ctaRequest.trim()) {
      event.preventDefault();
      setCtaRequestError(true);
      return;
    }

    setCtaRequestError(false);
    saveOriginalPrompt(ctaRequest.trim());
  };

  const submitCtaRequest = (event: SyntheticEvent) => {
    event.preventDefault();

    if (!ctaRequest.trim()) {
      setCtaRequestError(true);
      return;
    }

    setCtaRequestError(false);
    saveOriginalPrompt(ctaRequest.trim());
    router.push(ctaHref);
  };

  return (
    <main className="min-h-screen min-w-0 overflow-x-hidden bg-slate-50 font-sans text-slate-950">
      <SiteHeader
        locale={locale}
        brand={copy.common.brand}
        localeLabel={copy.common.localeLabel}
        localeNames={copy.common.locales}
        currentHash={currentHash}
        navLinks={[
          { href: "/#how", label: copy.nav.howItWorks },
          { href: "/#templates", label: copy.nav.examples },
        ]}
        secondaryAction={{ href: "/auth", label: copy.nav.login }}
        primaryAction={{ href: "/#hero-request", label: copy.nav.getStarted }}
      />

      <div className="border-b border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(167,139,250,0.18),_transparent_30%),linear-gradient(#ffffff,#faf7ff)]">
        <div className={LANDING_RAIL}>
          <Hero
            locale={locale}
            title={copy.landing.title}
            kicker={copy.landing.kicker}
            description={copy.landing.description}
            inputPlaceholder={copy.landing.inputPlaceholder}
            primaryCta={copy.landing.primaryCta}
            helper={copy.landing.helper}
            examples={copy.landing.examples}
            request={heroRequest}
            onRequestChange={setHeroRequest}
            onParseRequest={saveOriginalPrompt}
          />
        </div>
      </div>

      <section className="bg-[#f5f2fb] py-16 min-[850px]:py-[92px]">
        <div className={`${LANDING_RAIL} grid gap-6 min-[850px]:grid-cols-[0.78fr_1.22fr]`}>
          <div className="space-y-4">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.landing.proofEyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950 min-[850px]:text-[42px] min-[850px]:leading-[1.06] min-[850px]:tracking-[-0.04em]">{copy.landing.proofTitle}</h2>
            <p className="text-sm leading-7 text-slate-600">{copy.landing.proofDescription}</p>
          </div>
          <div className="rounded-[20px] border border-violet-100 bg-white p-6 shadow-sm">
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
            <div className="mt-3 space-y-2">
              {copy.landing.proofFindings.slice(0, 1).map((finding, index) => {
                const FindingIcon = ArrowUpRight;

                return (
                  <article key={finding.radarName} className="flex min-w-0 items-center gap-3 rounded-2xl bg-slate-50 p-3.5">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
                      <FindingIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-950">
                        {index === 0 ? copy.landing.proofFindingTitle : finding.radarName}
                      </p>
                      <p className="mt-1 truncate text-[10px] text-slate-500">
                        {index === 0 ? copy.landing.proofFindingMeta : `${finding.secondaryLabel} ${finding.secondary}`}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] font-semibold text-violet-600">
                      {index === 0 ? copy.landing.proofFindingScore : finding.time}
                    </span>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="py-16 min-[850px]:py-[92px]">
        <div className={LANDING_RAIL}>
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.landing.flowEyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950 min-[850px]:text-[38px] min-[850px]:leading-[1.08] min-[850px]:tracking-[-0.035em]">{copy.landing.flowTitle}</h2>
            <p className="text-sm leading-7 text-slate-600">{copy.landing.flowDescription}</p>
          </div>

          <div className="mt-8 grid gap-4 min-[850px]:grid-cols-3">
            {copy.landing.stages.map((stage, index) => (
              <div key={stage.step} className="relative">
                <article className="h-full rounded-[17px] border border-slate-200 bg-white p-6 shadow-sm">
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
                {index < copy.landing.stages.length - 1 ? (
                  <ArrowRight
                    aria-label={copy.landing.nextStep}
                    className="absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 rounded-full border border-slate-200 bg-[#f5f2fb] p-1 text-violet-400 min-[850px]:block"
                    aria-hidden="false"
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="templates" className="bg-white py-16 min-[850px]:py-[92px]">
        <div className={LANDING_RAIL}>
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.landing.templateEyebrow}</p>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950 min-[850px]:text-[38px] min-[850px]:leading-[1.08] min-[850px]:tracking-[-0.035em]">{copy.landing.templateTitle}</h2>
            <p className="text-sm leading-7 text-slate-600">{copy.landing.templateDescription}</p>
          </div>

          <div className="mt-8 grid gap-4 min-[850px]:grid-cols-2">
            {copy.landing.templates.map(([title, description, request], index) => {
              const TemplateIcon = TEMPLATE_ICONS[index] ?? Sparkles;

              return (
                <button
                  key={title}
                  type="button"
                  onClick={() => {
                    setHeroRequest(request);
                    const requestSection = document.getElementById("hero-request");
                    requestSection?.scrollIntoView?.({ behavior: "smooth", block: "center" });
                    document.querySelector<HTMLInputElement>("#hero-request input")?.focus();
                  }}
                  className="flex min-w-0 items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
                    <TemplateIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-950">{title}</h3>
                    <p className="mt-2 text-sm text-slate-600">{description}</p>
                  </div>
                  <ArrowUpRight className="h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-16 pt-10 min-[850px]:pb-16 min-[850px]:pt-[30px]">
        <div className={LANDING_RAIL}>
          <div className="rounded-3xl border border-violet-100 bg-[linear-gradient(135deg,#ede9fe,#ffffff)] p-8 text-center shadow-sm">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950 min-[850px]:text-[38px] min-[850px]:leading-[1.08] min-[850px]:tracking-[-0.035em]">{copy.landing.finalTitle}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-600">{copy.landing.finalDescription}</p>
            <form onSubmit={submitCtaRequest} className="mx-auto mt-6 flex max-w-2xl flex-col gap-3 rounded-[15px] bg-white p-2 shadow-lg shadow-violet-100/50 min-[850px]:flex-row">
              <input
                value={ctaRequest}
                onChange={(event) => {
                  setCtaRequest(event.target.value);
                  if (event.target.value.trim()) {
                    setCtaRequestError(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitCtaRequest(event);
                  }
                }}
                placeholder={copy.landing.finalInputPlaceholder}
                required
                aria-invalid={ctaRequestError}
                aria-describedby={ctaRequestError ? "cta-request-error" : undefined}
                className="min-h-12 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-200"
              />
              <Link
                href={ctaHref}
                onClick={handleCtaClick}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-semibold text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
              >
                {copy.landing.secondaryCta}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </form>
            {ctaRequestError ? (
              <p id="cta-request-error" role="alert" className="mt-3 text-sm font-medium text-rose-600">
                {copy.landing.requestRequired}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white py-8">
        <div className={`${LANDING_RAIL} flex flex-col gap-2 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between`}>
          <span className="font-semibold text-slate-700">Watch Anything</span>
          <span>{copy.landing.footerCopyright}</span>
        </div>
      </footer>
    </main>
  );
}
