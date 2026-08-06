import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/landing/hero";

describe("Hero", () => {
  it("uses a real rules-page link for the primary CTA", () => {
    render(
      <Hero
        locale="en"
        title="Never miss what matters."
        kicker="Your AI radar"
        description="Track useful updates."
        inputPlaceholder="What would you like to monitor?"
        primaryCta="Build my radar"
        helper="Preview first."
        examples={[]}
        onParseRequest={vi.fn()}
      />,
    );

    expect(screen.getByRole("link", { name: "Build my radar" }).getAttribute("href")).toBe("/rules?lang=en");
  });
});
