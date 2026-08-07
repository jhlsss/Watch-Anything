import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConnectTelegramPage from "@/app/connect-telegram/page";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const searchParams = Object.assign(Promise.resolve({ lang: "en" }), {
  status: "fulfilled",
  value: { lang: "en" },
});

describe("ConnectTelegramPage", () => {
  it("prepares a tokenized Telegram link when the page opens", async () => {
    const botUrl = "https://t.me/watchanything_bot?start=one-time-token";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ botUrl }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Suspense fallback={<p>loading</p>}>
        <ConnectTelegramPage searchParams={searchParams as never} />
      </Suspense>,
    );

    const link = await screen.findByRole("link", { name: /open telegram/i });

    expect(link.getAttribute("href")).toBe(botUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/telegram/binding-token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
