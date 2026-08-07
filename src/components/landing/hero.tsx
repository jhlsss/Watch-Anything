"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BatteryFull,
  Bell,
  Building2,
  LoaderCircle,
  Send,
  Signal,
  Wifi,
} from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

interface HeroProps {
  locale: Locale;
  title: string;
  kicker: string;
  description: string;
  inputPlaceholder: string;
  primaryCta: string;
  helper: string;
  examples: readonly string[];
  request?: string;
  onRequestChange?: (request: string) => void;
  onParseRequest?: (request: string) => void;
  capacityReached?: boolean;
}

function renderHeadline(title: string, locale: Locale) {
  if (locale === "en") {
    const [lead, accent] = title.split(" what ");

    return (
      <>
        {lead}
        <br />
        what <span className="text-violet-600">{accent}</span>
      </>
    );
  }

  const [lead, accent] = title.split("，");

  return (
    <>
      {lead}，
      <br />
      <span className="text-violet-600">{accent ?? title}</span>
    </>
  );
}

export function Hero({
  locale,
  title,
  kicker,
  description,
  inputPlaceholder,
  primaryCta,
  helper,
  examples,
  request: controlledRequest,
  onRequestChange,
  onParseRequest,
  capacityReached = false,
}: HeroProps) {
  const router = useRouter();
  const [uncontrolledRequest, setUncontrolledRequest] = useState("");
  const [requestError, setRequestError] = useState(false);
  const [capacityError, setCapacityError] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const parseTimerRef = useRef<number | null>(null);
  const request = controlledRequest ?? uncontrolledRequest;
  const messages = getMessages(locale);
  const copy = messages.landing;
  const rulesHref = `/rules?lang=${locale}${request.trim() ? `&request=${encodeURIComponent(request.trim())}` : ""}`;
  const previewFindings = copy.proofFindings.slice(0, 2);

  useEffect(() => {
    return () => {
      if (parseTimerRef.current !== null) {
        window.clearTimeout(parseTimerRef.current);
      }
    };
  }, []);

  const setRequest = (nextRequest: string) => {
    if (controlledRequest === undefined) {
      setUncontrolledRequest(nextRequest);
    }

    onRequestChange?.(nextRequest);
  };

  const startRequest = () => {
    if (isParsing) {
      return;
    }

    if (!request.trim()) {
      setRequestError(true);
      return;
    }

    if (capacityReached) {
      setRequestError(false);
      setCapacityError(true);
      return;
    }

    setRequestError(false);
    setCapacityError(false);
    setIsParsing(true);
    onParseRequest?.(request.trim());
    parseTimerRef.current = window.setTimeout(() => {
      router.push(rulesHref);
    }, 650);
  };

  const submitRequest = (event: SyntheticEvent) => {
    event.preventDefault();
    startRequest();
  };

  const handlePrimaryClick = (event: MouseEvent<HTMLAnchorElement>) => {
    submitRequest(event);
  };

  return (
    <section className="grid min-w-0 gap-10 py-10 min-[850px]:min-h-[610px] min-[850px]:grid-cols-[1.02fr_0.98fr] min-[850px]:items-center min-[850px]:gap-[52px] min-[850px]:py-[46px] min-[850px]:pb-[72px]">
      <div className="space-y-6">
        <div className="text-sm font-extrabold uppercase tracking-[0.18em] text-violet-600">{kicker}</div>
        <div className="space-y-4">
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.04] tracking-tight text-slate-950 sm:text-5xl min-[850px]:text-[64px] min-[850px]:leading-[0.99] min-[850px]:tracking-[-0.05em]">
            {renderHeadline(title, locale)}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{description}</p>
        </div>

        <form id="hero-request" onSubmit={submitRequest} className="rounded-[15px] border border-violet-100 bg-white p-2 shadow-xl shadow-violet-100/50">
          <div className="flex flex-col gap-3 min-[850px]:flex-row">
            <input
              value={request}
              disabled={isParsing}
              onChange={(event) => {
                setRequest(event.target.value);
                if (event.target.value.trim()) {
                  setRequestError(false);
                }
                setCapacityError(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                submitRequest(event);
              }}
              placeholder={inputPlaceholder}
              required
              aria-invalid={requestError}
              aria-describedby={requestError ? "hero-request-error" : undefined}
              className="min-h-12 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-200"
            />
            <Link
              href={rulesHref}
              onClick={handlePrimaryClick}
              aria-disabled={isParsing}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-medium text-white transition hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 aria-disabled:pointer-events-none aria-disabled:opacity-80"
            >
              {primaryCta}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {isParsing ? (
            <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm font-medium text-violet-700">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              {copy.heroUnderstanding}
            </p>
          ) : capacityError ? (
            <p id="hero-capacity-error" role="alert" className="mt-3 text-sm font-medium text-rose-600">
              {copy.capacityReached} {" "}
              <Link href={`/dashboard?lang=${locale}`} className="font-semibold underline underline-offset-2">
                {copy.openWorkspace}
              </Link>
            </p>
          ) : requestError ? (
            <p id="hero-request-error" role="alert" className="mt-3 text-sm font-medium text-rose-600">
              {copy.requestRequired}
            </p>
          ) : null}
        </form>

        <div className="space-y-3">
          <p className="text-sm text-slate-500">{helper}</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setRequest(example);
                  setRequestError(false);
                  setCapacityError(false);
                }}
                className="min-h-11 rounded-full border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-600 transition hover:border-violet-200 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex min-h-[480px] w-full max-w-[430px] items-center justify-center min-[850px]:min-h-[520px]">
        <div className="absolute h-[330px] w-[330px] rounded-full bg-violet-100 blur-3xl min-[850px]:h-[430px] min-[850px]:w-[430px]" />
        <div className="absolute right-[10%] top-[15%] h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_0_8px_rgba(221,214,254,0.45)]" />
        <div className="relative w-[285px] rotate-[1.5deg] rounded-[2.75rem] bg-slate-950 p-2 shadow-2xl shadow-violet-200 min-[850px]:w-[310px]">
          <div className="relative overflow-hidden rounded-[2.25rem] bg-gradient-to-b from-slate-50 to-lime-50">
            <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-slate-950" aria-hidden="true" />
            <div
              className="flex items-center justify-between border-b border-slate-200/70 bg-white px-5 pb-3 pt-4 text-xs font-semibold text-slate-500"
              aria-label={copy.previewDeviceStatus}
            >
              <span>9:41</span>
              <span className="flex items-center gap-1.5" aria-hidden="true">
                <Signal className="h-3.5 w-3.5" />
                <Wifi className="h-3.5 w-3.5" />
                <BatteryFull className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="flex items-center gap-2 border-b border-slate-200/70 bg-white px-4 py-3">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-violet-600 text-white">
                <Send className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-900">{messages.common.brand}</p>
                <p className="text-[10px] font-medium text-slate-400">{copy.previewBotLabel}</p>
              </div>
            </div>
            <div className="space-y-2 p-2.5">
              {previewFindings.map((finding, index) => {
                const FindingIcon = index === 0 ? Bell : Building2;

                return (
                  <article key={`${finding.radarName}-${finding.time}`} className="rounded-[14px] bg-white p-3 text-[11px] leading-[1.48] shadow-sm">
                    <p className="flex items-center gap-1 font-semibold text-violet-600">
                      <FindingIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {finding.radarName}
                    </p>
                    <p className="mt-1.5 font-medium text-slate-900">{finding.message}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span>{finding.detailLabel}</span>
                      <span className="font-semibold text-slate-700">{finding.detail}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                      <span>{finding.secondaryLabel}</span>
                      <span className="font-semibold text-slate-700">{finding.secondary}</span>
                    </div>
                    <p className="mt-2 font-semibold text-violet-600">
                      {copy.viewSource} <ArrowUpRight className="inline h-3 w-3" aria-hidden="true" />
                    </p>
                    <p className="mt-1 text-right text-[10px] text-slate-400">{finding.time}</p>
                  </article>
                );
              })}
              <div className="ml-10 rounded-[14px] bg-lime-100 p-3 text-[11px] font-medium leading-[1.48] text-lime-900">
                {copy.previewEmpty} <span aria-hidden="true">✓</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
