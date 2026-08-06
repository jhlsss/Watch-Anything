import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatRuleFlowError,
  readRuleFlowStorage,
  writeRuleFlowStorage,
} from "@/app/auth/page";
import { authenticateAction } from "@/app/auth/actions";

const { createServerClientMock, signInMock, signUpMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  signInMock: vi.fn(),
  signUpMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createServerClientMock,
}));

describe("authenticateAction", () => {
  beforeEach(() => {
    signInMock.mockReset();
    signUpMock.mockReset();
    createServerClientMock.mockReturnValue({
      auth: {
        signInWithPassword: signInMock,
        signUp: signUpMock,
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
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });

    await expect(
      authenticateAction({
        mode: "signup",
        email: "user@example.com",
        password: "password123",
        next: "dashboard",
      }),
    ).resolves.toEqual({ ok: false, error: "AUTHENTICATION_FAILED" });
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
});
