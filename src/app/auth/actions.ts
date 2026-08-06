"use server";

import {
  resolveSafeNext,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth/service";
import { authSchema } from "@/lib/validation/auth";

type AuthenticateActionPayload = {
  mode: "login" | "signup";
  fullName?: string;
  email: string;
  password: string;
  next?: unknown;
};

export type AuthenticateActionInput = AuthenticateActionPayload | FormData;

export type AuthenticateActionResult =
  | { ok: true; next: "/dashboard" | "/radars" | "/connect-telegram" }
  | {
      ok: false;
      error: "INVALID_INPUT" | "AUTHENTICATION_FAILED";
    };

function normalizeInput(
  input: AuthenticateActionInput,
): AuthenticateActionPayload | null {
  if (typeof FormData !== "undefined" && input instanceof FormData) {
    const mode = input.get("mode");
    const email = input.get("email");
    const password = input.get("password");
    const fullName = input.get("fullName");
    const next = input.get("next");

    if (
      (mode !== "login" && mode !== "signup") ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return null;
    }

    return {
      mode,
      email,
      password,
      ...(typeof fullName === "string" ? { fullName } : {}),
      ...(typeof next === "string" ? { next } : {}),
    };
  }

  if (!input || typeof input !== "object") {
    return null;
  }

  return input as AuthenticateActionPayload;
}

function hasAuthenticatedSession(result: Awaited<ReturnType<typeof signInWithPassword>>): boolean {
  return Boolean(!result.error && result.data.user && result.data.session);
}

function canRecoverSignup(result: Awaited<ReturnType<typeof signUpWithPassword>>): boolean {
  if (!result.error) {
    return Boolean(result.data.user && !result.data.session);
  }

  return /already\s+(?:registered|exists)/iu.test(result.error.message);
}

export async function authenticateAction(
  input: AuthenticateActionInput,
): Promise<AuthenticateActionResult> {
  const normalizedInput = normalizeInput(input);

  if (
    !normalizedInput ||
    (normalizedInput.mode !== "login" && normalizedInput.mode !== "signup")
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  if (normalizedInput.mode === "signup" && !normalizedInput.fullName?.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const safeNext = resolveSafeNext(normalizedInput.next);
  const parsed = authSchema.safeParse({
    email: normalizedInput.email,
    password: normalizedInput.password,
    next:
      safeNext === "/connect-telegram"
        ? "connect-telegram"
        : safeNext === "/radars"
          ? "radars"
          : "dashboard",
  });

  if (!parsed.success) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    const authInput = {
      ...parsed.data,
      ...(normalizedInput.mode === "signup"
        ? { fullName: normalizedInput.fullName }
        : {}),
    };
    let result =
      normalizedInput.mode === "signup"
        ? await signUpWithPassword(authInput)
        : await signInWithPassword(authInput);

    if (normalizedInput.mode === "signup" && canRecoverSignup(result)) {
      result = await signInWithPassword(authInput);
    }

    if (!hasAuthenticatedSession(result)) {
      return { ok: false, error: "AUTHENTICATION_FAILED" };
    }

    return { ok: true, next: result.next };
  } catch (error) {
    console.error("Authentication failed.", error);
    return { ok: false, error: "AUTHENTICATION_FAILED" };
  }
}
