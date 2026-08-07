import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  RadarRulesCard,
  type RadarRulesCardLabels,
  type RadarRulesCardRules,
} from "@/components/radar/radar-rules-card";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const labels: RadarRulesCardLabels = {
  title: "Monitoring rules",
  edit: "Edit rules",
  save: "Save rules",
  cancel: "Cancel",
  saving: "Saving…",
  radarName: "Radar name",
  include: "Include topics",
  exclude: "Exclude topics",
  notifyAbout: "Notify about",
  ignore: "Ignore",
  subject: "Subject",
  searchQuery: "Search query",
  frequency: "Frequency",
  threshold: "Threshold",
  nextCheck: "Next check",
  emptyRules: "No topics configured",
  everyHoursLabel: "Every 6 hours",
  includeHint: "One topic per line",
  validationName: "Radar name must be 2–80 characters.",
  validationInclude: "Include 1–8 topics, with each topic 1–60 characters.",
  validationExclude: "Exclude up to 8 topics, with each topic 1–60 characters.",
  actionError: "The action could not be completed. Please try again.",
};

const rules: RadarRulesCardRules = {
  radarName: "OpenAI Updates",
  subject: "OpenAI",
  includeTopics: ["Product launches", "AI releases"],
  excludeTopics: ["Rumors"],
  searchQuery: "OpenAI product launches",
  importanceThreshold: 75,
  intervalMinutes: 360,
};

function renderCard() {
  return render(
    <RadarRulesCard
      radarId="radar-1"
      locale="en"
      rules={rules}
      labels={labels}
      nextCheckLabel="In 5h 52m"
    />,
  );
}

describe("RadarRulesCard", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the rule summary and an in-card edit action", () => {
    renderCard();

    expect(screen.getByRole("heading", { name: "Monitoring rules" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Edit rules" })).not.toBeNull();
    expect(screen.getByText("Product launches")).not.toBeNull();
    expect(screen.getByText("Rumors")).not.toBeNull();
    expect(screen.getByText("Every 6 hours")).not.toBeNull();
    expect(screen.getByText("In 5h 52m")).not.toBeNull();
  });

  it("uses localized labels for the Chinese editor", () => {
    render(
      <RadarRulesCard
        radarId="radar-1"
        locale="zh-CN"
        rules={rules}
        labels={{
          ...labels,
          title: "监控规则",
          edit: "编辑规则",
          save: "保存规则",
          cancel: "取消",
          saving: "保存中…",
          radarName: "Radar 名称",
          include: "关注项",
          exclude: "排除项",
          includeHint: "每行填写一项",
          everyHoursLabel: "每 6 小时",
          nextCheck: "下次检查",
        }}
        nextCheckLabel="5 小时 52 分钟后"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑规则" }));

    expect(screen.getByRole("textbox", { name: "Radar 名称" })).toHaveValue("OpenAI Updates");
    expect(screen.getByRole("button", { name: "保存规则" })).not.toBeNull();
  });

  it("opens the editor with the current rule values", () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));

    expect(screen.getByRole("textbox", { name: "Radar name" })).toHaveValue("OpenAI Updates");
    expect(screen.getByRole("textbox", { name: "Include topics" })).toHaveValue("Product launches\nAI releases");
    expect(screen.getByRole("textbox", { name: "Exclude topics" })).toHaveValue("Rumors");
    expect(screen.getByRole("button", { name: "Save rules" })).not.toBeNull();
  });

  it("keeps the editor open and reports validation errors before saving", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Radar name" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Include topics" }), { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Exclude topics" }), { target: { value: "a\nb\nc\nd\ne\nf\ng\nh\ni" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    expect(screen.getByText(labels.validationName)).not.toBeNull();
    expect(screen.getByText(labels.validationInclude)).not.toBeNull();
    expect(screen.getByText(labels.validationExclude)).not.toBeNull();
    expect(screen.getByRole("textbox", { name: "Include topics" }).getAttribute("aria-describedby")).toBe("rules-card-include-error");
    expect(screen.getByRole("textbox", { name: "Exclude topics" }).getAttribute("aria-describedby")).toBe("rules-card-exclude-error");
    expect(screen.getAllByRole("textbox")[0]).toHaveValue("");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("saves the edited rule payload and closes the editor", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Radar name" }), { target: { value: "OpenAI Releases" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/radars/radar-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            action: "update_rules",
            radarName: "OpenAI Releases",
            includeTopics: ["Product launches", "AI releases"],
            excludeTopics: ["Rumors"],
          }),
        }),
      );
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("button", { name: "Edit rules" })).not.toBeNull();
    });
  });

  it("keeps the editor open when saving fails", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({ error: "DATABASE_ERROR" }) } as Response);
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Radar name" }), { target: { value: "Unsaved Radar" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Include topics" }), { target: { value: "New topic" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Exclude topics" }), { target: { value: "New exclusion" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rules" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(labels.actionError);
      expect(screen.getAllByRole("textbox")[0]).toHaveValue("Unsaved Radar");
      expect(screen.getByRole("textbox", { name: "Include topics" })).toHaveValue("New topic");
      expect(screen.getByRole("textbox", { name: "Exclude topics" })).toHaveValue("New exclusion");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("cancels without sending a request", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Radar name" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
