import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AuthPage from "@/app/auth/page";
import ConnectTelegramPage from "@/app/connect-telegram/page";
import RulesPage from "@/app/rules/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(cleanup);

const promisedSearchParams = Object.assign(Promise.resolve({ lang: "zh-CN" }), {
  status: "fulfilled",
  value: { lang: "zh-CN" },
});

describe("App Router page searchParams", () => {
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
    expect(await screen.findByRole("heading", { name: "确认你的 Radar 规则" })).not.toBeNull();
  });
});
