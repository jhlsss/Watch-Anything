import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectCard } from "@/components/telegram/connect-card";
import { getMessages } from "@/lib/i18n";

describe("ConnectCard", () => {
  it("only emits the callback and does not claim Telegram connected locally", () => {
    const onConnectTelegram = vi.fn();
    const copy = getMessages("en").telegram;

    render(<ConnectCard locale="en" onConnectTelegram={onConnectTelegram} />);

    fireEvent.click(screen.getByRole("button", { name: copy.connect }));

    expect(onConnectTelegram).toHaveBeenCalledWith({ username: "@watchanything_bot" });
    expect(screen.getByText(copy.waiting)).not.toBeNull();
    expect(screen.queryByText(/callback completed locally/i)).toBeNull();
  });
});
