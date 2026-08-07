import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RulesPage from "@/app/rules/page";
import type { RadarRules } from "@/types/contracts";

const { routerPush, routerReplace } = vi.hoisted(() => ({ routerPush: vi.fn(), routerReplace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}));

const rules: RadarRules = {
  radarName: "OpenAI Updates",
  subject: "Track OpenAI official model and API announcements.",
  aliases: ["OpenAI"],
  includeTopics: ["model releases"],
  excludeTopics: ["rumors"],
  searchQuery: "OpenAI official model API announcement",
  importanceThreshold: 75,
  intervalMinutes: 360,
};

function fulfilledSearchParams(value: Record<string, string>) {
  return Object.assign(Promise.resolve(value), { status: "fulfilled", value });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  routerPush.mockReset();
  routerReplace.mockReset();
});

describe("RulesPage", () => {
  it("returns to the landing page when opened without a request or saved draft", async () => {
    render(
      <RulesPage
        searchParams={fulfilledSearchParams({ lang: "en" }) as never}
      />,
    );

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/?lang=en");
    });
  });

  it("shows a parsing state instead of a second request form", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    render(
      <RulesPage
        searchParams={fulfilledSearchParams({
          lang: "en",
          request: "Track OpenAI official model and API announcements",
        }) as never}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Preparing your Radar rules" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Start with a monitoring request" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Preparing your rules");
  });

  it("does not render demo rules when parsing fails and offers a retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "RULE_PARSE_FAILED" }), { status: 502 }),
      ),
    );

    render(
      <RulesPage
        searchParams={fulfilledSearchParams({
          lang: "en",
          request: "Track OpenAI official model and API announcements",
        }) as never}
      />,
    );

    expect((await screen.findByRole("alert")).textContent).toMatch(/could not prepare/i);
    expect(screen.getByText("Track OpenAI official model and API announcements")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).not.toBeNull();
    expect(screen.queryByDisplayValue("LISA Official Radar")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Review what this Radar should watch" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
  });

  it("sends a confirmed parsed draft to Auth", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rules, ruleToken: "signed-rule-token" }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401 }),
        ),
    );

    render(
      <RulesPage
        searchParams={fulfilledSearchParams({
          lang: "en",
          request: "Track OpenAI official model and API announcements",
        }) as never}
      />
    );

    await screen.findByRole("heading", { name: "Review what this Radar should watch" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rules" }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/auth?lang=en&mode=signup");
    });
  });

  it("continues an authenticated user without opening Auth", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ rules, ruleToken: "signed-rule-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ next: "connect-telegram" }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RulesPage
        searchParams={fulfilledSearchParams({
          lang: "en",
          request: "Track OpenAI official model and API announcements",
        }) as never}
      />,
    );

    await screen.findByRole("heading", { name: "Review what this Radar should watch" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rules" }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/connect-telegram?lang=en");
    });
    expect(routerPush).not.toHaveBeenCalledWith("/auth?lang=en&mode=signup");
  });

  it("keeps the request when switching the rules locale", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ rules, ruleToken: "signed-rule-token" }), { status: 200 }),
      ),
    );

    render(
      <RulesPage
        searchParams={fulfilledSearchParams({
          lang: "en",
          request: "Track OpenAI official model and API announcements",
        }) as never}
      />,
    );

    await screen.findByRole("heading", { name: "Review what this Radar should watch" });
    expect(screen.getByRole("link", { name: "中文" }).getAttribute("href")).toBe(
      "/rules?lang=zh-CN&request=Track%20OpenAI%20official%20model%20and%20API%20announcements",
    );
  });
});
