const deploymentUrl = process.argv[2]?.trim().replace(/\/+$/u, "");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!deploymentUrl) {
  fail("Usage: node scripts/configure-telegram-webhook.mjs https://YOUR-PROJECT.vercel.app");
} else {
  let webhookUrl;
  try {
    const parsedUrl = new URL(deploymentUrl);
    if (parsedUrl.protocol !== "https:") {
      throw new Error("Deployment URL must use HTTPS.");
    }
    webhookUrl = `${parsedUrl.origin}/api/telegram/webhook`;
  } catch (error) {
    fail(error instanceof Error ? error.message : "Deployment URL is invalid.");
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken || !webhookSecret || !webhookUrl) {
    if (!botToken || !webhookSecret) {
      fail("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured.");
    }
  } else {
    const callTelegram = async (method, payload) => {
      let response;
      try {
        response = await fetch(
          `https://api.telegram.org/bot${botToken}/${method}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
      } catch {
        throw new Error(`Telegram ${method} request failed.`);
      }

      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`Telegram ${method} returned invalid JSON.`);
      }

      if (!response.ok || !body?.ok) {
        throw new Error(`Telegram ${method} request was rejected.`);
      }

      return body.result;
    };

    try {
      await callTelegram("setWebhook", {
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
        drop_pending_updates: true,
      });

      const webhookInfo = await callTelegram("getWebhookInfo", {});
      if (
        webhookInfo?.url !== webhookUrl ||
        typeof webhookInfo?.last_error_message === "string" &&
          webhookInfo.last_error_message.length > 0
      ) {
        throw new Error("Telegram webhook verification failed.");
      }

      console.log(`Telegram webhook configured: ${webhookUrl}`);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Telegram webhook configuration failed.");
    }
  }
}
