"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { ConnectCard } from "@/components/telegram/connect-card";
import { getMessages, normalizeLocale } from "@/lib/i18n";

type ConnectionState = "idle" | "opening" | "waiting" | "connected" | "error";

type TelegramStatusResponse = {
  connected?: boolean;
  username?: string | null;
};

type PendingSetupResponse = {
  setup?: { id?: string } | null;
};

type RadarActivationResponse = {
  radar?: { id?: string };
  error?: string;
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

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
  const attemptRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prepareTelegramLink = useCallback(
    async (attempt: number) => {
      setConnectionState("opening");
      setBotUrl(null);
      setError(null);

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

  const activateRadar = async (attempt: number) => {
    const setupResponse = await fetch("/api/pending-setups/current", {
      cache: "no-store",
    });
    const setupBody = (await setupResponse.json()) as PendingSetupResponse;

    if (!setupResponse.ok || !setupBody.setup?.id) {
      throw new Error("PENDING_SETUP_UNAVAILABLE");
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
  };

  const pollForConnection = (attempt: number, startedAt: number) => {
    const poll = async () => {
      if (attempt !== attemptRef.current) {
        return;
      }

      try {
        const response = await fetch("/api/telegram/status", {
          cache: "no-store",
        });
        const body = (await response.json()) as TelegramStatusResponse;

        if (!response.ok) {
          throw new Error("TELEGRAM_STATUS_FAILED");
        }

        if (body.connected) {
          setConnectionState("connected");
          await activateRadar(attempt);
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
      } catch {
        if (attempt === attemptRef.current) {
          setConnectionState("error");
          setError(
            locale === "zh-CN"
              ? "暂时无法确认 Telegram 状态，请稍后重试。"
              : "We could not verify Telegram yet. Please try again.",
          );
        }
      }
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
    pollForConnection(attempt, Date.now());
  };

  const statusText =
    connectionState === "opening"
      ? locale === "zh-CN"
        ? "正在生成 Telegram 连接链接…"
        : "Preparing your Telegram connection link…"
      : connectionState === "waiting"
        ? copy.telegram.waiting
        : connectionState === "connected"
          ? locale === "zh-CN"
            ? "Telegram 已连接，正在激活 Radar…"
            : "Telegram is connected. Activating your Radar…"
          : connectionState === "error"
            ? locale === "zh-CN"
              ? "Telegram 连接未完成。"
              : "Telegram connection is not complete."
            : null;

  return (
    <main className="flex min-h-screen min-w-0 bg-slate-50 text-slate-950">
      <AppSidebar locale={locale} currentPath="/connect-telegram" />
      <div className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 min-[850px]:pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <ConnectCard
            locale={locale}
            botUrl={botUrl}
            isPreparing={connectionState === "opening"}
            statusMessage={statusText}
            onConnectTelegram={() => {
              beginTelegramConnection();
            }}
          />
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
