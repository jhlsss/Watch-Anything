import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("keeps Telegram connected when there is no pending Radar setup", async () => {
    const botUrl = "https://t.me/watchanything_bot?start=one-time-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ botUrl }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connected: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ setup: null }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Suspense fallback={<p>loading</p>}>
        <ConnectTelegramPage searchParams={searchParams as never} />
      </Suspense>,
    );

    await screen.findByRole("link", { name: /open telegram/i });
    fireEvent.click(screen.getByRole("button", { name: /i have started/i }));

    expect(
      await screen.findByText(
        /telegram is connected\. there is no radar waiting to be activated\./i,
      ),
    ).not.toBeNull();
    expect(screen.queryByText(/could not verify telegram yet/i)).toBeNull();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("reports Radar activation failures separately from Telegram verification", async () => {
    const botUrl = "https://t.me/watchanything_bot?start=one-time-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ botUrl }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connected: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ setup: { id: "setup-id" } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "ACTIVE_RADAR_LIMIT_REACHED" }), {
          status: 409,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Suspense fallback={<p>loading</p>}>
        <ConnectTelegramPage searchParams={searchParams as never} />
      </Suspense>,
    );

    await screen.findByRole("link", { name: /open telegram/i });
    fireEvent.click(screen.getByRole("button", { name: /i have started/i }));

    expect(
      await screen.findByText(/you have reached the active radar limit/i),
    ).not.toBeNull();
    expect(screen.queryByText(/could not verify telegram yet/i)).toBeNull();
    expect(screen.getByText(/telegram is connected, but radar activation needs attention/i)).not.toBeNull();
  });

  it("opens the Radar detail when creation succeeded but the baseline run failed", async () => {
    const botUrl = "https://t.me/watchanything_bot?start=one-time-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ botUrl }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ connected: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ setup: { id: "setup-id" } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            radar: { id: "radar-id" },
            run: null,
            error: "BASELINE_FAILED",
          }),
          { status: 500 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <Suspense fallback={<p>loading</p>}>
        <ConnectTelegramPage searchParams={searchParams as never} />
      </Suspense>,
    );

    await screen.findByRole("link", { name: /open telegram/i });
    fireEvent.click(screen.getByRole("button", { name: /i have started/i }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith("/radars/radar-id");
    });
    expect(screen.queryByText(/could not activate your radar/i)).toBeNull();
  });
});
