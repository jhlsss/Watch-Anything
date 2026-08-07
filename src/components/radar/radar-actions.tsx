"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/lib/i18n";
import type { RadarStatus } from "@/types/contracts";

const navigationCopy = {
  en: { language: "Language" },
  "zh-CN": { language: "语言" },
} as const;

const actionCopy = {
  en: {
    pause: "Pause",
    resume: "Resume",
    check: "Check now",
    checking: "Checking…",
    saving: "Saving…",
    actionError: "The action could not be completed. Please try again.",
    limitError: "This Radar cannot be resumed while three Radars are active.",
    localeError: "Language preference could not be saved.",
  },
  "zh-CN": {
    pause: "暂停",
    resume: "恢复",
    check: "立即检查",
    checking: "检查中…",
    saving: "保存中…",
    actionError: "操作未完成，请稍后重试。",
    limitError: "当前已有 3 个运行中的 Radar，暂时无法恢复此 Radar。",
    localeError: "语言偏好保存失败。",
  },
} as const;

export function WorkspaceNavigation({ locale, currentPath }: { locale: Locale; currentPath: string }) {
  return <AppSidebar locale={locale} currentPath={currentPath} />;
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
    try {
      const supabase = createClient();
      const result = await supabase.from("profiles").update({ locale: nextLocale }).eq("id", userId).select("id").single();
      if (result.error || !result.data) {
        setError(true);
        setIsSaving(false);
        return;
      }
    } catch {
      setError(true);
      setIsSaving(false);
      return;
    }

    // The locale preference is intentionally persisted outside React state so the next server render can read it.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `wa_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
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
                ? "rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-950 shadow-sm"
                : "rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 transition hover:text-slate-950"
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

type ActionKind = "status" | "run";

export function RadarActions({
  radarId,
  status,
  locale,
}: {
  radarId: string;
  status: RadarStatus;
  locale: Locale;
}) {
  const router = useRouter();
  const labels = actionCopy[locale];
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = async (kind: ActionKind, init: RequestInit): Promise<boolean> => {
    setBusy(kind);
    setError(null);

    try {
      const response = await fetch(`/api/radars/${radarId}`, init);
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error === "ACTIVE_RADAR_LIMIT_REACHED" ? labels.limitError : labels.actionError);
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
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error === "ACTIVE_RADAR_LIMIT_REACHED" ? labels.limitError : labels.actionError);
        return;
      }

      router.refresh();
    } catch {
      setError(labels.actionError);
    } finally {
      setBusy(null);
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
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700">
          {error}
        </p>
      ) : null}

    </div>
  );
}
