import { parseServerEnv } from "@/lib/env";

type FetchLike = typeof fetch;

type TelegramResult<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramClientOptions = {
  token?: string;
  fetchFn?: FetchLike;
};

type SetWebhookInput = {
  url: string;
  secretToken: string;
  allowedUpdates?: string[];
  dropPendingUpdates?: boolean;
};

type SendMessageInput = {
  chatId: number | string;
  text: string;
};

export class TelegramApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

export function createTelegramClient({
  token = parseServerEnv().TELEGRAM_BOT_TOKEN,
  fetchFn = fetch,
}: TelegramClientOptions = {}) {
  async function callTelegramApi<T>(
    method: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    try {
      const response = await fetchFn(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(8000),
        },
      );

      const payload = (await response.json()) as TelegramResult<T>;

      if (!response.ok || !payload.ok || payload.result === undefined) {
        throw new TelegramApiError(
          "TELEGRAM_API_ERROR",
          payload.description ?? `Telegram ${method} failed.`,
        );
      }

      return payload.result;
    } catch (error) {
      if (error instanceof TelegramApiError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new TelegramApiError(
          "TELEGRAM_RESULT_UNKNOWN",
          "Telegram request timed out before delivery could be confirmed.",
        );
      }

      throw new TelegramApiError(
        "TELEGRAM_API_ERROR",
        error instanceof Error ? error.message : "Telegram request failed.",
      );
    }
  }

  return {
    getMe() {
      return callTelegramApi<{
        id: number;
        is_bot: boolean;
        first_name: string;
        username: string;
      }>("getMe");
    },
    setWebhook({
      url,
      secretToken,
      allowedUpdates = ["message"],
      dropPendingUpdates = true,
    }: SetWebhookInput) {
      return callTelegramApi<boolean>("setWebhook", {
        url,
        secret_token: secretToken,
        allowed_updates: allowedUpdates,
        drop_pending_updates: dropPendingUpdates,
      });
    },
    getWebhookInfo() {
      return callTelegramApi<{
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
      }>("getWebhookInfo");
    },
    sendMessage({ chatId, text }: SendMessageInput) {
      return callTelegramApi<{
        message_id: number;
      }>("sendMessage", {
        chat_id: chatId,
        text,
      });
    },
  };
}

export async function sendTelegramMessage({
  chatId,
  text,
  token = parseServerEnv().TELEGRAM_BOT_TOKEN,
  fetchFn = fetch,
}: SendMessageInput & TelegramClientOptions) {
  const client = createTelegramClient({
    token,
    fetchFn,
  });

  return client.sendMessage({
    chatId,
    text,
  });
}
