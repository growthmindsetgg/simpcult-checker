import { getSession } from "@/lib/server/session";
import { nftBalance } from "@/lib/server/chain";
import { botConfigured, issueCode, telegramLink } from "@/lib/server/telegram";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";
import { crossSite, fail, guard, json, tooMany } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Optional upgrade from a declared handle to a bot-verified one, which is
 * also the holders' chat gate. Issues a 10-minute code bound to this wallet
 * and its declared handle; the bot redeems it (src/lib/server/telegram.ts).
 */
export const POST = guard(async (req: Request) => {
  if (crossSite(req)) return fail(403, "cross-site request refused");
  const s = await getSession();
  if (!s) return fail(401, "verify your wallet first");
  if (!botConfigured()) return fail(404, "bot verification isn’t available right now. your handle still counts for 3x.");
  if (!(await rateLimit("tg-code", s.address.toLowerCase(), 5, 600)) || !(await rateLimit("tg-code-ip", clientIp(req), 20, 600))) {
    return tooMany("too many codes. wait a few minutes and try again.");
  }
  const link = await telegramLink(s.address);
  if (!link) return fail(400, "add your telegram handle first");
  const balance = await nftBalance(s.address).catch(() => 0);
  if (balance < 1) return fail(403, "the holders’ chat needs a simp cult nft in this wallet. your handle still counts for 3x.");

  const code = await issueCode(s.address, link.handle);
  return json({ url: `https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT}?start=${code}`, expiresIn: 600, handle: link.handle });
});
