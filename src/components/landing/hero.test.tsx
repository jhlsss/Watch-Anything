import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/landing/hero";

afterEach(cleanup);

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

  it("keeps an empty request on the landing page and explains the required field", () => {
    const onParseRequest = vi.fn();

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
        onParseRequest={onParseRequest}
      />,
    );

    fireEvent.click(screen.getAllByRole("link", { name: "Build my radar" })[0]);

    expect(onParseRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Tell us what you would like to monitor.");
  });
});
