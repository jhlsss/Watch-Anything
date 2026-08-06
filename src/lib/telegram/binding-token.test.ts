import { describe, expect, it } from "vitest";

import {
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
});
