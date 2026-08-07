"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "@/lib/i18n";
import { editableRuleDeltaSchema } from "@/lib/validation/radar-rules";

export type RadarRulesCardRules = {
  radarName: string;
  subject: string;
  includeTopics: string[];
  excludeTopics: string[];
  searchQuery: string;
  importanceThreshold: number;
  intervalMinutes: number;
};

export type RadarRulesCardLabels = {
  title: string;
  edit: string;
  save: string;
  cancel: string;
  saving: string;
  radarName: string;
  include: string;
  exclude: string;
  includeHint: string;
  notifyAbout: string;
  ignore: string;
  subject: string;
  searchQuery: string;
  frequency: string;
  threshold: string;
  nextCheck: string;
  emptyRules: string;
  everyHoursLabel: string;
  validationName: string;
  validationInclude: string;
  validationExclude: string;
  actionError: string;
};

type FieldErrors = Partial<Record<"radarName" | "includeTopics" | "excludeTopics", string>>;

function splitTopics(value: string) {
  return value.split(/[\n,]/).map((topic) => topic.trim()).filter(Boolean);
}

export function RadarRulesCard({
  radarId,
  locale,
  rules,
  labels,
  nextCheckLabel,
}: {
  radarId: string;
  locale: Locale;
  rules: RadarRulesCardRules;
  labels: RadarRulesCardLabels;
  nextCheckLabel: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [radarName, setRadarName] = useState(rules.radarName);
  const [includeTopics, setIncludeTopics] = useState(rules.includeTopics.join("\n"));
  const [excludeTopics, setExcludeTopics] = useState(rules.excludeTopics.join("\n"));

  const beginEditing = () => {
    setRadarName(rules.radarName);
    setIncludeTopics(rules.includeTopics.join("\n"));
    setExcludeTopics(rules.excludeTopics.join("\n"));
    setFieldErrors({});
    setError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    if (busy) return;
    setEditing(false);
    setFieldErrors({});
    setError(null);
  };

  const saveRules = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextRadarName = radarName.trim();
    const nextIncludeTopics = splitTopics(includeTopics);
    const nextExcludeTopics = splitTopics(excludeTopics);
    const nextFieldErrors: FieldErrors = {};
    const validation = editableRuleDeltaSchema.safeParse({
      radarName: nextRadarName,
      includeTopics: nextIncludeTopics,
      excludeTopics: nextExcludeTopics,
    });

    if (!validation.success) {
      for (const issue of validation.error.issues) {
        const field = issue.path[0];
        if (field === "radarName" && !nextFieldErrors.radarName) {
          nextFieldErrors.radarName = labels.validationName;
        }
        if (field === "includeTopics" && !nextFieldErrors.includeTopics) {
          nextFieldErrors.includeTopics = labels.validationInclude;
        }
        if (field === "excludeTopics" && !nextFieldErrors.excludeTopics) {
          nextFieldErrors.excludeTopics = labels.validationExclude;
        }
      }
    }

    setError(null);
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`/api/radars/${radarId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_rules",
          radarName: nextRadarName,
          includeTopics: nextIncludeTopics,
          excludeTopics: nextExcludeTopics,
        }),
      });

      if (!response.ok) {
        setError(labels.actionError);
        return;
      }

      router.refresh();
      setEditing(false);
    } catch {
      setError(labels.actionError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{labels.title}</h2>
        {!editing ? (
          <button
            type="button"
            onClick={beginEditing}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            {labels.edit}
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={(event) => void saveRules(event)} className="mt-5 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            <span>{labels.radarName}</span>
            <input
              value={radarName}
              onChange={(event) => setRadarName(event.target.value)}
              aria-invalid={Boolean(fieldErrors.radarName)}
              aria-describedby={fieldErrors.radarName ? "rules-card-radar-name-error" : undefined}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            {fieldErrors.radarName ? <p id="rules-card-radar-name-error" role="alert" className="text-xs font-normal text-rose-600">{fieldErrors.radarName}</p> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            <span>{labels.include}</span>
            <span className="text-xs font-normal text-slate-500">{labels.includeHint}</span>
            <textarea
              value={includeTopics}
              onChange={(event) => setIncludeTopics(event.target.value)}
              aria-label={labels.include}
              aria-invalid={Boolean(fieldErrors.includeTopics)}
              aria-describedby={fieldErrors.includeTopics ? "rules-card-include-error" : undefined}
              rows={4}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            {fieldErrors.includeTopics ? <p id="rules-card-include-error" role="alert" className="text-xs font-normal text-rose-600">{fieldErrors.includeTopics}</p> : null}
          </label>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            <span>{labels.exclude}</span>
            <span className="text-xs font-normal text-slate-500">{labels.includeHint}</span>
            <textarea
              value={excludeTopics}
              onChange={(event) => setExcludeTopics(event.target.value)}
              aria-label={labels.exclude}
              aria-invalid={Boolean(fieldErrors.excludeTopics)}
              aria-describedby={fieldErrors.excludeTopics ? "rules-card-exclude-error" : undefined}
              rows={3}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
            />
            {fieldErrors.excludeTopics ? <p id="rules-card-exclude-error" role="alert" className="text-xs font-normal text-rose-600">{fieldErrors.excludeTopics}</p> : null}
          </label>

          {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700">{error}</p> : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? labels.saving : labels.save}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancelEditing}
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-5 grid gap-5">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">{labels.notifyAbout}</p>
            {rules.includeTopics.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {rules.includeTopics.map((topic) => <span key={topic} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">{topic}</span>)}
              </div>
            ) : <p className="mt-2 text-sm text-slate-600">{labels.emptyRules}</p>}
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">{labels.ignore}</p>
            <p className="mt-2 break-words text-sm leading-6 text-slate-700">{rules.excludeTopics.length > 0 ? rules.excludeTopics.join(locale === "zh-CN" ? "、" : ", ") : "—"}</p>
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-slate-500">{labels.subject}</p>
            <p className="mt-2 break-words text-sm leading-6 text-slate-700">{rules.subject}</p>
          </div>
          <div className="grid gap-3 border-t border-slate-100 pt-4 text-sm">
            <div className="flex items-start justify-between gap-3"><span className="text-slate-500">{labels.searchQuery}</span><span className="max-w-[60%] break-words text-right font-semibold text-slate-900">{rules.searchQuery || "—"}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{labels.frequency}</span><span className="font-semibold text-slate-900">{labels.everyHoursLabel}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{labels.nextCheck}</span><span className="max-w-[60%] text-right font-semibold text-slate-900">{nextCheckLabel}</span></div>
            <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{labels.threshold}</span><span className="font-semibold text-slate-900">{rules.importanceThreshold} / 100</span></div>
          </div>
        </div>
      )}
    </section>
  );
}
