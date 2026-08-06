"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";
import { radarRulesSchema } from "@/lib/validation/radar-rules";
import type { RadarRules } from "@/types/contracts";

interface RulesFormProps {
  initialRules: RadarRules;
  locale?: Locale;
  originalRequest?: string;
  backHref?: string;
  onSubmit?: (rules: RadarRules) => void;
  onConfirmRules?: (rules: RadarRules) => void;
}

export function RulesForm({
  initialRules,
  locale = "zh-CN",
  originalRequest,
  backHref,
  onSubmit,
  onConfirmRules,
}: RulesFormProps) {
  const copy = getMessages(locale).rules;
  const [form, setForm] = useState<RadarRules>(initialRules);
  const [newIncludeTopic, setNewIncludeTopic] = useState("");
  const [newExcludeTopic, setNewExcludeTopic] = useState("");
  const [showIncludeInput, setShowIncludeInput] = useState(false);
  const [showExcludeInput, setShowExcludeInput] = useState(false);
  const [radarNameError, setRadarNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const payload = useMemo(() => {
    const includeTopics = newIncludeTopic.trim()
      ? form.includeTopics.includes(newIncludeTopic.trim())
        ? form.includeTopics
        : [...form.includeTopics, newIncludeTopic.trim()]
      : form.includeTopics;
    const excludeTopics = newExcludeTopic.trim()
      ? form.excludeTopics.includes(newExcludeTopic.trim())
        ? form.excludeTopics
        : [...form.excludeTopics, newExcludeTopic.trim()]
      : form.excludeTopics;

    return {
      ...form,
      includeTopics,
      excludeTopics,
    };
  }, [form, newExcludeTopic, newIncludeTopic]);

  const addTopic = (field: "includeTopics" | "excludeTopics", value: string) => {
    const nextValue = value.trim();

    if (!nextValue) {
      return;
    }

    setForm((current) => ({
      ...current,
      [field]: current[field].includes(nextValue) ? current[field] : [...current[field], nextValue],
    }));
    setRadarNameError(null);
    setFormError(null);
  };

  const removeTopic = (field: "includeTopics" | "excludeTopics", value: string) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].filter((item) => item !== value),
    }));
    setRadarNameError(null);
    setFormError(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = radarRulesSchema.safeParse(payload);

    if (!result.success) {
      const hasRadarNameIssue = result.error.issues.some((issue) => issue.path[0] === "radarName");
      setRadarNameError(hasRadarNameIssue ? copy.radarNameError : null);
      setFormError(hasRadarNameIssue ? null : copy.formError);
      return;
    }

    setRadarNameError(null);
    setFormError(null);
    onSubmit?.(result.data);
    onConfirmRules?.(result.data);
    setForm(result.data);
    setNewIncludeTopic("");
    setNewExcludeTopic("");
    setShowIncludeInput(false);
    setShowExcludeInput(false);
  };

  return (
    <form onSubmit={handleSubmit} className="grid min-w-0 gap-6 min-[850px]:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]">
      <div className="min-w-0">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.eyebrow}</p>
        <section className="mt-2 min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-[2rem]">{copy.title}</h1>
          <p className="text-[13px] leading-5 text-slate-600">{copy.description}</p>
        </div>

        <div className="mt-6 grid min-w-0 gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.requestLabel}</p>
            <p className="mt-2 break-words rounded-xl border border-slate-200 bg-[#f5f2fb] px-3 py-3 text-sm leading-6 text-slate-700">{originalRequest || form.subject}</p>
          </div>

          <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-900">
            <span>{copy.radarName}</span>
            <input
              value={form.radarName}
              onChange={(event) => {
                setForm((current) => ({ ...current, radarName: event.target.value }));
                setRadarNameError(null);
                setFormError(null);
              }}
              aria-invalid={Boolean(radarNameError)}
              aria-describedby={radarNameError ? "radar-name-error" : undefined}
              className={`min-w-0 rounded-xl border px-3 py-3 text-sm font-normal outline-none transition focus:ring-2 focus:ring-violet-100 ${
                radarNameError
                  ? "border-rose-400 focus:border-rose-400"
                  : "border-slate-200 focus:border-violet-300"
              }`}
            />
            {radarNameError ? (
              <p id="radar-name-error" role="alert" className="text-xs font-medium text-rose-600">
                {radarNameError}
              </p>
            ) : null}
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{copy.includeTopics}</p>
              <button
                type="button"
                onClick={() => {
                  if (newIncludeTopic.trim()) {
                    addTopic("includeTopics", newIncludeTopic);
                    setNewIncludeTopic("");
                  }
                  setShowIncludeInput(true);
                }}
                className="rounded-lg border border-dashed border-violet-300 px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                {copy.addInclude}
              </button>
            </div>
            {showIncludeInput ? (
              <label className="grid gap-2">
                <span className="sr-only">{copy.newInclude}</span>
                <input
                  aria-label={copy.newInclude}
                  value={newIncludeTopic}
                  onChange={(event) => setNewIncludeTopic(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTopic("includeTopics", newIncludeTopic);
                      setNewIncludeTopic("");
                    }
                  }}
                  className="min-w-0 rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-violet-300"
                />
              </label>
            ) : null}
            <div className="flex min-w-0 flex-wrap gap-2">
              {form.includeTopics.map((topic) => (
                <span key={topic} className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700">
                  <span className="break-words">{topic}</span>
                  <button
                    type="button"
                    onClick={() => removeTopic("includeTopics", topic)}
                    aria-label={`${copy.removeTopic} ${topic}`}
                    className="min-h-8 min-w-8 rounded-full px-2 font-semibold leading-none hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{copy.excludeTopics}</p>
              <button
                type="button"
                onClick={() => {
                  if (newExcludeTopic.trim()) {
                    addTopic("excludeTopics", newExcludeTopic);
                    setNewExcludeTopic("");
                  }
                  setShowExcludeInput(true);
                }}
                className="rounded-lg border border-dashed border-violet-300 px-2.5 py-1.5 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
              >
                {copy.addExclude}
              </button>
            </div>
            {showExcludeInput ? (
              <label className="grid gap-2">
                <span className="sr-only">{copy.newExclude}</span>
                <input
                  aria-label={copy.newExclude}
                  value={newExcludeTopic}
                  onChange={(event) => setNewExcludeTopic(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTopic("excludeTopics", newExcludeTopic);
                      setNewExcludeTopic("");
                    }
                  }}
                  className="min-w-0 rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-violet-300"
                />
              </label>
            ) : null}
            <div className="flex min-w-0 flex-wrap gap-2">
              {form.excludeTopics.map((topic) => (
                <span key={topic} className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs text-violet-700">
                  <span className="break-words">{topic}</span>
                  <button
                    type="button"
                    onClick={() => removeTopic("excludeTopics", topic)}
                    aria-label={`${copy.removeTopic} ${topic}`}
                    className="min-h-8 min-w-8 rounded-full px-2 font-semibold leading-none hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-900">{copy.schedule}</p>
            <div className="rounded-xl border border-slate-200 px-3 py-3 text-sm text-slate-700">{copy.scheduleValue}</div>
          </div>

          {formError ? (
            <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">
              {formError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Link
              href={backHref ?? `/?lang=${locale}`}
              className="inline-flex min-h-10 items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
            >
              {copy.backToHome}
            </Link>
            <Button type="submit" className="min-h-10 rounded-xl bg-violet-600 px-4 text-xs font-semibold text-white hover:bg-violet-500">
              {copy.confirm}
            </Button>
          </div>
        </div>
        </section>
      </div>

      <aside className="h-fit min-w-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:mt-6 sm:p-6 min-[850px]:mt-6">
        <div className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.previewTitle}</p>
          <h2 className="text-xl font-semibold text-slate-950">{form.radarName}</h2>
          <p className="text-sm leading-6 text-slate-600">{copy.previewDescription}</p>
        </div>
        <div className="mt-5 grid gap-4">
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs font-bold text-slate-900">{copy.searchQuery}</p>
            <p className="mt-2 break-words text-sm leading-6 text-slate-700">{form.searchQuery}</p>
          </div>
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs font-bold text-slate-900">{copy.threshold}</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{form.importanceThreshold} / 100</p>
          </div>
        </div>
        <p className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3.5 text-xs leading-5 text-violet-800">{copy.note}</p>
      </aside>
    </form>
  );
}
