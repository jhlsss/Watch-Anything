"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";
import type { RadarRules } from "@/types/contracts";

interface RulesFormProps {
  initialRules: RadarRules;
  locale?: Locale;
  originalRequest?: string;
  onSubmit?: (rules: RadarRules) => void;
  onConfirmRules?: (rules: RadarRules) => void;
}

export function RulesForm({
  initialRules,
  locale = "zh-CN",
  originalRequest,
  onSubmit,
  onConfirmRules,
}: RulesFormProps) {
  const copy = getMessages(locale).rules;
  const [form, setForm] = useState<RadarRules>(initialRules);
  const [newIncludeTopic, setNewIncludeTopic] = useState("");
  const [newExcludeTopic, setNewExcludeTopic] = useState("");

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
  };

  const removeTopic = (field: "includeTopics" | "excludeTopics", value: string) => {
    setForm((current) => ({
      ...current,
      [field]: current[field].filter((item) => item !== value),
    }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit?.(payload);
    onConfirmRules?.(payload);
    setForm(payload);
    setNewIncludeTopic("");
    setNewExcludeTopic("");
  };

  return (
    <form onSubmit={handleSubmit} className="grid min-w-0 gap-6 min-[850px]:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.75fr)]">
      <section className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <ol className="grid gap-2 rounded-2xl bg-slate-50 p-2 min-[600px]:grid-cols-3">
          {copy.process.map((step, index) => (
            <li
              key={step}
              className={index === 1
                ? "rounded-xl bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-800"
                : "rounded-xl px-3 py-2 text-sm font-semibold text-slate-500"}
            >
              <span className="mr-2 text-xs font-extrabold">0{index + 1}</span>
              {step}
            </li>
          ))}
        </ol>

        <div className="mt-6 space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.eyebrow}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
          <p className="text-sm leading-6 text-slate-600">{copy.description}</p>
        </div>

        <div className="mt-6 grid min-w-0 gap-5">
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.requestLabel}</p>
            <p className="mt-2 break-words text-sm leading-6 text-slate-700">{originalRequest || form.subject}</p>
          </div>

          <div className="grid min-w-0 gap-5 min-[850px]:grid-cols-2">
            <label className="grid min-w-0 gap-2 text-sm font-semibold text-slate-900">
              <span>{copy.radarName}</span>
              <input
                value={form.radarName}
                onChange={(event) => setForm((current) => ({ ...current, radarName: event.target.value }))}
                className="min-w-0 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
              />
            </label>

            <div className="min-w-0 rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.generatedSubject}</p>
              <p className="mt-2 break-words text-sm leading-6 text-slate-700">{form.subject}</p>
            </div>
          </div>

          <div className="grid min-w-0 gap-3 min-[600px]:grid-cols-3">
            <div className="min-w-0 rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.searchQuery}</p>
              <p className="mt-2 break-words text-sm leading-6 text-slate-700">{form.searchQuery}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.threshold}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{form.importanceThreshold}/100</p>
            </div>
            <div className="rounded-2xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.schedule}</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{copy.scheduleValue}</p>
            </div>
          </div>

          <div className="grid gap-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{copy.includeTopics}</p>
                <button
                  type="button"
                  onClick={() => {
                    addTopic("includeTopics", newIncludeTopic);
                    setNewIncludeTopic("");
                  }}
                  className="text-sm font-semibold text-violet-700"
                >
                  {copy.addInclude}
                </button>
              </div>
              <label className="grid gap-2">
                <span className="sr-only">{copy.newInclude}</span>
                <input
                  aria-label={copy.newInclude}
                  value={newIncludeTopic}
                  onChange={(event) => setNewIncludeTopic(event.target.value)}
                  className="min-w-0 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-300"
                />
              </label>
              <div className="flex min-w-0 flex-wrap gap-2">
                {form.includeTopics.map((topic) => (
                  <span key={topic} className="inline-flex max-w-full items-center gap-2 rounded-full bg-violet-50 px-3 py-2 text-sm text-violet-700">
                    <span className="break-words">{topic}</span>
                    <button
                      type="button"
                      onClick={() => removeTopic("includeTopics", topic)}
                      aria-label={copy.removeTopic}
                      className="rounded-full p-0.5 hover:bg-violet-100"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">{copy.excludeTopics}</p>
                <button
                  type="button"
                  onClick={() => {
                    addTopic("excludeTopics", newExcludeTopic);
                    setNewExcludeTopic("");
                  }}
                  className="text-sm font-semibold text-violet-700"
                >
                  {copy.addExclude}
                </button>
              </div>
              <label className="grid gap-2">
                <span className="sr-only">{copy.newExclude}</span>
                <input
                  aria-label={copy.newExclude}
                  value={newExcludeTopic}
                  onChange={(event) => setNewExcludeTopic(event.target.value)}
                  className="min-w-0 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-violet-300"
                />
              </label>
              <div className="flex min-w-0 flex-wrap gap-2">
                {form.excludeTopics.map((topic) => (
                  <span key={topic} className="inline-flex max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm text-slate-700">
                    <span className="break-words">{topic}</span>
                    <button
                      type="button"
                      onClick={() => removeTopic("excludeTopics", topic)}
                      aria-label={copy.removeTopic}
                      className="rounded-full p-0.5 hover:bg-slate-200"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <Button type="submit" className="h-11 rounded-2xl bg-violet-600 text-white hover:bg-violet-500">
            {copy.confirm}
          </Button>
        </div>
      </section>

      <aside className="h-fit min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-slate-950">{copy.previewTitle}</h2>
          <p className="text-sm leading-6 text-slate-600">{copy.previewDescription}</p>
        </div>
        <div className="mt-4 space-y-3 rounded-2xl bg-slate-50 p-4">
          <p className="break-words text-sm font-semibold text-slate-900">{form.radarName}</p>
          <p className="break-words text-sm leading-6 text-slate-700">{form.includeTopics.join(" · ")}</p>
          {form.excludeTopics.length > 0 ? (
            <p className="break-words text-sm leading-6 text-slate-500">{form.excludeTopics.join(" · ")}</p>
          ) : null}
        </div>
        <p className="mt-4 rounded-2xl border border-violet-100 bg-violet-50 p-4 text-sm leading-6 text-violet-800">{copy.note}</p>
      </aside>
    </form>
  );
}
