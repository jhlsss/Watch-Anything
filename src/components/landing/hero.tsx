"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";

interface HeroProps {
  locale: Locale;
  title: string;
  kicker: string;
  description: string;
  inputPlaceholder: string;
  primaryCta: string;
  helper: string;
  examples: readonly string[];
  onParseRequest: (request: string) => void;
}

export function Hero({
  title,
  kicker,
  description,
  inputPlaceholder,
  primaryCta,
  helper,
  examples,
  onParseRequest,
}: HeroProps) {
  const [request, setRequest] = useState("");

  const handleSubmit = () => {
    onParseRequest(request.trim());
  };

  return (
    <section className="grid gap-10 py-10 min-[850px]:grid-cols-[1.05fr_0.95fr] min-[850px]:items-center min-[850px]:py-16">
      <div className="space-y-6">
        <div className="text-sm font-extrabold uppercase tracking-[0.18em] text-violet-600">{kicker}</div>
        <div className="space-y-4">
          <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl min-[850px]:text-6xl">
            {title}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{description}</p>
        </div>

        <div className="rounded-3xl border border-violet-100 bg-white p-3 shadow-xl shadow-violet-100/50">
          <div className="flex flex-col gap-3 min-[850px]:flex-row">
            <input
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder={inputPlaceholder}
              className="min-h-12 flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-violet-300"
            />
            <Button className="h-12 rounded-2xl bg-violet-600 px-5 text-white hover:bg-violet-500" onClick={handleSubmit}>
              {primaryCta}
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm text-slate-500">{helper}</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setRequest(example)}
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-violet-200 hover:text-violet-700"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto flex w-full max-w-sm justify-center">
        <div className="absolute top-10 h-72 w-72 rounded-full bg-violet-100 blur-3xl" />
        <div className="relative w-full rounded-[2rem] bg-slate-950 p-3 shadow-2xl shadow-violet-200">
          <div className="overflow-hidden rounded-[1.6rem] bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 text-xs font-semibold text-slate-500">
              <span>9:41</span>
              <span>▮▮ ᯤ ▰</span>
            </div>
            <div className="space-y-4 p-4">
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-slate-900">LISA Official Radar</p>
                <p className="mt-2 text-sm text-slate-600">A new official single announcement was detected from a trusted source.</p>
              </div>
              <div className="rounded-2xl bg-violet-50 p-4 text-sm text-violet-800">
                No other important Radar updates today.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
