import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthPage, { formatRuleFlowError } from "@/app/auth/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

function fulfilledSearchParams(value: Record<string, string>) {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

describe("AuthPage", () => {
  it("explains the Radar limit instead of showing a generic authentication error", () => {
    expect(formatRuleFlowError("ACTIVE_RADAR_LIMIT_REACHED", "en")).toContain(
      "maximum of 3 active Radars",
    );
    expect(formatRuleFlowError("ACTIVE_RADAR_LIMIT_REACHED", "zh-CN")).toContain(
      "最多创建 3 个启用中的 Radar",
    );
  });

  it("uses signup copy when the signup mode is selected", async () => {
    render(
      <AuthPage
        searchParams={fulfilledSearchParams({ lang: "en", mode: "signup" }) as never}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Create your Watch Anything account" })).not.toBeNull();
    expect(screen.getByText("Create an account to activate your confirmed Radar rules.")).not.toBeNull();
  });

  it("shows an explicit reset-password MVP state", async () => {
    render(
      <AuthPage
        searchParams={fulfilledSearchParams({ lang: "en", reset: "1" }) as never}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Reset your password" })).not.toBeNull();
    expect(screen.getByText("Password reset is not available in this MVP yet.")).not.toBeNull();
  });
});
