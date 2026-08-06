import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadarCard, type RadarCardRadar } from "@/components/radar/radar-card";
import { FindingsList, type FindingsListFinding } from "@/components/radar/findings-list";
import { RadarActions } from "@/components/radar/radar-actions";
import { RunHistory, type RunHistoryRun } from "@/components/radar/run-history";

vi.mock("next/navigation", () => ({
  usePathname: () => "/radars/radar-1",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const openAiRadar: RadarCardRadar = {
  id: "8a4a2cf8-02b9-4c68-8f33-0f5f160f1a42",
  name: "OpenAI Releases",
  status: "paused",
  includeTopics: ["Model releases", "API updates"],
  lastCheckedAt: "2026-08-06T08:00:00.000Z",
  nextCheckAt: null,
  newFindings: 0,
};

const lisaRadar: RadarCardRadar = {
  id: "99dd1c03-22fb-4f11-8c1b-9bf46aa38ef4",
  name: "LISA Official Radar",
  status: "active",
  includeTopics: ["Music releases", "Tours"],
  lastCheckedAt: "2026-08-06T09:00:00.000Z",
  nextCheckAt: "2026-08-06T15:00:00.000Z",
  newFindings: 2,
};

const finding: FindingsListFinding = {
  id: "finding-1",
  radarId: lisaRadar.id,
  radarName: lisaRadar.name,
  title: "LISA announces a new single for September",
  summary: "The official announcement confirms a new single release.",
  sourceDomain: "example.com",
  sourceUrl: "https://example.com/lisa-single",
  publishedAt: "2026-08-06T08:00:00.000Z",
  firstSeenAt: "2026-08-06T08:05:00.000Z",
  relevanceScore: 94,
  importanceScore: 91,
  matchReason: "New music release from an official source",
  notificationStatus: "sent",
};

const runs: RunHistoryRun[] = [
  {
    id: "run-running",
    trigger: "manual",
    status: "running",
    startedAt: "2026-08-06T08:00:00.000Z",
    finishedAt: null,
    candidateCount: 0,
    relevantCount: 0,
    notificationCount: 0,
    sourceCount: 0,
  },
  {
    id: "run-success",
    trigger: "schedule",
    status: "success",
    startedAt: "2026-08-05T08:00:00.000Z",
    finishedAt: "2026-08-05T08:00:08.000Z",
    candidateCount: 8,
    relevantCount: 2,
    notificationCount: 1,
    sourceCount: 2,
  },
  {
    id: "run-failed",
    trigger: "manual",
    status: "failed",
    startedAt: "2026-08-04T08:00:00.000Z",
    finishedAt: "2026-08-04T08:00:05.000Z",
    candidateCount: 0,
    relevantCount: 0,
    notificationCount: 0,
    sourceCount: 2,
  },
];

describe("RadarCard", () => {
  afterEach(cleanup);

  it("shows the localized paused state and links by radar id", () => {
    render(<RadarCard radar={openAiRadar} locale="zh-CN" />);

    expect(screen.getByText("OpenAI Releases")).toBeInTheDocument();
    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/radars/${openAiRadar.id}`);
  });

  it("keeps distinct radar ids when rendering multiple cards", () => {
    render(
      <>
        <RadarCard radar={lisaRadar} locale="en" />
        <RadarCard radar={openAiRadar} locale="en" />
      </>,
    );

    expect(screen.getByRole("link", { name: /LISA Official Radar/i })).toHaveAttribute(
      "href",
      `/radars/${lisaRadar.id}`,
    );
    expect(screen.getByRole("link", { name: /OpenAI Releases/i })).toHaveAttribute(
      "href",
      `/radars/${openAiRadar.id}`,
    );
  });

  it("shows a finding source link and match details", () => {
    render(<FindingsList findings={[finding]} locale="en" />);

    expect(screen.getByRole("heading", { name: finding.title })).toBeInTheDocument();
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Importance 91")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view source/i })).toHaveAttribute(
      "href",
      finding.sourceUrl,
    );
  });

  it("renders only the three public run states", () => {
    render(<RunHistory runs={runs} locale="en" />);

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText(/partial|incomplete/i)).not.toBeInTheDocument();
  });

  it("sends pause through the frozen radar PATCH endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RadarActions
        radarId={lisaRadar.id}
        status="active"
        locale="en"
        rules={{
          radarName: lisaRadar.name,
          includeTopics: lisaRadar.includeTopics,
          excludeTopics: ["Fan speculation"],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/radars/${lisaRadar.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ action: "pause" }),
        }),
      );
    });
  });

  it("keeps the edit form open when the rules PATCH fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RadarActions
        radarId={lisaRadar.id}
        status="active"
        locale="en"
        rules={{ radarName: lisaRadar.name, includeTopics: lisaRadar.includeTopics, excludeTopics: [] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("sends only editable rule fields through update_rules", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RadarActions
        radarId={lisaRadar.id}
        status="active"
        locale="en"
        rules={{ radarName: lisaRadar.name, includeTopics: lisaRadar.includeTopics, excludeTopics: [] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    fireEvent.change(screen.getByLabelText("Radar name"), { target: { value: "LISA Updates" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/radars/${lisaRadar.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            action: "update_rules",
            radarName: "LISA Updates",
            includeTopics: lisaRadar.includeTopics,
            excludeTopics: [],
          }),
        }),
      );
    });
  });
});
