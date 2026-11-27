import { getSession } from "@/lib/server/session";
import { nftBalance } from "@/lib/server/chain";
import { botConfigured, declareHandle, normalizeHandle, removeTelegram, telegramLink } from "@/lib/server/telegram";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSite, fail, guard, json, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * The verified wallet's telegram link (optional; it earns 3x points).
 *   GET    → { link: { handle, method, at } | null, bot, holder }
 *   POST   { handle } → declare or change the handle ("this is my telegram")
 *   DELETE → remove it (and the bot link / chat seat, if any)
 * `bot` says whether the optional "verify with the bot" upgrade is available.
 */
export const GET = guard(async () => {
  const s = await getSession();
  if (!s) return fail(401, "verify your wallet first");
  const [link, balance] = await Promise.all([telegramLink(s.address), nftBalance(s.address).catch(() => s.balance)]);
  return json({ link, bot: botConfigured(), holder: balance > 0 });
});

export const POST = guard(async (req: Request) => {
  if (crossSite(req)) return fail(403, "cross-site request refused");
  const s = await getSession();
  if (!s) return fail(401, "verify your wallet first");
  if (!(await rateLimit("tg-link", s.address.toLowerCase(), 10, 600)) || !(await rateLimit("tg-link-ip", clientIp(req), 30, 600))) {
    return tooMany("too many changes. wait a few minutes and try again.");
  }
  const body = (await req.json().catch(() => null)) as { handle?: unknown; username?: unknown } | null;
  const handle = normalizeHandle(body?.handle ?? body?.username);
  if (!handle) {
    return fail(400, "telegram usernames are 5–32 letters, digits or underscores, start with a letter and don’t end with _");
  }
  const r = await declareHandle(s.address, handle);
  if (!r.ok) return fail(409, `@${handle} is already linked to another wallet`);
  return json({ link: r.link, bot: botConfigured() });
});

export const DELETE = guard(async (req: Request) => {
  if (crossSite(req)) return fail(403, "cross-site request refused");
  const s = await getSession();
  if (!s) return fail(401, "verify your wallet first");
  if (!(await rateLimit("tg-link", s.address.toLowerCase(), 10, 600))) return tooMany("too many changes. wait a few minutes and try again.");
  await removeTelegram(s.address);
  return json({ link: null });
});
