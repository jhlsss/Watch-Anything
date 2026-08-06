import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthPage from "@/app/auth/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

function fulfilledSearchParams(value: Record<string, string>) {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

describe("AuthPage", () => {
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
