import { webhookCallback } from "grammy";
import { bot } from "@/lib/server/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Telegram → us. Register once (see README):
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<site>/api/telegram/webhook
 *     &secret_token=<TELEGRAM_WEBHOOK_SECRET>&allowed_updates=["message","chat_member"]
 * grammy verifies the X-Telegram-Bot-Api-Secret-Token header for us — but only
 * when a secret is configured, so without one we refuse every update.
 */
export async function POST(req: Request) {
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secretToken) return new Response("unauthorized", { status: 401 });
  if (!process.env.TELEGRAM_BOT_TOKEN) return new Response("bot not configured", { status: 503 });
  const handler = webhookCallback(bot(), "std/http", {
    secretToken,
    timeoutMilliseconds: 25_000,
  });
  return handler(req);
}

export async function GET() {
  return new Response("simp cult telegram webhook", { status: 200 });
}
