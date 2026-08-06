"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutDashboard, Radar as RadarIcon, Send } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/lib/i18n";
import type { RadarStatus } from "@/types/contracts";

const navigationCopy = {
  en: { dashboard: "Dashboard", radars: "Radars", telegram: "Telegram", language: "Language" },
  "zh-CN": { dashboard: "Dashboard", radars: "Radars", telegram: "Telegram", language: "语言" },
} as const;

const actionCopy = {
  en: {
    pause: "Pause",
    resume: "Resume",
    check: "Check now",
    checking: "Checking…",
    edit: "Edit rules",
    save: "Save rules",
    cancel: "Cancel",
    saving: "Saving…",
    radarName: "Radar name",
    include: "Include topics",
    exclude: "Exclude topics",
    includeHint: "One topic per line",
    actionError: "The action could not be completed. Please try again.",
    limitError: "This Radar cannot be resumed while three Radars are active.",
    localeError: "Language preference could not be saved.",
  },
  "zh-CN": {
    pause: "暂停",
    resume: "恢复",
    check: "立即检查",
    checking: "检查中…",
    edit: "编辑规则",
    save: "保存规则",
    cancel: "取消",
    saving: "保存中…",
    radarName: "Radar 名称",
    include: "关注项",
    exclude: "排除项",
    includeHint: "每行填写一项",
    actionError: "操作未完成，请稍后重试。",
    limitError: "当前已有 3 个运行中的 Radar，暂时无法恢复此 Radar。",
    localeError: "语言偏好保存失败。",
  },
} as const;

export function WorkspaceNavigation({ locale, currentPath }: { locale: Locale; currentPath: string }) {
  const labels = navigationCopy[locale];
  const items = [
    { href: "/dashboard", label: labels.dashboard, icon: LayoutDashboard, active: currentPath === "/dashboard" },
    {
      href: "/radars",
      label: labels.radars,
      icon: RadarIcon,
      active: currentPath === "/radars" || currentPath.startsWith("/radars/"),
    },
    { href: "/connect-telegram", label: labels.telegram, icon: Send, active: currentPath === "/connect-telegram" },
  ];

  return (
    <>
      <aside className="hidden w-60 shrink-0 bg-slate-950 text-white min-[850px]:block">
        <div className="sticky top-0 flex min-h-screen flex-col px-4 py-6">
          <Link href="/dashboard" className="flex items-center gap-3 px-3 text-sm font-semibold text-white">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-violet-500 text-white">
              <RadarIcon className="h-4 w-4" aria-hidden="true" />
            </span>
            Watch Anything
          </Link>
          <nav className="mt-8 grid gap-2" aria-label="Workspace navigation">
            {items.map(({ href, label, icon: Icon, active }) => (
              <Link
                key={href}
                href={href}
                className={
                  active
                    ? "flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-3 text-sm font-semibold text-white"
                    : "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
                }
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 py-2 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur min-[850px]:hidden" aria-label="Workspace navigation">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
          {items.map(({ href, label, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              className={
                active
                  ? "flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700"
                  : "flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}

export function WorkspaceLocaleSwitcher({
  locale,
  userId,
  path,
}: {
  locale: Locale;
  userId: string;
  path: string;
}) {
  const router = useRouter();
  const labels = navigationCopy[locale];
  const actionLabels = actionCopy[locale];
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(false);

  const changeLocale = async (nextLocale: Locale) => {
    if (nextLocale === locale || isSaving) {
      return;
    }

    setError(false);
    setIsSaving(true);
    // The locale preference is intentionally persisted outside React state so the next server render can read it.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `wa_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;

    try {
      const supabase = createClient();
      const result = await supabase.from("profiles").update({ locale: nextLocale }).eq("id", userId);
      if (result.error) {
        setError(true);
        setIsSaving(false);
        return;
      }
    } catch {
      setError(true);
      setIsSaving(false);
      return;
    }

    router.push(`${path}?lang=${nextLocale}`);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">{labels.language}</span>
      <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1" role="group" aria-label={labels.language}>
        {(["en", "zh-CN"] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={isSaving}
            onClick={() => void changeLocale(value)}
            className={
              value === locale
                ? "rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-950 shadow-sm"
                : "rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-950"
            }
          >
            {value === "en" ? "EN" : "中文"}
          </button>
        ))}
      </div>
      {error ? <span className="text-xs text-rose-600">{actionLabels.localeError}</span> : null}
    </div>
  );
}

interface EditableRules {
  radarName: string;
  includeTopics: string[];
  excludeTopics: string[];
}

type ActionKind = "status" | "run" | "edit";

export function RadarActions({
  radarId,
  status,
  locale,
  rules,
}: {
  radarId: string;
  status: RadarStatus;
  locale: Locale;
  rules: EditableRules;
}) {
  const router = useRouter();
  const labels = actionCopy[locale];
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [radarName, setRadarName] = useState(rules.radarName);
  const [includeTopics, setIncludeTopics] = useState(rules.includeTopics.join("\n"));
  const [excludeTopics, setExcludeTopics] = useState(rules.excludeTopics.join("\n"));

  const request = async (kind: ActionKind, init: RequestInit): Promise<boolean> => {
    setBusy(kind);
    setError(null);

    try {
      const response = await fetch(`/api/radars/${radarId}`, init);
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (!response.ok) {
        setError(body?.code === "ACTIVE_RADAR_LIMIT_REACHED" ? labels.limitError : labels.actionError);
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError(labels.actionError);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const runCheck = async () => {
    setBusy("run");
    setError(null);

    try {
      const response = await fetch(`/api/radars/${radarId}/run`, { method: "POST" });
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (!response.ok) {
        setError(body?.code === "ACTIVE_RADAR_LIMIT_REACHED" ? labels.limitError : labels.actionError);
        return;
      }

      router.refresh();
    } catch {
      setError(labels.actionError);
    } finally {
      setBusy(null);
    }
  };

  const saveRules = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const splitTopics = (value: string) => value.split(/[\n,]/).map((topic) => topic.trim()).filter(Boolean);

    const succeeded = await request("edit", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_rules",
        radarName: radarName.trim(),
        includeTopics: splitTopics(includeTopics),
        excludeTopics: splitTopics(excludeTopics),
      }),
    });

    if (succeeded) {
      setEditing(false);
    }
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void request("status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: status === "active" ? "pause" : "resume" }),
          })}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "status" ? labels.saving : status === "active" ? labels.pause : labels.resume}
        </button>
        <button
          type="button"
          disabled={busy !== null || status === "paused"}
          onClick={() => void runCheck()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "run" ? labels.checking : labels.check}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => setEditing((value) => !value)}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {labels.edit}
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700">
          {error}
        </p>
      ) : null}

      {editing ? (
        <form onSubmit={(event) => void saveRules(event)} className="mt-4 grid gap-3 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            {labels.radarName}
            <input
              value={radarName}
              onChange={(event) => setRadarName(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none focus:border-violet-400"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            {labels.include}
            <span className="text-xs font-normal text-slate-500">{labels.includeHint}</span>
            <textarea
              value={includeTopics}
              onChange={(event) => setIncludeTopics(event.target.value)}
              rows={3}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-violet-400"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            {labels.exclude}
            <textarea
              value={excludeTopics}
              onChange={(event) => setExcludeTopics(event.target.value)}
              rows={3}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-normal outline-none focus:border-violet-400"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "edit" ? labels.saving : labels.save}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setEditing(false)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
