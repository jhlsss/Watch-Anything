"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { logoutAction } from "@/app/auth/actions";

export type LogoutButtonLabels = {
  logout: string;
  loggingOut: string;
  error: string;
};

export function LogoutButton({ labels }: { labels: LogoutButtonLabels }) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setHasError(false);
    setIsLoggingOut(true);

    try {
      const result = await logoutAction();

      if (!result.ok) {
        setHasError(true);
        return;
      }

      router.replace("/");
    } catch {
      setHasError(true);
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isLoggingOut}
        aria-busy={isLoggingOut}
        onClick={() => void handleLogout()}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {isLoggingOut ? labels.loggingOut : labels.logout}
      </button>
      {hasError ? (
        <p role="alert" className="text-xs text-rose-600">
          {labels.error}
        </p>
      ) : null}
    </div>
  );
}
