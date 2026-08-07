import { describe, expect, it, vi } from "vitest";

import { signOut } from "@/lib/auth/service";

describe("signOut", () => {
  it("calls the provided auth client and returns its provider result", async () => {
    const providerError = { message: "Sign out unavailable" };
    const signOutMock = vi.fn().mockResolvedValue({ error: providerError });
    const client = { auth: { signOut: signOutMock } };

    await expect(signOut(client)).resolves.toEqual({ error: providerError });
    expect(signOutMock).toHaveBeenCalledOnce();
  });
});
