import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const adminFrom = vi.hoisted(() => vi.fn());
const adminRpc = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(() => ({ from: adminFrom, rpc: adminRpc })),
}));

vi.mock("@/lib/env", () => ({
  parseServerEnv: vi.fn(() => ({
    CRON_SECRET: "cron-secret",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    RULE_TOKEN_SECRET: "rule-token-secret-that-is-at-least-32-chars",
    TAVILY_API_KEY: "tavily-key",
    GEMINI_API_KEY: "gemini-key",
    GEMINI_MODEL: "gemini-3.1-flash-lite",
    TELEGRAM_BOT_TOKEN: "telegram-token",
    TELEGRAM_BOT_USERNAME: "watchanything_bot",
    TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
  })),
}));

import {
  GET as probeRunDue,
  POST as runDue,
} from "@/app/api/cron/run-due/route";

describe("Cron API route surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the run-due handler", () => {
    expect(existsSync(path.resolve(process.cwd(), "src/app/api/cron/run-due/route.ts"))).toBe(true);
  });

  it("returns 401 before touching monitoring data without the cron secret", async () => {
    const response = await runDue(new Request("http://localhost/api/cron/run-due"));

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong cron secret", async () => {
    const response = await runDue(
      new Request("http://localhost/api/cron/run-due", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      }),
    );

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("keeps GET probes behind the same cron secret boundary", async () => {
    const response = await probeRunDue(
      new Request("http://localhost/api/cron/run-due"),
    );

    expect(response.status).toBe(401);
    expect(adminFrom).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
