import { describe, expect, it, vi } from "vitest";

import {
  resolveSafeNext,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth/service";
import { authSchema } from "@/lib/validation/auth";

describe("authSchema", () => {
  it("accepts a valid email, password, and dashboard next target", () => {
    expect(
      authSchema.safeParse({
        email: "chawei@example.com",
        password: "12345678",
        next: "dashboard",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed auth input and off-site next targets", () => {
    expect(
      authSchema.safeParse({
        email: "bad-email",
        password: "123",
        next: "https://evil.example",
      }).success,
    ).toBe(false);
  });
});

describe("resolveSafeNext", () => {
  it("maps allowlisted next values to internal routes", () => {
    expect(resolveSafeNext("dashboard")).toBe("/dashboard");
    expect(resolveSafeNext("connect-telegram")).toBe("/connect-telegram");
  });

  it("falls back to dashboard for unknown or external next targets", () => {
    expect(resolveSafeNext(undefined)).toBe("/dashboard");
    expect(resolveSafeNext("https://evil.example")).toBe("/dashboard");
  });
});

describe("auth service", () => {
  it("signs in with validated email and password and resolves next safely", async () => {
    const signInWithPasswordMock = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });

    const result = await signInWithPassword(
      {
        email: "chawei@example.com",
        password: "12345678",
        next: "connect-telegram",
      },
      {
        auth: {
          signInWithPassword: signInWithPasswordMock,
          signUp: vi.fn(),
        },
      },
    );

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "chawei@example.com",
      password: "12345678",
    });
    expect(result.next).toBe("/connect-telegram");
  });

  it("signs up with validated email and password and defaults unknown next to dashboard", async () => {
    const signUpMock = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });

    const result = await signUpWithPassword(
      {
        email: "chawei@example.com",
        password: "12345678",
        next: "https://evil.example",
      },
      {
        auth: {
          signInWithPassword: vi.fn(),
          signUp: signUpMock,
        },
      },
    );

    expect(signUpMock).toHaveBeenCalledWith({
      email: "chawei@example.com",
      password: "12345678",
      options: { emailRedirectTo: undefined },
    });
    expect(result.next).toBe("/dashboard");
  });
});
