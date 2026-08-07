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

  it("uses the same content rail as the landing sections", () => {
    render(
      <SiteHeader
        locale="en"
        brand="Watch Anything"
        localeLabel="Language"
        localeNames={{ en: "EN", "zh-CN": "中文" }}
      />,
    );

    const contentRail = screen.getAllByRole("banner").at(-1)?.firstElementChild;
    const className = contentRail?.getAttribute("class") ?? "";

    expect(className).toContain("max-w-[1160px]");
    expect(className).toContain("w-[calc(100%_-_28px)]");
    expect(className).toContain("min-[850px]:w-[calc(100%_-_44px)]");
  });

  it("renders a localized account action when the visitor is signed in", () => {
    render(
      <SiteHeader
        locale="zh-CN"
        brand="Watch Anything"
        localeLabel="语言"
        localeNames={{ en: "EN", "zh-CN": "中文" }}
        accountAction={{ href: "/dashboard", label: "qa@example.com" }}
      />,
    );

    expect(screen.getByRole("link", { name: "qa@example.com" }).getAttribute("href")).toBe("/dashboard?lang=zh-CN");
  });
});
