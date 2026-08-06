"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteHeader } from "@/components/layout/site-header";
import { authenticateAction } from "@/app/auth/actions";
import type { Locale } from "@/lib/i18n";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import { editableRuleDeltaSchema } from "@/lib/validation/radar-rules";
import type { EditableRuleDelta } from "@/types/contracts";
import { z } from "zod";

export const RULE_FLOW_STORAGE_KEY = "watch-anything.rule-flow";

const ruleFlowStorageSchema = z
  .object({
    originalPrompt: z.string().trim().min(1).max(4_000),
    ruleToken: z.string().min(1).max(8_192).optional(),
    editableDelta: editableRuleDeltaSchema.optional(),
  })
  .strict();

export type RuleFlowStorage = {
  originalPrompt: string;
  ruleToken?: string;
  editableDelta?: EditableRuleDelta;
};

function getLocalStorage(storage?: Storage): Storage | null {
  if (storage) {
    return storage;
  }

  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export function readRuleFlowStorage(storage?: Storage): RuleFlowStorage | null {
  const localStorage = getLocalStorage(storage);

  if (!localStorage) {
    return null;
  }

  try {
    const raw = localStorage.getItem(RULE_FLOW_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const result = ruleFlowStorageSchema.safeParse(JSON.parse(raw));

    if (!result.success) {
      return null;
    }

    return result.data as RuleFlowStorage;
  } catch {
    return null;
  }
}

export function writeRuleFlowStorage(
  flow: RuleFlowStorage,
  storage?: Storage,
): void {
  const localStorage = getLocalStorage(storage);

  if (!localStorage) {
    return;
  }

  const safeFlow = {
    originalPrompt: flow.originalPrompt,
    ...(flow.ruleToken ? { ruleToken: flow.ruleToken } : {}),
    ...(flow.editableDelta
      ? { editableDelta: editableRuleDeltaSchema.parse(flow.editableDelta) }
      : {}),
  };

  const result = ruleFlowStorageSchema.safeParse(safeFlow);

  if (result.success) {
    localStorage.setItem(RULE_FLOW_STORAGE_KEY, JSON.stringify(result.data));
  }
}

export function clearRuleFlowStorage(storage?: Storage): void {
  getLocalStorage(storage)?.removeItem(RULE_FLOW_STORAGE_KEY);
}

export function formatRuleFlowError(error: unknown, locale: Locale): string {
  if (error === "EXPIRED_RULE_TOKEN") {
    return locale === "zh-CN"
      ? "规则已过期，请重新整理。"
      : "These rules expired. Please prepare them again.";
  }

  if (error === "INVALID_RULE_TOKEN" || error === "INVALID_RULE_DELTA") {
    return locale === "zh-CN"
      ? "规则验证失败，请重新整理。"
      : "The rules could not be verified. Please prepare them again.";
  }

  if (error === "AUTH_REQUIRED") {
    return locale === "zh-CN" ? "请先登录。" : "Please log in first.";
  }

  return locale === "zh-CN"
    ? "暂时无法继续，请稍后重试。"
    : "We could not continue right now. Please try again.";
}

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
  const [error, setError] = useState<string | null>(null);

  const handleAuthenticate = async (payload: {
    mode: "login" | "signup";
    fullName: string;
    email: string;
    password: string;
  }) => {
    setError(null);
    const ruleFlow = readRuleFlowStorage();
    let result;

    try {
      result = await authenticateAction({
        ...payload,
        next: ruleFlow?.ruleToken && ruleFlow.editableDelta ? "connect-telegram" : params.next,
      });
    } catch {
      setError(formatRuleFlowError("AUTHENTICATION_FAILED", locale));
      return;
    }

    if (!result.ok) {
      setError(formatRuleFlowError(result.error, locale));
      return;
    }

    if (result.next === "/connect-telegram" && ruleFlow?.ruleToken && ruleFlow.editableDelta) {
      try {
        const pendingResponse = await fetch("/api/pending-setups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originalPrompt: ruleFlow.originalPrompt,
            ruleToken: ruleFlow.ruleToken,
            editableDelta: ruleFlow.editableDelta,
          }),
        });
        const pendingBody = (await pendingResponse.json()) as {
          error?: string;
          next?: string;
          radarId?: string;
        };

        if (!pendingResponse.ok) {
          setError(formatRuleFlowError(pendingBody.error, locale));
          return;
        }

        if (pendingBody.next === "radar" && pendingBody.radarId) {
          router.push(`/radars/${pendingBody.radarId}`);
          return;
        }

        router.push(`/connect-telegram?lang=${locale}`);
        return;
      } catch {
        setError(formatRuleFlowError("PENDING_SETUP_FAILED", locale));
        return;
      }
    }

    router.push(`${result.next}?lang=${locale}`);
  };

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
            error={error ?? undefined}
            onAuthenticate={handleAuthenticate}
          />
        </div>
      </div>
    </main>
  );
}
