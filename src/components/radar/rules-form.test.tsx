import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("RulesForm", () => {
  it("adds a new include topic and submits the updated rules", () => {
    const onSubmit = vi.fn();

    render(<RulesForm initialRules={rules} onSubmit={onSubmit} />);

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
});
