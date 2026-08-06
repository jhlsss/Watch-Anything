"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import {
  readRuleFlowStorage,
  writeRuleFlowStorage,
} from "@/lib/auth/rule-flow-storage";
import type { RuleFlowStorage } from "@/lib/auth/rule-flow-storage";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { RulesForm } from "@/components/radar/rules-form";
import { normalizeLocale, getMessages } from "@/lib/i18n";
import {
  radarRulesSchema,
  toEditableRuleDelta,
} from "@/lib/validation/radar-rules";
import type { RadarRules } from "@/types/contracts";

export function hasImmutableRuleChanges(current: RadarRules, baseline: RadarRules): boolean {
  return (
    current.subject.trim() !== baseline.subject.trim() ||
    current.searchQuery.trim() !== baseline.searchQuery.trim() ||
    current.importanceThreshold !== baseline.importanceThreshold
  );
}

export default function RulesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const lang = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const request = Array.isArray(params.request) ? params.request[0] : params.request;
  const locale = normalizeLocale(lang);
  const copy = getMessages(locale);
  const router = useRouter();
  const [parsedRules, setParsedRules] = useState<RadarRules | null>(null);
  const [parsedPrompt, setParsedPrompt] = useState<string | null>(null);
  const [parsedAttempt, setParsedAttempt] = useState<number | null>(null);
  const [parseStatus, setParseStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [immutableEditError, setImmutableEditError] = useState(false);
  const [parseAttempt, setParseAttempt] = useState(0);
  const [storedFlow, setStoredFlow] = useState<RuleFlowStorage | null>(null);
  const prompt = request?.trim() || storedFlow?.originalPrompt || "";
  const resultMatchesPrompt = parsedPrompt === prompt && parsedAttempt === parseAttempt;
  const visibleStatus = !prompt
    ? "idle"
    : resultMatchesPrompt
      ? parseStatus
      : "loading";
  const visibleRules = resultMatchesPrompt && parseStatus === "ready" ? parsedRules : null;

  useEffect(() => {
    if (request?.trim()) {
      return;
    }

    let active = true;
    void Promise.resolve().then(() => {
      if (active) {
        setStoredFlow(readRuleFlowStorage());
      }
    });

    return () => {
      active = false;
    };
  }, [request]);

  useEffect(() => {
    let active = true;
    const currentPrompt = request?.trim() || storedFlow?.originalPrompt || "";

    if (!currentPrompt) {
      return () => {
        active = false;
      };
    }

    writeRuleFlowStorage(
      request?.trim()
        ? { originalPrompt: currentPrompt }
        : {
            originalPrompt: currentPrompt,
            ruleToken: storedFlow?.ruleToken,
            editableDelta: storedFlow?.editableDelta,
          },
    );
    void fetch("/api/rules/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: currentPrompt, locale }),
    })
      .then(async (response) => ({
        ok: response.ok,
        body: (await response.json()) as {
          error?: string;
          ruleToken?: string;
          rules?: unknown;
        },
      }))
      .then(({ ok, body }) => {
        if (!active) {
          return;
        }

        const result = body.rules && body.ruleToken
          ? radarRulesSchema.safeParse(body.rules)
          : { success: false as const };

        if (!ok || !result.success || !body.ruleToken) {
          setParsedRules(null);
          setParsedPrompt(currentPrompt);
          setParsedAttempt(parseAttempt);
          setParseStatus("error");
          return;
        }

        const rules = result.data;
        setParsedRules(rules);
        setParsedPrompt(currentPrompt);
        setParsedAttempt(parseAttempt);
        writeRuleFlowStorage({
          originalPrompt: currentPrompt,
          ruleToken: body.ruleToken,
          editableDelta: toEditableRuleDelta(rules),
        });
        setParseStatus("ready");
      })
      .catch(() => {
        if (active) {
          setParsedRules(null);
          setParsedPrompt(currentPrompt);
          setParsedAttempt(parseAttempt);
          setParseStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, [locale, parseAttempt, request, storedFlow]);

  const retryParse = () => {
    setParseStatus("loading");
    setParseAttempt((attempt) => attempt + 1);
  };

  return (
    <main className="flex min-h-screen min-w-0 overflow-x-hidden bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/rules" />
      <div className="min-w-0 flex-1 px-4 py-6 pb-32 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-6xl">
          {visibleRules && visibleStatus === "ready" ? (
            <RulesForm
              key="parsed-rules"
              initialRules={visibleRules}
              originalRequest={prompt}
              locale={locale}
              onConfirmRules={(rules) => {
                setImmutableEditError(false);

                if (hasImmutableRuleChanges(rules, visibleRules)) {
                  setImmutableEditError(true);
                  return;
                }

                const currentFlow = readRuleFlowStorage();

                if (!currentFlow?.ruleToken) {
                  setParseStatus("error");
                  return;
                }

                writeRuleFlowStorage({
                  originalPrompt: currentFlow.originalPrompt || rules.subject,
                  ruleToken: currentFlow.ruleToken,
                  editableDelta: toEditableRuleDelta(radarRulesSchema.parse(rules)),
                });
                router.push(`/auth?lang=${locale}&mode=signup`);
              }}
            />
          ) : (
            <section className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-600">{copy.rules.eyebrow}</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {visibleStatus === "error" ? copy.rules.parseErrorTitle : copy.rules.noRequestTitle}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {visibleStatus === "error" ? copy.rules.description : copy.rules.noRequestDescription}
              </p>

              {prompt ? (
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{copy.rules.requestLabel}</p>
                  <p className="mt-2 break-words text-sm leading-6 text-slate-700">{prompt}</p>
                </div>
              ) : null}

              {visibleStatus === "loading" ? (
                <p className="mt-6 flex items-center gap-2 text-sm text-slate-500" role="status">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {locale === "zh-CN" ? "正在整理规则…" : "Preparing your rules…"}
                </p>
              ) : null}

              {visibleStatus === "error" ? (
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
                  <p className="flex min-w-0 items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>{locale === "zh-CN" ? "规则整理失败，请重试。" : "We could not prepare the rules. Please try again."}</span>
                  </p>
                  <button
                    type="button"
                    onClick={retryParse}
                    className="rounded-xl border border-rose-200 bg-white px-3 py-2 font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    {copy.rules.retry}
                  </button>
                </div>
              ) : null}

              {visibleStatus === "idle" ? (
                <Link href={`/?lang=${locale}`} className="mt-6 inline-flex rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">
                  {copy.rules.backToHome}
                </Link>
              ) : null}
            </section>
          )}
          {immutableEditError ? (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800" role="alert">
              {locale === "zh-CN"
                ? "只能编辑 Radar 名称、关注项和排除项。"
                : "Only the Radar name, include topics, and exclude topics can be edited."}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
