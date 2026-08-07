"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ConnectCard } from "@/components/telegram/connect-card";
import { getMessages, normalizeLocale } from "@/lib/i18n";

type ConnectionState =
  | "idle"
  | "opening"
  | "waiting"
  | "activating"
  | "connected"
  | "activation-error"
  | "error";

type TelegramStatusResponse = {
  connected?: boolean;
  username?: string | null;
};

type PendingSetupResponse = {
  setup?: { id?: string } | null;
  error?: string;
};

type RadarActivationResponse = {
  radar?: { id?: string };
  error?: string;
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function activationErrorMessage(error: unknown, locale: "en" | "zh-CN"): string {
  const code = errorCode(error, "RADAR_ACTIVATION_FAILED");

  if (locale === "zh-CN") {
    switch (code) {
      case "ACTIVE_RADAR_LIMIT_REACHED":
        return "已达到可启用的 Radar 数量上限。请先暂停一个已有 Radar，再重试。";
      case "SETUP_NOT_AVAILABLE":
      case "PENDING_SETUP_LOOKUP_FAILED":
        return "刚才保存的 Radar 规则已不可用，请返回规则页重新确认。";
      case "AUTH_REQUIRED":
        return "登录状态已过期，请重新登录后再试。";
      default:
        return `Radar 启用失败（${code}），请稍后重试。`;
    }
  }

  switch (code) {
    case "ACTIVE_RADAR_LIMIT_REACHED":
      return "You have reached the active Radar limit. Pause an existing Radar and try again.";
    case "SETUP_NOT_AVAILABLE":
    case "PENDING_SETUP_LOOKUP_FAILED":
      return "The saved Radar setup is no longer available. Return to Rules and confirm it again.";
    case "AUTH_REQUIRED":
      return "Your session has expired. Please log in again and try again.";
    default:
      return `We could not activate your Radar (${code}). Please try again.`;
  }
}

export default function ConnectTelegramPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = use(searchParams);
  const lang = Array.isArray(params.lang) ? params.lang[0] : params.lang;
  const locale = normalizeLocale(lang);
  const copy = getMessages(locale);
  const router = useRouter();
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activationNotice, setActivationNotice] = useState<string | null>(null);
  const attemptRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prepareTelegramLink = useCallback(
    async (attempt: number) => {
      setConnectionState("opening");
      setBotUrl(null);
      setError(null);
      setActivationNotice(null);

      try {
        const response = await fetch("/api/telegram/binding-token", {
          method: "POST",
          cache: "no-store",
        });
        const body = (await response.json()) as { botUrl?: string };

        if (!response.ok || !body.botUrl) {
          throw new Error("BINDING_TOKEN_CREATE_FAILED");
        }

        if (attempt !== attemptRef.current) {
          return;
        }

        setBotUrl(body.botUrl);
        setConnectionState("idle");
      } catch {
        if (attempt === attemptRef.current) {
          setConnectionState("error");
          setError(
            locale === "zh-CN"
              ? "无法生成 Telegram 连接链接，请稍后重试。"
              : "We could not create a Telegram connection link. Please try again.",
          );
        }
      }
    },
    [locale],
  );

  useEffect(() => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    void prepareTelegramLink(attempt);

    return () => {
      attemptRef.current += 1;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [prepareTelegramLink]);

  const activateRadar = async (
    attempt: number,
  ): Promise<"activated" | "no-setup"> => {
    const setupResponse = await fetch("/api/pending-setups/current", {
      cache: "no-store",
    });
    const setupBody = (await setupResponse.json()) as PendingSetupResponse;

    if (!setupResponse.ok) {
      throw new Error(setupBody.error ?? "PENDING_SETUP_LOOKUP_FAILED");
    }

    if (!setupBody.setup?.id) {
      return "no-setup";
    }

    const radarResponse = await fetch("/api/radars", {
      method: "POST",
      cache: "no-store",
    });
    const radarBody = (await radarResponse.json()) as RadarActivationResponse;

    if (!radarBody.radar?.id) {
      throw new Error(radarBody.error ?? "RADAR_CREATION_FAILED");
    }

    if (attempt === attemptRef.current) {
      router.push(`/radars/${radarBody.radar.id}`);
    }

    return "activated";
  };

  const pollForConnection = (attempt: number, startedAt: number) => {
    const poll = async () => {
      if (attempt !== attemptRef.current) {
        return;
      }

      let body: TelegramStatusResponse;

      try {
        const response = await fetch("/api/telegram/status", {
          cache: "no-store",
        });
        body = (await response.json()) as TelegramStatusResponse;

        if (!response.ok) {
          throw new Error("TELEGRAM_STATUS_FAILED");
        }
      } catch {
        if (attempt === attemptRef.current) {
          setConnectionState("error");
          setError(
            locale === "zh-CN"
              ? "暂时无法确认 Telegram 状态，请稍后重试。"
              : "We could not verify Telegram yet. Please try again.",
          );
        }
        return;
      }

      if (body.connected) {
        if (attempt !== attemptRef.current) {
          return;
        }

        setConnectionState("activating");
        setError(null);

        try {
          const activationResult = await activateRadar(attempt);

          if (attempt !== attemptRef.current) {
            return;
          }

          if (activationResult === "no-setup") {
            setConnectionState("connected");
            setActivationNotice(copy.telegram.noPendingSetup);
          }
        } catch (activationError) {
          if (attempt === attemptRef.current) {
            setConnectionState("activation-error");
            setError(activationErrorMessage(activationError, locale));
          }
        }
        return;
      }

      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setConnectionState("error");
        setError(
          locale === "zh-CN"
            ? "等待 Telegram 连接超时，请重新生成连接链接。"
            : "Telegram did not connect in time. Please generate a new link and try again.",
        );
        return;
      }

      pollTimerRef.current = setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };

    void poll();
  };

  const beginTelegramConnection = () => {
    if (!botUrl) {
      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      void prepareTelegramLink(attempt);
      return;
    }

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setConnectionState("waiting");
    setError(null);
    setActivationNotice(null);
    pollForConnection(attempt, Date.now());
  };

  const statusText =
    connectionState === "opening"
      ? locale === "zh-CN"
        ? "正在生成 Telegram 连接链接…"
        : "Preparing your Telegram connection link…"
      : connectionState === "waiting"
        ? copy.telegram.waiting
        : connectionState === "activating"
          ? copy.telegram.activating
          : connectionState === "connected"
            ? activationNotice ?? copy.telegram.connected
            : connectionState === "activation-error"
              ? copy.telegram.activationError
          : connectionState === "error"
              ? locale === "zh-CN"
                ? "Telegram 连接未完成。"
                : "Telegram connection is not complete."
              : locale === "zh-CN"
                ? "请使用上面的链接打开 Telegram，点击 Start 后回来确认。"
                : "Open Telegram with the link above, tap Start, then confirm here.";

  return (
    <main className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/connect-telegram" />
      <div className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <ConnectCard
            locale={locale}
            botUrl={botUrl}
            isPreparing={connectionState === "opening"}
            isChecking={
              connectionState === "waiting" || connectionState === "activating"
            }
            onConnectTelegram={() => {
              beginTelegramConnection();
            }}
          />
          <p className="mt-4 rounded-2xl bg-slate-100 p-4 text-sm text-slate-600" role="status" aria-live="polite">
            {statusText}
          </p>
          {error ? (
            <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
