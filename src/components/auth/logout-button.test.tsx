import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { logoutActionMock, routerReplaceMock } = vi.hoisted(() => ({
  logoutActionMock: vi.fn(),
  routerReplaceMock: vi.fn(),
}));

vi.mock("@/app/auth/actions", () => ({ logoutAction: logoutActionMock }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

import { LogoutButton, type LogoutButtonLabels } from "@/components/auth/logout-button";

const labels: LogoutButtonLabels = {
  logout: "Log out",
  loggingOut: "Logging out…",
  error: "Logout failed. Please try again.",
};

afterEach(() => {
  cleanup();
  logoutActionMock.mockReset();
  routerReplaceMock.mockReset();
});

describe("LogoutButton", () => {
  it("replaces the current route with the home page after a successful logout", async () => {
    logoutActionMock.mockResolvedValue({ ok: true });
    render(<LogoutButton labels={labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the button and shows the pending label while logout is running", async () => {
    let resolveLogout!: (value: { ok: true }) => void;
    logoutActionMock.mockReturnValue(
      new Promise<{ ok: true }>((resolve) => {
        resolveLogout = resolve;
      }),
    );
    render(<LogoutButton labels={labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(screen.getByRole("button", { name: "Logging out…" })).toBeDisabled();
    resolveLogout({ ok: true });
    await waitFor(() => expect(routerReplaceMock).toHaveBeenCalledWith("/"));
  });

  it("shows an alert and does not navigate when logout fails", async () => {
    logoutActionMock.mockResolvedValue({ ok: false, error: "SIGN_OUT_FAILED" });
    render(<LogoutButton labels={labels} />);

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(labels.error);
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
