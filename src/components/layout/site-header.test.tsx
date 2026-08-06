import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteHeader } from "@/components/layout/site-header";

describe("SiteHeader", () => {
  it("puts the locale query before a navigation hash", () => {
    render(
      <SiteHeader
        locale="zh-CN"
        brand="Watch Anything"
        localeLabel="语言"
        localeNames={{ en: "EN", "zh-CN": "中文" }}
        navLinks={[{ href: "/#how", label: "工作方式" }]}
      />,
    );

    expect(screen.getByRole("link", { name: "工作方式" }).getAttribute("href")).toBe("/?lang=zh-CN#how");
  });
});
