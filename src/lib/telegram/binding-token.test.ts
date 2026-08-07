import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  createClient: vi.fn(),
}));

import {
  consumeBindingToken,
  createBindingToken,
  hashBindingToken,
} from "@/lib/telegram/binding-token";

describe("Telegram binding tokens", () => {
  it("creates a short-lived raw token and stores only its hash", () => {
    const issuedAt = new Date("2026-08-07T00:00:00.000Z");
    const result = createBindingToken(issuedAt);

    expect(result.token).toHaveLength(43);
    expect(result.tokenHash).toBe(hashBindingToken(result.token));
    expect(result.expiresAt).toBe("2026-08-07T00:10:00.000Z");
    expect(result.tokenHash).not.toContain(result.token);
  });

  it("consumes a raw token through the atomic RPC and surfaces one-time errors", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ user_id: "user-1", error_code: null }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ user_id: null, error_code: "TOKEN_ALREADY_USED" }],
        error: null,
      });
    const client = { rpc };

    await expect(
      consumeBindingToken("raw-token", {
        chatId: 123456,
        username: "alice",
        client,
      }),
    ).resolves.toEqual({ userId: "user-1" });

    expect(rpc).toHaveBeenCalledWith("consume_telegram_binding_token", {
      p_token_hash: hashBindingToken("raw-token"),
      p_chat_id: 123456,
      p_username: "alice",
    });

    await expect(
      consumeBindingToken("raw-token", {
        chatId: 123456,
        username: "alice",
        client,
      }),
    ).rejects.toThrow("TOKEN_ALREADY_USED");
  });

  it("ships the service-role-only atomic consume migration", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/202608060003_telegram_binding.sql",
    );

    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) {
      return;
    }

    const migration = readFileSync(migrationPath, "utf8")
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toMatch(
      /create or replace function public\.consume_telegram_binding_token\(\s*p_token_hash text, p_chat_id bigint, p_username text\s*\).*security definer set search_path = public, pg_temp/,
    );
    expect(migration).toContain("for update");
    expect(migration).toContain("used_at is null");
    expect(migration).toMatch(
      /revoke all on function public\.consume_telegram_binding_token\(text, bigint, text\) from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.consume_telegram_binding_token\(text, bigint, text\) to service_role/,
    );
  });

  it("avoids the output user_id variable in the telegram connection conflict target", () => {
    const migrationPath = resolve(
      process.cwd(),
      "supabase/migrations/202608060003_telegram_binding.sql",
    );
    const migration = readFileSync(migrationPath, "utf8")
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase();

    expect(migration).toContain(
      "on conflict on constraint telegram_connections_pkey",
    );
    expect(migration).not.toMatch(/on conflict\s*\(\s*user_id\s*\)/);
  });
});
