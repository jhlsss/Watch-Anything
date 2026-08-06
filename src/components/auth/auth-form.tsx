"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

type AuthMode = "login" | "signup";

interface AuthFormProps {
  locale: Locale;
  initialMode?: AuthMode;
  onAuthenticate: (payload: { mode: AuthMode; fullName: string; email: string; password: string }) => void;
}

export function AuthForm({ locale, initialMode = "login", onAuthenticate }: AuthFormProps) {
  const copy = getMessages(locale).auth;
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAuthenticate({ mode, fullName, email, password });
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={mode === "login" ? "rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm" : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-500"}
        >
          {copy.login}
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={mode === "signup" ? "rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm" : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-500"}
        >
          {copy.signup}
        </button>
      </div>

      <div className="mt-6 grid gap-4">
        {mode === "signup" ? (
          <label className="grid gap-2 text-sm font-semibold text-slate-900">
            <span>{copy.fullName}</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
            />
          </label>
        ) : null}

        <label className="grid gap-2 text-sm font-semibold text-slate-900">
          <span>{copy.email}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
          />
        </label>

        <label className="grid gap-2 text-sm font-semibold text-slate-900">
          <span>{copy.password}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
          />
        </label>
      </div>

      <Button type="submit" className="mt-6 h-11 w-full rounded-2xl bg-violet-600 text-white hover:bg-violet-500">
        {copy.continue}
      </Button>

      {mode === "login" ? (
        <button type="button" className="mx-auto mt-4 block text-sm font-medium text-violet-700">
          {copy.forgot}
        </button>
      ) : null}
    </form>
  );
}
