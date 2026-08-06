import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "@/components/auth/auth-form";

afterEach(cleanup);

describe("AuthForm", () => {
  it("shows field-level validation and does not submit empty signup data", () => {
    const onAuthenticate = vi.fn();

    render(<AuthForm locale="en" initialMode="signup" onAuthenticate={onAuthenticate} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Full name is required.")).not.toBeNull();
    expect(screen.getByText("Enter a valid email address.")).not.toBeNull();
    expect(screen.getByText("Password must be at least 8 characters.")).not.toBeNull();
    expect(onAuthenticate).not.toHaveBeenCalled();
  });

  it("shows format and password errors for malformed signup data", () => {
    const onAuthenticate = vi.fn();

    render(<AuthForm locale="en" initialMode="signup" onAuthenticate={onAuthenticate} />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "QA Tester" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Enter a valid email address.")).not.toBeNull();
    expect(screen.getByText("Password must be at least 8 characters.")).not.toBeNull();
    expect(onAuthenticate).not.toHaveBeenCalled();
  });
});
