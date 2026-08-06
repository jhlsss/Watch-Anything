import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthPage from "@/app/auth/page";
import ConnectTelegramPage from "@/app/connect-telegram/page";
import RulesPage from "@/app/rules/page";
import { AppSidebar } from "@/components/layout/app-sidebar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

const promisedSearchParams = Object.assign(Promise.resolve({ lang: "zh-CN" }), {
  status: "fulfilled",
  value: { lang: "zh-CN" },
});

describe("App Router page searchParams", () => {
  it("keeps workspace navigation pointed at the real destinations", () => {
    render(<AppSidebar locale="en" currentPath="/rules" />);

    expect(screen.getAllByRole("link", { name: "Dashboard" })[0].getAttribute("href")).toBe(
      "/dashboard?lang=en",
    );
    expect(screen.getAllByRole("link", { name: "Radars" })[0].getAttribute("href")).toBe(
      "/radars?lang=en",
    );
  });

  it("unwraps the promised locale on Auth", async () => {
    await promisedSearchParams;
    render(
      <Suspense fallback={<p>loading</p>}>
        <AuthPage searchParams={promisedSearchParams as never} />
      </Suspense>,
    );
    expect(await screen.findByRole("heading", { name: "登录你的工作区" })).not.toBeNull();
  });

  it("unwraps the promised locale on Connect Telegram", async () => {
    await promisedSearchParams;
    render(
      <Suspense fallback={<p>loading</p>}>
        <ConnectTelegramPage searchParams={promisedSearchParams as never} />
      </Suspense>,
    );
    expect(await screen.findByRole("heading", { name: "连接 Telegram" })).not.toBeNull();
  });

  it("unwraps the promised locale on Rules", async () => {
    await promisedSearchParams;
    render(
      <Suspense fallback={<p>loading</p>}>
        <RulesPage searchParams={promisedSearchParams as never} />
      </Suspense>,
    );
    expect(await screen.findByRole("heading", { name: "先写下你想关注的内容" })).not.toBeNull();
  });
});
