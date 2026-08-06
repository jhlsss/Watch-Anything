import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RulesForm } from "@/components/radar/rules-form";
import type { RadarRules } from "@/types/contracts";

const rules: RadarRules = {
  radarName: "LISA",
  subject: "LISA interviews",
  aliases: ["Lalisa Manobal"],
  includeTopics: ["Magazine covers"],
  excludeTopics: ["Fan edits"],
  searchQuery: "LISA interview OR profile",
  importanceThreshold: 3,
  intervalMinutes: 360,
};

afterEach(cleanup);

describe("RulesForm", () => {
  it("only exposes the three editable rule fields", () => {
    render(<RulesForm initialRules={rules} locale="en" />);

    expect(screen.queryByRole("textbox", { name: "Your request" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Search query" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Importance threshold" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Review what this Radar should watch" })).not.toBeNull();
    expect(screen.getByText("Your request")).not.toBeNull();
    expect(screen.getByText("Notify me about")).not.toBeNull();
    expect(screen.getByText("Ignore")).not.toBeNull();
    expect(screen.getByText("Generated search query")).not.toBeNull();
    expect(screen.getByText("Importance threshold")).not.toBeNull();
    expect(screen.getByRole("button", { name: "+ Add topic" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "+ Add exclusion" })).not.toBeNull();
    expect(screen.queryByLabelText("New include topic")).toBeNull();
    expect(screen.queryByLabelText("New exclude topic")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to home" })).not.toBeNull();
  });

  it("adds a new include topic and submits the updated rules", () => {
    const onSubmit = vi.fn();

    render(<RulesForm initialRules={rules} locale="zh-CN" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: /添加关注项/i }));
    fireEvent.change(screen.getByLabelText(/新的关注项/i), {
      target: { value: "Official interviews" },
    });
    fireEvent.click(screen.getByRole("button", { name: /确认规则/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTopics: expect.arrayContaining(["Official interviews"]),
      }),
    );
  });

  it("removes an exclude topic with a localized SVG delete control before confirming", () => {
    const onConfirmRules = vi.fn();

    render(<RulesForm initialRules={rules} locale="en" onConfirmRules={onConfirmRules} />);

    fireEvent.click(screen.getAllByRole("button", { name: /Remove topic/ })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm rules" }));

    expect(onConfirmRules).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTopics: [],
      }),
    );
    expect(screen.queryByText("Fan edits")).toBeNull();
  });

  it("blocks confirmation and explains an invalid Radar name", () => {
    const onConfirmRules = vi.fn();

    render(<RulesForm initialRules={rules} locale="en" onConfirmRules={onConfirmRules} />);

    const radarName = screen.getByRole("textbox", { name: "Radar name" });
    fireEvent.change(radarName, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rules" }));

    expect(onConfirmRules).not.toHaveBeenCalled();
    expect(radarName.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("at least 2 characters");
  });
});
