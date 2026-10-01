import { webhookCallback } from "grammy";
import { bot } from "@/lib/server/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Telegram → us. Register once (see README):
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://simpcult.xyz/api/telegram/webhook
 *     &secret_token=<TELEGRAM_WEBHOOK_SECRET>&allowed_updates=["message","chat_member"]
 * grammy verifies the X-Telegram-Bot-Api-Secret-Token header for us.
 */
export async function POST(req: Request) {
  const handler = webhookCallback(bot(), "std/http", {
    secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
    timeoutMilliseconds: 25_000,
  });
  return handler(req);
}

export async function GET() {
  return new Response("simp cult telegram webhook", { status: 200 });
}
