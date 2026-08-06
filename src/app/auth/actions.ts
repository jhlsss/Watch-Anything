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
  | { ok: true; next: "/dashboard" | "/connect-telegram" }
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

  const safeNext = resolveSafeNext(normalizedInput.next);
  const parsed = authSchema.safeParse({
    email: normalizedInput.email,
    password: normalizedInput.password,
    next: safeNext === "/connect-telegram" ? "connect-telegram" : "dashboard",
  });

  if (!parsed.success) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  try {
    const result =
      normalizedInput.mode === "signup"
        ? await signUpWithPassword(parsed.data)
        : await signInWithPassword(parsed.data);

    if (result.error || !result.data.user || !result.data.session) {
      return { ok: false, error: "AUTHENTICATION_FAILED" };
    }

    return { ok: true, next: result.next };
  } catch (error) {
    console.error("Authentication failed.", error);
    return { ok: false, error: "AUTHENTICATION_FAILED" };
  }
}
