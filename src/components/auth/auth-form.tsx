"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n";
import { getMessages } from "@/lib/i18n";

export type AuthMode = "login" | "signup";

interface AuthFormProps {
  locale: Locale;
  initialMode?: AuthMode;
  error?: string;
  onModeChange?: (mode: AuthMode) => void;
  onAuthenticate: (payload: { mode: AuthMode; fullName: string; email: string; password: string }) => void | Promise<void>;
}

type FieldName = "fullName" | "email" | "password";
type FieldErrors = Partial<Record<FieldName, string>>;

export function AuthForm({ locale, initialMode = "login", error, onModeChange, onAuthenticate }: AuthFormProps) {
  const copy = getMessages(locale).auth;
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const setAuthMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setFieldErrors({});
    onModeChange?.(nextMode);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: FieldErrors = {};
    if (mode === "signup" && !fullName.trim()) {
      nextErrors.fullName = copy.validation.fullNameRequired;
    }
    if (!email.trim().includes("@") || !email.trim().includes(".")) {
      nextErrors.email = copy.validation.emailInvalid;
    }
    if (password.length < 8) {
      nextErrors.password = copy.validation.passwordShort;
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onAuthenticate({ mode, fullName, email, password });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="grid grid-cols-1 gap-2 rounded-2xl bg-slate-100 p-1 min-[850px]:grid-cols-2">
        <button
          type="button"
          onClick={() => setAuthMode("login")}
          className={mode === "login" ? "rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm" : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-500"}
        >
          {copy.login}
        </button>
        <button
          type="button"
          onClick={() => setAuthMode("signup")}
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
              id="auth-full-name"
              value={fullName}
              onChange={(event) => {
                setFullName(event.target.value);
                setFieldErrors((current) => ({ ...current, fullName: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.fullName)}
              aria-describedby={fieldErrors.fullName ? "auth-full-name-error" : undefined}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
            />
            {fieldErrors.fullName ? <p id="auth-full-name-error" className="text-sm font-normal text-rose-600">{fieldErrors.fullName}</p> : null}
          </label>
        ) : null}

          <label className="grid gap-2 text-sm font-semibold text-slate-900">
            <span>{copy.email}</span>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((current) => ({ ...current, email: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
            />
            {fieldErrors.email ? <p id="auth-email-error" className="text-sm font-normal text-rose-600">{fieldErrors.email}</p> : null}
          </label>

          <label className="grid gap-2 text-sm font-semibold text-slate-900">
            <span>{copy.password}</span>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setFieldErrors((current) => ({ ...current, password: undefined }));
              }}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-normal outline-none focus:border-violet-300"
            />
            {fieldErrors.password ? <p id="auth-password-error" className="text-sm font-normal text-rose-600">{fieldErrors.password}</p> : null}
          </label>
      </div>

      {error ? (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="mt-6 h-11 w-full rounded-2xl bg-violet-600 text-white hover:bg-violet-500"
      >
        {copy.continue}
      </Button>

      {mode === "login" ? (
        <Link
          href={`/auth?lang=${locale}&mode=login&reset=1`}
          className="mx-auto mt-4 block w-fit text-sm font-medium text-violet-700"
        >
          {copy.forgot}
        </Link>
      ) : null}
    </form>
  );
}
