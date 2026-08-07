import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("NOT_FOUND");
}));
const redirectMock = vi.hoisted(() => vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
}));
const createBrowserClientMock = vi.hoisted(() => vi.fn());
const createServerClientMock = vi.hoisted(() => vi.fn());
const logoutActionMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/client", () => ({ createClient: createBrowserClientMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createServerClientMock }));
vi.mock("@/app/auth/actions", () => ({ logoutAction: logoutActionMock }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

import { RadarCard, type RadarCardRadar } from "@/components/radar/radar-card";
import { FindingsList, type FindingsListFinding } from "@/components/radar/findings-list";
import { RadarActions, WorkspaceLocaleSwitcher, WorkspaceNavigation } from "@/components/radar/radar-actions";
import { RunHistory, type RunHistoryRun } from "@/components/radar/run-history";
import DashboardPage from "@/app/dashboard/page";
import RadarDetailPage from "@/app/radars/[id]/page";
import RadarsPage from "@/app/radars/page";
import { createClient } from "@/lib/supabase/client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/radars/radar-1",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
  notFound: notFoundMock,
  redirect: redirectMock,
}));

type QueryResult = { data: unknown; error: unknown };
type QueryBuilder = {
  select: () => QueryBuilder;
  eq: () => QueryBuilder;
  gt: (column: string, value: number) => QueryBuilder;
  order: () => QueryBuilder;
  in: () => QueryBuilder;
  limit: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  then: Promise<QueryResult>["then"];
};

function makeQuery(result: QueryResult): QueryBuilder {
  const resolve = () => Promise.resolve(result);
  const builder: QueryBuilder = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    order: () => builder,
    in: () => builder,
    limit: resolve,
    maybeSingle: resolve,
    then: (onFulfilled, onRejected) => resolve().then(onFulfilled, onRejected),
  };
  return builder;
}

const testUser = {
  id: "user-1",
  email: "test@example.com",
  user_metadata: {},
};

function setServerClient(fromMock: ReturnType<typeof vi.fn>) {
  createServerClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: testUser } }),
    },
    from: fromMock,
  });
}

function setUnauthenticatedClient() {
  createServerClientMock.mockReturnValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  });
}

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

const detailRadarRow = {
  id: openAiRadar.id,
  user_id: testUser.id,
  name: openAiRadar.name,
  original_prompt: openAiRadar.name,
  rules: { includeTopics: openAiRadar.includeTopics, excludeTopics: [] },
  status: "active" as const,
  interval_minutes: 60,
  last_checked_at: null,
  next_check_at: null,
  created_at: "2026-08-06T08:00:00.000Z",
};

describe("RadarCard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.mocked(createClient).mockReset();
    createServerClientMock.mockReset();
    notFoundMock.mockClear();
    redirectMock.mockClear();
    document.cookie = "wa_locale=; Path=/; Max-Age=0";
  });

  it("shows the localized paused state and links by radar id", () => {
    render(<RadarCard radar={openAiRadar} locale="zh-CN" />);

    expect(screen.getByText("OpenAI Releases")).toBeInTheDocument();
    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", `/radars/${openAiRadar.id}?lang=zh-CN`);
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
      `/radars/${lisaRadar.id}?lang=en`,
    );
    expect(screen.getByRole("link", { name: /OpenAI Releases/i })).toHaveAttribute(
      "href",
      `/radars/${openAiRadar.id}?lang=en`,
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
    expect(screen.getByRole("link", { name: lisaRadar.name })).toHaveAttribute(
      "href",
      `/radars/${finding.radarId}?lang=en`,
    );
  });

  it("does not present findings that have no relevance or importance score", () => {
    render(
      <FindingsList
        findings={[
          {
            ...finding,
            id: "music-news-evaluation-failed",
            sourceDomain: "www.music-news.com",
            relevanceScore: 0,
            importanceScore: 0,
            matchReason: "evaluation_failed",
          },
        ]}
        locale="en"
      />,
    );

    expect(screen.queryByText("www.music-news.com")).not.toBeInTheDocument();
    expect(screen.getByText("No important findings yet")).toBeInTheDocument();
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

  it("uses the API error field for the active-radar limit message", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "ACTIVE_RADAR_LIMIT_REACHED" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RadarActions
        radarId={openAiRadar.id}
        status="paused"
        locale="zh-CN"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("当前已有 3 个运行中的 Radar，暂时无法恢复此 Radar。");
    });
  });

  it("uses the API error field for run limit failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "ACTIVE_RADAR_LIMIT_REACHED" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RadarActions
        radarId={lisaRadar.id}
        status="active"
        locale="en"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This Radar cannot be resumed while three Radars are active.");
    });
  });

  it("does not write a locale cookie when the profile update fails", async () => {
    const singleMock = vi.fn().mockResolvedValue({ data: null, error: new Error("profile update failed") });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock = vi.fn().mockReturnValue({ select: selectMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createClient).mockReturnValue({ from: fromMock } as never);

    render(<WorkspaceLocaleSwitcher locale="en" userId="user-1" path="/dashboard" />);

    fireEvent.click(screen.getByRole("button", { name: "中文" }));

    await waitFor(() => expect(screen.getByText("Language preference could not be saved.")).toBeInTheDocument());
    expect(document.cookie).not.toContain("wa_locale=zh-CN");
    expect(eqMock).toHaveBeenCalledWith("id", "user-1");
    expect(singleMock).toHaveBeenCalledTimes(1);
  });

  it("does not write a locale cookie when no profile row is updated", async () => {
    const singleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const eqMock = vi.fn().mockReturnValue({ select: selectMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    vi.mocked(createClient).mockReturnValue({ from: fromMock } as never);

    render(<WorkspaceLocaleSwitcher locale="en" userId="user-1" path="/dashboard" />);

    fireEvent.click(screen.getByRole("button", { name: "中文" }));

    await waitFor(() => expect(screen.getByText("Language preference could not be saved.")).toBeInTheDocument());
    expect(document.cookie).not.toContain("wa_locale=zh-CN");
    expect(singleMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the current locale on desktop and mobile workspace links", () => {
    render(<WorkspaceNavigation locale="zh-CN" currentPath="/radars" />);

    expect(screen.getAllByRole("link", { name: "工作台" }).every((link) => link.getAttribute("href") === "/dashboard?lang=zh-CN")).toBe(true);
    expect(screen.getAllByRole("link", { name: "我的 Radars" }).every((link) => link.getAttribute("href") === "/radars?lang=zh-CN")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Telegram" }).every((link) => link.getAttribute("href") === "/connect-telegram?lang=zh-CN")).toBe(true);
  });

  it("labels the latest Radar run with relevant and candidate counts", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "zh-CN" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: detailRadarRow, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }))
      .mockImplementationOnce(() => makeQuery({
        data: [{
          id: "run-summary",
          trigger: "schedule",
          status: "success",
          started_at: "2026-08-06T08:00:00.000Z",
          finished_at: "2026-08-06T08:00:08.000Z",
          candidate_count: 4,
          relevant_count: 2,
          notification_count: 1,
          source_outcomes: [{ success: true }],
        }],
        error: null,
      }));
    setServerClient(fromMock);

    const page = await RadarDetailPage({
      params: Promise.resolve({ id: detailRadarRow.id }),
      searchParams: Promise.resolve({ lang: "zh-CN" }),
    });
    render(page as ReactElement);

    expect(screen.getByText("相关 2 / 候选 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑规则" })).toBeInTheDocument();
  });

  it("filters Radar detail findings by positive scores before applying the row limit", async () => {
    const findingQuery = makeQuery({ data: [], error: null });
    const gtMock = vi.fn<(column: string, value: number) => QueryBuilder>(
      () => findingQuery,
    );
    findingQuery.gt = gtMock;
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "en" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: detailRadarRow, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: null }))
      .mockImplementationOnce(() => findingQuery)
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }));
    setServerClient(fromMock);

    await RadarDetailPage({
      params: Promise.resolve({ id: detailRadarRow.id }),
      searchParams: Promise.resolve({ lang: "en" }),
    });

    expect(gtMock).toHaveBeenNthCalledWith(1, "relevance_score", 0);
    expect(gtMock).toHaveBeenNthCalledWith(2, "importance_score", 0);
  });

  it("shows a readable data error instead of 404 when the radar query fails", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "en" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: { message: "database unavailable" } }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: null }));
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1", email: "test@example.com", user_metadata: {} } },
        }),
      },
      from: fromMock,
    });

    const page = await RadarDetailPage({
      params: Promise.resolve({ id: "8a4a2cf8-02b9-4c68-8f33-0f5f160f1a42" }),
      searchParams: Promise.resolve({}),
    });

    render(page as ReactElement);
    expect(screen.getByRole("alert")).toHaveTextContent("Some live details could not be loaded. Refresh and try again.");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("keeps the current locale on Dashboard Telegram, attention, and view-all links", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "en" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: null }))
      .mockImplementationOnce(() => makeQuery({
        data: [{ id: lisaRadar.id, name: lisaRadar.name, status: "active" }],
        error: null,
      }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }))
      .mockImplementationOnce(() => makeQuery({
        data: [{ radar_id: lisaRadar.id, status: "failed", created_at: "2026-08-06T08:00:00.000Z" }],
        error: null,
      }));
    setServerClient(fromMock);

    const page = await DashboardPage({ searchParams: Promise.resolve({ lang: "zh-CN" }) });
    render(page as ReactElement);

    expect(screen.getByRole("link", { name: "连接" })).toHaveAttribute("href", "/connect-telegram?lang=zh-CN");
    expect(screen.getByRole("link", { name: /Telegram 尚未连接/ })).toHaveAttribute("href", "/connect-telegram?lang=zh-CN");
    expect(screen.getByRole("link", { name: /LISA Official Radar 需要重试/ })).toHaveAttribute(
      "href",
      `/radars/${lisaRadar.id}?lang=zh-CN`,
    );
    expect(screen.getByRole("link", { name: /查看全部 Radar/ })).toHaveAttribute("href", "/radars?lang=zh-CN");
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();
  });

  it("does not show the Radars empty state when the radar query fails", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "zh-CN" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: { message: "database unavailable" } }));
    setServerClient(fromMock);

    const page = await RadarsPage({ searchParams: Promise.resolve({ lang: "zh-CN" }) });
    render(page as ReactElement);

    expect(screen.getByRole("alert")).toHaveTextContent("部分 Radar 数据加载失败，请刷新后重试。");
    expect(screen.getByRole("link", { name: "返回 Dashboard" })).toHaveAttribute("href", "/dashboard?lang=zh-CN");
    expect(screen.queryByText("还没有 Radar")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "创建第一个 Radar" })).not.toBeInTheDocument();
  });

  it("does not show the Dashboard empty findings guide when radar data fails", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "en" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: { telegram_username: "watcher" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: { message: "database unavailable" } }));
    setServerClient(fromMock);

    const page = await DashboardPage({ searchParams: Promise.resolve({ lang: "en" }) });
    render(page as ReactElement);

    expect(screen.getByRole("alert")).toHaveTextContent("Some live data could not be loaded. Refresh and try again.");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByText("No important findings yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Your next successful check will appear here.")).not.toBeInTheDocument();
  });

  it("keeps the current locale on Radar detail back and Telegram management links", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: { locale: "en" }, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: detailRadarRow, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }));
    setServerClient(fromMock);

    const page = await RadarDetailPage({
      params: Promise.resolve({ id: detailRadarRow.id }),
      searchParams: Promise.resolve({ lang: "zh-CN" }),
    });
    render(page as ReactElement);

    expect(screen.getAllByRole("link", { name: "我的 Radars" }).some((link) => link.getAttribute("href") === "/radars?lang=zh-CN")).toBe(true);
    expect(screen.getByRole("link", { name: "管理 Telegram" })).toHaveAttribute("href", "/connect-telegram?lang=zh-CN");
  });

  it("includes profile and Telegram query errors in the Radar detail data error", async () => {
    const fromMock = vi
      .fn()
      .mockImplementationOnce(() => makeQuery({ data: null, error: { message: "profile unavailable" } }))
      .mockImplementationOnce(() => makeQuery({ data: detailRadarRow, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: { message: "telegram unavailable" } }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }));
    setServerClient(fromMock);

    const page = await RadarDetailPage({
      params: Promise.resolve({ id: detailRadarRow.id }),
      searchParams: Promise.resolve({ lang: "en" }),
    });
    render(page as ReactElement);

    expect(screen.getByRole("alert")).toHaveTextContent("Some live details could not be loaded. Refresh and try again.");
    expect(screen.queryByText("Telegram not connected")).not.toBeInTheDocument();
  });

  it("keeps zh-CN on the unauthenticated Dashboard redirect", async () => {
    setUnauthenticatedClient();

    await expect(DashboardPage({ searchParams: Promise.resolve({ lang: "zh-CN" }) })).rejects.toThrow(
      "REDIRECT:/auth?mode=login&next=dashboard&lang=zh-CN",
    );
    expect(redirectMock).toHaveBeenCalledWith("/auth?mode=login&next=dashboard&lang=zh-CN");
  });

  it("keeps zh-CN on the unauthenticated My Radars redirect", async () => {
    setUnauthenticatedClient();

    await expect(RadarsPage({ searchParams: Promise.resolve({ lang: "zh-CN" }) })).rejects.toThrow(
      "REDIRECT:/auth?mode=login&next=radars&lang=zh-CN",
    );
    expect(redirectMock).toHaveBeenCalledWith("/auth?mode=login&next=radars&lang=zh-CN");
  });

  it("keeps zh-CN on the unauthenticated Radar detail redirect", async () => {
    setUnauthenticatedClient();

    await expect(
      RadarDetailPage({
        params: Promise.resolve({ id: detailRadarRow.id }),
        searchParams: Promise.resolve({ lang: "zh-CN" }),
      }),
    ).rejects.toThrow("REDIRECT:/auth?mode=login&next=dashboard&lang=zh-CN");
    expect(redirectMock).toHaveBeenCalledWith("/auth?mode=login&next=dashboard&lang=zh-CN");
  });

  it("falls back to the safe default locale for invalid unauthenticated lang values", async () => {
    setUnauthenticatedClient();
    await expect(DashboardPage({ searchParams: Promise.resolve({ lang: "fr" }) })).rejects.toThrow(
      "REDIRECT:/auth?mode=login&next=dashboard&lang=en",
    );

    redirectMock.mockClear();
    setUnauthenticatedClient();
    await expect(RadarsPage({ searchParams: Promise.resolve({ lang: "fr" }) })).rejects.toThrow(
      "REDIRECT:/auth?mode=login&next=radars&lang=en",
    );

    redirectMock.mockClear();
    setUnauthenticatedClient();
    await expect(
      RadarDetailPage({
        params: Promise.resolve({ id: detailRadarRow.id }),
        searchParams: Promise.resolve({ lang: "fr" }),
      }),
    ).rejects.toThrow("REDIRECT:/auth?mode=login&next=dashboard&lang=en");
  });
});
