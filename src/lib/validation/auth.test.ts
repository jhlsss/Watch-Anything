import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

import {
  resolveSafeNext,
  signInWithPassword,
  signUpWithPassword,
} from "@/lib/auth/service";
import { authSchema } from "@/lib/validation/auth";

const { getClaimsMock } = vi.hoisted(() => ({
  getClaimsMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getClaims: getClaimsMock,
    },
  })),
}));

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

describe("proxy protected paths", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([
    "/dashboard",
    "/dashboard/settings",
    "/radars",
    "/radars/example/runs",
    "/connect-telegram",
    "/connect-telegram/setup",
  ])("redirects unauthenticated requests for %s", async (pathname) => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    getClaimsMock.mockResolvedValue({ data: { claims: null } });

    const response = await proxy(new NextRequest(`http://localhost${pathname}`));

    expect(response.status).toBe(307);
  });
});

describe("Supabase auth migration contract", () => {
  it("defines the auth.users after-insert trigger that inserts profiles", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "supabase/migrations/202608060001_initial_schema.sql",
      ),
      "utf8",
    )
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toMatch(
      /create or replace function public\.handle_new_user\(\).*insert into public\.profiles\s*\(id, locale\).*values\s*\(new\.id, 'en'\).*on conflict\s*\(id\) do nothing/,
    );
    expect(migration).toMatch(
      /create trigger on_auth_user_created.*after insert on auth\.users.*execute function public\.handle_new_user\(\)/,
    );
  });
});

const supabaseIntegrationConfig = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};
const missingIntegrationConfig = Object.entries(supabaseIntegrationConfig)
  .filter(([, value]) => !value || value.startsWith("your-") || value.startsWith("replace-with"))
  .map(([name]) => name);
const runSupabaseIntegrationTest = missingIntegrationConfig.length
  ? it.skip
  : it;

runSupabaseIntegrationTest(
  `integration: signUp creates a profile through the auth.users trigger${
    missingIntegrationConfig.length
      ? ` (SKIP: missing ${missingIntegrationConfig.join(", ")})`
      : ""
  }`,
  async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anonClient = createClient(
      supabaseIntegrationConfig.url!,
      supabaseIntegrationConfig.publishableKey!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const adminClient = createClient(
      supabaseIntegrationConfig.url!,
      supabaseIntegrationConfig.serviceRoleKey!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const email = `task1-trigger-${randomUUID()}@example.com`;
    const password = `Task1-trigger-${randomUUID()}!`;
    let userId: string | undefined;

    try {
      const { data, error } = await anonClient.auth.signUp({ email, password });

      expect(error).toBeNull();
      userId = data.user?.id;
      expect(userId).toBeDefined();

      const { data: profile, error: profileError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("id", userId!)
        .single();

      expect(profileError).toBeNull();
      expect(profile).toEqual({ id: userId });
    } finally {
      if (userId) {
        const { error } = await adminClient.auth.admin.deleteUser(userId);

        if (error) {
          throw error;
        }
      }
    }
  },
);
