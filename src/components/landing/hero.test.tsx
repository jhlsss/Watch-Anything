import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hero } from "@/components/landing/hero";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Hero", () => {
  it("renders the prototype phone preview and highlighted headline", () => {
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
      />,
    );

    expect(screen.getByText("matters.").className).toContain("text-violet-600");
    expect(screen.getByText("Watch Anything")).toBeTruthy();
    expect(screen.getByText("bot")).toBeTruthy();
    expect(screen.getByText("LISA announced a new single releasing this September.")).toBeTruthy();
    expect(screen.getByText("A new API model was added to the official documentation.")).toBeTruthy();
    expect(screen.getByText("No other important updates today.")).toBeTruthy();
  });

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

  it("shows inline AI processing feedback after submitting a request", () => {
    vi.useFakeTimers();
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

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Track official OpenAI releases" },
    });
    fireEvent.click(screen.getByRole("link", { name: "Build my radar" }));

    expect(onParseRequest).toHaveBeenCalledWith("Track official OpenAI releases");
    expect(screen.getByRole("status").textContent).toContain(
      "AI is turning that into clear monitoring rules",
    );
  });

  it("submits the request when the user presses Enter", () => {
    vi.useFakeTimers();
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

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Track official OpenAI releases" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(onParseRequest).toHaveBeenCalledWith("Track official OpenAI releases");
    expect(screen.getByRole("status")).not.toBeNull();
  });
});
