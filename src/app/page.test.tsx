import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Home from "@/app/page";

afterEach(cleanup);

const fulfilledSearchParams = Object.assign(Promise.resolve({ lang: "en" }), {
  status: "fulfilled",
  value: { lang: "en" },
});

describe("Landing templates", () => {
  it("carries a distinct initial request for every starter template", () => {
    render(<Home searchParams={fulfilledSearchParams as never} />);

    const hrefs = [
      screen.getByRole("link", { name: /Creator updates/i }).getAttribute("href"),
      screen.getByRole("link", { name: /Company announcements/i }).getAttribute("href"),
      screen.getByRole("link", { name: /Industry intelligence/i }).getAttribute("href"),
      screen.getByRole("link", { name: /Job opportunities/i }).getAttribute("href"),
    ];

    expect(new Set(hrefs).size).toBe(4);
    expect(hrefs[3]).toContain("request=");
    expect(decodeURIComponent(hrefs[3] ?? "")).toContain("job");
  });

  it("shows finding evidence, flow connectors, and a footer on the landing page", () => {
    render(<Home searchParams={fulfilledSearchParams as never} />);

    expect(screen.getAllByText(/View source/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Source: Official announcement")).toBeTruthy();
    expect(screen.getAllByLabelText("Next step")).toHaveLength(2);
    expect(screen.getByText("© 2026 Watch Anything")).toBeTruthy();
  });
});
