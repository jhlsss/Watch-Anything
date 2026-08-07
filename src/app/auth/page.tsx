"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { SiteHeader } from "@/components/layout/site-header";
import { authenticateAction } from "@/app/auth/actions";
import type { Locale } from "@/lib/i18n";
import { getMessages, normalizeLocale } from "@/lib/i18n";
import type { AuthMode } from "@/components/auth/auth-form";
import {
  clearRuleFlowStorage,
  readRuleFlowStorage,
  RULE_FLOW_STORAGE_KEY,
  writeRuleFlowStorage,
} from "@/lib/auth/rule-flow-storage";
import {
  submitPendingSetup,
} from "@/lib/auth/pending-setup";
export {
  clearRuleFlowStorage,
  readRuleFlowStorage,
  RULE_FLOW_STORAGE_KEY,
  writeRuleFlowStorage,
};
export type { RuleFlowStorage } from "@/lib/auth/rule-flow-storage";

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

export { submitPendingSetup } from "@/lib/auth/pending-setup";
export type { PendingSetupResult } from "@/lib/auth/pending-setup";

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
  const isReset = params.reset === "1";
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);

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
      const pendingResult = await submitPendingSetup(ruleFlow);

      if (!pendingResult.ok) {
        setError(formatRuleFlowError(pendingResult.error, locale));
        return;
      }

      if (pendingResult.next === "radar" && pendingResult.radarId) {
        router.push(`/radars/${pendingResult.radarId}`);
        return;
      }

      router.push(`/connect-telegram?lang=${locale}`);
      return;
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
        {isReset ? (
          <section className="max-w-2xl space-y-5 min-[850px]:col-span-2">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.auth.eyebrow}</p>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950">{copy.auth.resetTitle}</h1>
              <p className="max-w-xl text-sm leading-7 text-slate-600">{copy.auth.resetDescription}</p>
            </div>
            <div className="max-w-md rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800" role="status">
              {copy.auth.resetMessage}
            </div>
            <Link href={`/auth?lang=${locale}&mode=login`} className="inline-flex rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">
              {copy.auth.backToLogin}
            </Link>
          </section>
        ) : (
          <>
            <section className="space-y-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.auth.eyebrow}</p>
              <div className="space-y-3">
                <h1 className="text-4xl font-semibold tracking-tight text-slate-950">
                  {authMode === "signup" ? copy.auth.signupTitle : copy.auth.loginTitle}
                </h1>
                <p className="max-w-xl text-sm leading-7 text-slate-600">
                  {authMode === "signup" ? copy.auth.signupDescription : copy.auth.loginDescription}
                </p>
              </div>
              <div className="max-w-md rounded-3xl border border-violet-100 bg-violet-50 p-4 text-sm leading-6 text-violet-800">
                {authMode === "signup" ? copy.auth.signupReturnNote : copy.auth.loginReturnNote}
              </div>
            </section>

            <div>
              <AuthForm
                locale={locale}
                initialMode={initialMode}
                error={error ?? undefined}
                onModeChange={setAuthMode}
                onAuthenticate={handleAuthenticate}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
