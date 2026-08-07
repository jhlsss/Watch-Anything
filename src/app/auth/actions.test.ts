import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import {
  formatRuleFlowError,
  readRuleFlowStorage,
  submitPendingSetup,
  writeRuleFlowStorage,
} from "@/app/auth/page";
import { authenticateAction, logoutAction } from "@/app/auth/actions";
import { POST as parseRulesPost } from "@/app/api/rules/parse/route";
import { getOrCreatePendingSetup } from "@/app/api/pending-setups/route";
import { hasImmutableRuleChanges } from "@/app/rules/page";
import { resolveSafeNext } from "@/lib/auth/service";
import type { RadarRules } from "@/types/contracts";

const {
  createAdminClientMock,
  createServerClientMock,
  parseRulesMock,
  signInMock,
  createUserMock,
  signOutMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  createServerClientMock: vi.fn(),
  parseRulesMock: vi.fn(),
  signInMock: vi.fn(),
  createUserMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createServerClientMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createClient: createAdminClientMock,
}));

vi.mock("@/lib/ai/parse-rules", () => ({
  parseRules: parseRulesMock,
}));

const validRules: RadarRules = {
  radarName: "LISA Official Radar",
  subject: "Track official LISA releases and tours.",
  aliases: ["Lalisa Manobal"],
  includeTopics: ["official releases"],
  excludeTopics: [],
  searchQuery: "LISA official releases",
  importanceThreshold: 75,
  intervalMinutes: 360,
};

beforeAll(() => {
  process.env.RULE_TOKEN_SECRET =
    "test-rule-token-secret-that-is-at-least-32-characters-long";
});

describe("authenticateAction", () => {
  it("preserves the Radars return target", () => {
    expect(resolveSafeNext("radars")).toBe("/radars");
  });

  beforeEach(() => {
    signInMock.mockReset();
    createUserMock.mockReset();
    createAdminClientMock.mockReset();
    createAdminClientMock.mockReturnValue({
      auth: {
        admin: {
          createUser: createUserMock,
        },
      },
    });
    createServerClientMock.mockReturnValue({
      auth: {
        signInWithPassword: signInMock,
      },
    });
  });

  it("returns only an allowlisted next route after a successful login", async () => {
    signInMock.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "server-only" } },
      error: null,
    });

    await expect(
      authenticateAction({
        mode: "login",
        email: "user@example.com",
        password: "password123",
        next: "connect-telegram",
      }),
    ).resolves.toEqual({ ok: true, next: "/connect-telegram" });
  });

  it("maps an external next value to dashboard and never returns session data", async () => {
    signInMock.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "server-only" } },
      error: null,
    });

    const result = await authenticateAction({
      mode: "login",
      email: "user@example.com",
      password: "password123",
      next: "https://evil.example",
    });

    expect(result).toEqual({ ok: true, next: "/dashboard" });
    expect(result).not.toHaveProperty("session");
  });

  it("supports signup and turns provider failures into stable form errors", async () => {
    createUserMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    signInMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    await expect(
      authenticateAction({
        mode: "signup",
        fullName: "QA Tester",
        email: "user@example.com",
        password: "password123",
        next: "dashboard",
      }),
    ).resolves.toEqual({ ok: false, error: "AUTHENTICATION_FAILED" });
  });

  it("recovers a repeated signup by signing into the existing account", async () => {
    createUserMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });
    signInMock.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "server-only" } },
      error: null,
    });

    await expect(
      authenticateAction({
        mode: "signup",
        fullName: "QA Tester",
        email: "user@example.com",
        password: "password123",
        next: "connect-telegram",
      }),
    ).resolves.toEqual({ ok: true, next: "/connect-telegram" });
    expect(createUserMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "password123",
      email_confirm: true,
      user_metadata: { full_name: "QA Tester" },
    });
  });

  it("recovers when signup creates the user but does not return a session", async () => {
    createUserMock.mockResolvedValue({
      data: { user: { id: "user-1" }, session: null },
      error: null,
    });
    signInMock.mockResolvedValue({
      data: { user: { id: "user-1" }, session: { access_token: "server-only" } },
      error: null,
    });

    await expect(
      authenticateAction({
        mode: "signup",
        fullName: "QA Tester",
        email: "user@example.com",
        password: "password123",
        next: "connect-telegram",
      }),
    ).resolves.toEqual({ ok: true, next: "/connect-telegram" });
  });

  it("does not clear persisted rules when authentication fails", async () => {
    const flow = {
      originalPrompt: "Track LISA releases",
      ruleToken: "signed-token",
      editableDelta: {
        radarName: "LISA Radar",
        includeTopics: ["official releases"],
        excludeTopics: [],
      },
    };
    writeRuleFlowStorage(flow);
    signInMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid login credentials" },
    });

    await authenticateAction({
      mode: "login",
      email: "user@example.com",
      password: "password123",
      next: "connect-telegram",
    });

    expect(readRuleFlowStorage()).toEqual(flow);
  });
});

describe("logoutAction", () => {
  beforeEach(() => {
    signOutMock.mockReset();
    createServerClientMock.mockReset();
    createServerClientMock.mockReturnValue({
      auth: { signOut: signOutMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns success after the server Supabase client signs out", async () => {
    signOutMock.mockResolvedValue({ error: null });

    await expect(logoutAction()).resolves.toEqual({ ok: true });
    expect(signOutMock).toHaveBeenCalledOnce();
  });

  it("maps a Supabase sign-out error to a stable action error", async () => {
    const providerError = { message: "Sign out unavailable" };
    signOutMock.mockResolvedValue({ error: providerError });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logoutAction()).resolves.toEqual({
      ok: false,
      error: "SIGN_OUT_FAILED",
    });
    expect(consoleError).toHaveBeenCalledWith("Logout failed.", providerError);
  });

  it("maps an unexpected sign-out exception to a stable action error", async () => {
    const exception = new Error("network unavailable");
    signOutMock.mockRejectedValue(exception);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(logoutAction()).resolves.toEqual({
      ok: false,
      error: "SIGN_OUT_FAILED",
    });
    expect(consoleError).toHaveBeenCalledWith("Logout failed.", exception);
  });
});

describe("Auth rule restoration helpers", () => {
  it("survives an Auth page refresh without persisting credentials", () => {
    const flow = {
      originalPrompt: "Track LISA releases",
      ruleToken: "signed-token",
      editableDelta: {
        radarName: "LISA Radar",
        includeTopics: ["official releases"],
        excludeTopics: [],
      },
    };

    writeRuleFlowStorage(flow);
    const restoredAfterRefresh = readRuleFlowStorage();

    expect(restoredAfterRefresh).toEqual(flow);
    expect(localStorage.getItem("watch-anything.rule-flow")).not.toContain("password");
    expect(localStorage.getItem("watch-anything.rule-flow")).not.toContain("session");
    expect(localStorage.getItem("watch-anything.rule-flow")).not.toContain("service_role");
  });

  it("turns an expired signed token into a request to prepare rules again", () => {
    expect(formatRuleFlowError("EXPIRED_RULE_TOKEN", "zh-CN")).toContain("重新整理");
    expect(formatRuleFlowError("EXPIRED_RULE_TOKEN", "en")).toContain("prepare");
  });

  it("clears persisted rules only after pending setup creation succeeds", async () => {
    const flow = {
      originalPrompt: "Track LISA releases",
      ruleToken: "signed-token",
      editableDelta: {
        radarName: "LISA Radar",
        includeTopics: ["official releases"],
        excludeTopics: [],
      },
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ next: "connect-telegram" }), { status: 200 }),
    );

    writeRuleFlowStorage(flow);
    await expect(submitPendingSetup(flow, fetcher)).resolves.toEqual({
      ok: true,
      next: "connect-telegram",
    });
    expect(readRuleFlowStorage()).toBeNull();

    writeRuleFlowStorage(flow);
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "EXPIRED_RULE_TOKEN" }), { status: 400 }),
    );
    await expect(submitPendingSetup(flow, fetcher)).resolves.toEqual({
      ok: false,
      error: "EXPIRED_RULE_TOKEN",
    });
    expect(readRuleFlowStorage()).toEqual(flow);
  });
});

describe("parse route", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    createAdminClientMock.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: { allowed: false, identity_count: 3, global_count: 3 },
        error: null,
      }),
    });
    parseRulesMock.mockReset();
  });

  it("does not let an exhausted production quota block local rule parsing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const admin = createAdminClientMock();
    parseRulesMock.mockResolvedValueOnce(validRules);
    const request = new NextRequest("http://localhost/api/rules/parse", {
      method: "POST",
      body: JSON.stringify({ prompt: "Track official company announcements", locale: "en" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await parseRulesPost(request);

    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ rules: validRules });
  });

  it("does not apply the guest quota to production rule parsing", async () => {
    const admin = createAdminClientMock();
    parseRulesMock.mockResolvedValueOnce(validRules);
    const request = new NextRequest("http://localhost/api/rules/parse", {
      method: "POST",
      body: JSON.stringify({ prompt: "Track long-form company announcements", locale: "en" }),
      headers: { "Content-Type": "application/json" },
    });

    const response = await parseRulesPost(request);

    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ rules: validRules });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});

describe("pending setup idempotency", () => {
  it("returns the existing setup without inserting a replay", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "setup-1", expires_at: "2099-01-01T00:00:00.000Z" },
      error: null,
    });
    const insert = vi.fn();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      maybeSingle,
      insert,
    };
    const admin = { from: vi.fn().mockReturnValue(query) };

    await expect(
      getOrCreatePendingSetup({
        admin: admin as never,
        userId: "user-1",
        originalPrompt: "Track LISA releases",
        rules: validRules,
        ruleTokenHash: "token-hash",
        expiresAt: "2099-01-02T00:00:00.000Z",
      }),
    ).resolves.toEqual({ id: "setup-1" });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("editable rule boundary", () => {
  it("detects changes to signed non-delta fields", () => {
    expect(
      hasImmutableRuleChanges(
        { ...validRules, subject: "changed" },
        validRules,
      ),
    ).toBe(true);
    expect(
      hasImmutableRuleChanges(
        { ...validRules, searchQuery: "changed" },
        validRules,
      ),
    ).toBe(true);
    expect(
      hasImmutableRuleChanges(
        { ...validRules, importanceThreshold: 80 },
        validRules,
      ),
    ).toBe(true);
    expect(hasImmutableRuleChanges(validRules, validRules)).toBe(false);
  });
});
