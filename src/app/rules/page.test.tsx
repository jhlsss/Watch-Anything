import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RulesPage from "@/app/rules/page";
import type { RadarRules } from "@/types/contracts";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
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
});

describe("RulesPage", () => {
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
    expect(screen.queryByRole("heading", { name: "Confirm your Radar rules" })).toBeNull();
  });

  it("sends a confirmed parsed draft to Auth", async () => {
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
      />
    );

    await screen.findByRole("heading", { name: "Confirm your Radar rules" });
    fireEvent.click(screen.getByRole("button", { name: "Confirm rules" }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/auth?lang=en&mode=signup");
    });
  });
});
