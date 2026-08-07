import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectCard } from "@/components/telegram/connect-card";
import { getMessages } from "@/lib/i18n";

afterEach(cleanup);

describe("ConnectCard", () => {
  it("renders the tokenized Telegram deep link before confirmation", () => {
    const onConnectTelegram = vi.fn();
    const botUrl = "https://t.me/watchanything_bot?start=one-time-token";

    render(
      <ConnectCard
        locale="en"
        botUrl={botUrl}
        onConnectTelegram={onConnectTelegram}
      />,
    );

    expect(screen.getByRole("link", { name: /open telegram/i }).getAttribute("href")).toBe(botUrl);
  });

  it("only emits the callback and does not claim Telegram connected locally", () => {
    const onConnectTelegram = vi.fn();
    const copy = getMessages("en").telegram;

    render(
      <ConnectCard
        locale="en"
        botUrl="https://t.me/watchanything_bot?start=one-time-token"
        onConnectTelegram={onConnectTelegram}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: copy.connect }));

    expect(onConnectTelegram).toHaveBeenCalledWith({ username: "@watchanything_bot" });
    expect(screen.getByText(copy.waiting)).not.toBeNull();
    expect(screen.queryByText(/callback completed locally/i)).toBeNull();
  });
});
