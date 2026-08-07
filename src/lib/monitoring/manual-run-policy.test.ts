import { describe, expect, it } from "vitest";

import { isMvpManualRunBypassUser } from "@/lib/monitoring/manual-run-policy";

describe("MVP manual run policy", () => {
  it("allows the two designated QA accounts to bypass manual-run limits", () => {
    expect(isMvpManualRunBypassUser("bf2a2366-47b7-40ba-aed5-04410f787fff")).toBe(true);
    expect(isMvpManualRunBypassUser("a40b13f7-12d8-4b5a-a7d2-f2b55cc7e6cd")).toBe(true);
  });

  it("does not bypass limits for another account", () => {
    expect(isMvpManualRunBypassUser("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});
