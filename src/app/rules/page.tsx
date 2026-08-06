"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import {
  readRuleFlowStorage,
  writeRuleFlowStorage,
} from "@/app/auth/page";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { RulesForm } from "@/components/radar/rules-form";
import { normalizeLocale, getMessages } from "@/lib/i18n";
import {
  radarRulesSchema,
  toEditableRuleDelta,
} from "@/lib/validation/radar-rules";
import type { RadarRules } from "@/types/contracts";

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
  const [parseStatus, setParseStatus] = useState<"idle" | "loading" | "ready" | "error">(
    request?.trim() ? "loading" : "idle",
  );

  useEffect(() => {
    let active = true;
    const storedFlow = readRuleFlowStorage();
    const prompt = request?.trim() || storedFlow?.originalPrompt || "";

    if (!prompt) {
      return () => {
        active = false;
      };
    }

    writeRuleFlowStorage(
      request?.trim()
        ? { originalPrompt: prompt }
        : {
            originalPrompt: prompt,
            ruleToken: storedFlow?.ruleToken,
            editableDelta: storedFlow?.editableDelta,
          },
    );
    void fetch("/api/rules/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, locale }),
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
          setParseStatus("error");
          return;
        }

        const rules = result.data;
        setParsedRules(rules);
        writeRuleFlowStorage({
          originalPrompt: prompt,
          ruleToken: body.ruleToken,
          editableDelta: toEditableRuleDelta(rules),
        });
        setParseStatus("ready");
      })
      .catch(() => {
        if (active) {
          setParseStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, [locale, request]);

  const initialRules = useMemo<RadarRules>(
    () => ({
      radarName: copy.rules.defaults.radarName,
      subject: request?.trim() || copy.rules.defaults.subject,
      aliases: [...copy.rules.defaults.aliases],
      includeTopics: [...copy.rules.defaults.includeTopics],
      excludeTopics: [...copy.rules.defaults.excludeTopics],
      searchQuery: copy.rules.defaults.searchQuery,
      importanceThreshold: 75,
      intervalMinutes: 360,
    }),
    [copy.rules.defaults, request],
  );

  return (
    <main className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/rules" />
      <div className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-6xl">
          <RulesForm
            key={parsedRules ? "parsed-rules" : "initial-rules"}
            initialRules={parsedRules ?? initialRules}
            locale={locale}
            onConfirmRules={(rules) => {
              const currentFlow = readRuleFlowStorage();

              if (!currentFlow?.ruleToken) {
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
          {parseStatus === "loading" ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-slate-500" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              {locale === "zh-CN" ? "正在整理规则…" : "Preparing your rules…"}
            </p>
          ) : null}
          {parseStatus === "error" ? (
            <p className="mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {locale === "zh-CN" ? "规则整理失败，请稍后重试。" : "We could not prepare the rules. Please try again."}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
