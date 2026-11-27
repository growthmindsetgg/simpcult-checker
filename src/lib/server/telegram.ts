import "server-only";
import { Bot } from "grammy";
import { getAddress, type Address } from "viem";
import { kv } from "./store";
import { nftBalance } from "./chain";
import { LINKS, SITE } from "@/lib/config";

/**
 * Telegram: an optional link from a wallet to a telegram account.
 *
 * Two levels
 *  - declared (default, needs no bot): a verified wallet says "@handle is my
 *    telegram" on /join. One wallet per handle, one handle per wallet,
 *    case-insensitive. This is what the 3x points bonus reads
 *    (`telegramLink` / `isTelegramBound`).
 *  - bot (only when the bot is configured): the optional handshake that also
 *    gates the holders' chat.
 *      1. a verified holder with a declared handle asks POST /api/telegram/verify,
 *         which issues a short code bound to address + handle (10 min).
 *      2. they open t.me/<bot>?start=<code> from that handle. the bot re-checks
 *         the NFT balance on-chain, links tgId <-> address (1:1) and replies with
 *         a single-use invite link that expires in 10 min.
 *      3. /api/cron/recheck runs hourly: wallets that sold get kicked and their
 *         bot link dropped. their declared handle stays, so the 3x stays.
 */

export const GROUP_ID = process.env.TELEGRAM_GROUP_ID ?? "";

let _bot: Bot | undefined;
export function bot(): Bot {
  if (_bot) return _bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const b = new Bot(token);
  registerHandlers(b);
  _bot = b;
  return b;
}

/** both bot vars present: the bot can run the handshake and the site can deep-link to it */
export function botConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.NEXT_PUBLIC_TELEGRAM_BOT;
}

const K = {
  code: (c: string) => `tg:code:${c}`,
  user: (id: number | string) => `tg:user:${id}`, // tgId → { address, username, linkedAt } (bot link)
  addr: (a: string) => `tg:addr:${a.toLowerCase()}`, // address → tgId (bot link)
  decl: (a: string) => `tg:decl:${a.toLowerCase()}`, // address → { handle, at } (declared link)
  handle: (h: string) => `tg:handle:${h.toLowerCase()}`, // handle → address (declared link, uniqueness)
};

export type Link = { address: Address; username?: string; linkedAt: number; tgId: number };

/** what the 3x bonus and the join page read */
export type TelegramLink = { handle: string; method: "declared" | "bot"; at: number };
type Declared = { handle: string; at: number };

/**
 * Telegram's public username rules: 5–32 characters, letters, digits and
 * underscores, starting with a letter and not ending with an underscore.
 * Matching is case-insensitive.
 */
const HANDLE_RE = /^[A-Za-z][A-Za-z0-9_]{3,30}[A-Za-z0-9]$/;
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw
    .trim()
    .replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "");
  return HANDLE_RE.test(h) ? h : null;
}

/**
 * The wallet's telegram link, or null. A declared handle counts as bound;
 * `method` is "bot" while the bot handshake is also live for this wallet.
 */
export async function telegramLink(address: string): Promise<TelegramLink | null> {
  const [decl, tgId] = await Promise.all([kv().get<Declared>(K.decl(address)), kv().get<number>(K.addr(address))]);
  if (tgId) {
    const bl = await kv().get<Link>(K.user(tgId));
    // "bot" only while the bot-verified username is still the declared handle;
    // after a change on the site the new handle is merely declared
    const same = !decl || (!!bl?.username && bl.username.toLowerCase() === decl.handle.toLowerCase());
    if (bl && bl.address.toLowerCase() === address.toLowerCase() && same) {
      const handle = decl?.handle ?? bl.username;
      if (handle) return { handle, method: "bot", at: decl?.at ?? bl.linkedAt };
    }
  }
  return decl ? { handle: decl.handle, method: "declared", at: decl.at } : null;
}

export async function isTelegramBound(address: string): Promise<boolean> {
  return (await telegramLink(address)) !== null;
}

/**
 * Declare (or change) the wallet's handle. The handle index is claimed with an
 * atomic set-if-absent, so two wallets racing for one handle can't both win.
 */
export async function declareHandle(
  address: Address,
  handle: string,
): Promise<{ ok: true; link: TelegramLink } | { ok: false; reason: "taken" }> {
  const addr = getAddress(address);
  const mine = (v: string | null) => !!v && v.toLowerCase() === addr.toLowerCase();
  const owner = await kv().get<string>(K.handle(handle));
  if (owner && !mine(owner)) return { ok: false, reason: "taken" };
  if (!owner && !(await kv().setnx(K.handle(handle), addr)) && !mine(await kv().get<string>(K.handle(handle)))) {
    return { ok: false, reason: "taken" };
  }
  const prev = await kv().get<Declared>(K.decl(addr));
  if (prev && prev.handle.toLowerCase() !== handle.toLowerCase()) {
    // changing handles: release the old one (only if it's still ours)
    if (mine(await kv().get<string>(K.handle(prev.handle)))) await kv().del(K.handle(prev.handle));
  }
  const at = prev && prev.handle === handle ? prev.at : Date.now();
  await kv().set(K.decl(addr), { handle, at } satisfies Declared);
  return { ok: true, link: (await telegramLink(addr)) ?? { handle, method: "declared", at } };
}

/** drop the wallet's telegram link: the declared handle and, if any, the bot link (and chat seat) */
export async function removeTelegram(address: Address): Promise<void> {
  const addr = getAddress(address);
  const prev = await kv().get<Declared>(K.decl(addr));
  if (prev) {
    const owner = await kv().get<string>(K.handle(prev.handle));
    if (owner?.toLowerCase() === addr.toLowerCase()) await kv().del(K.handle(prev.handle));
    await kv().del(K.decl(addr));
  }
  const tgId = await kv().get<number>(K.addr(addr));
  if (tgId) {
    await unlink(tgId, addr);
    if (GROUP_ID && process.env.TELEGRAM_BOT_TOKEN) await kick(tgId).catch(() => {});
  }
}

export async function issueCode(address: Address, username: string): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await kv().set(K.code(code), { address: getAddress(address), username }, 600);
  return code;
}

export async function linkedUsers(): Promise<Link[]> {
  const keys = await kv().keys("tg:user:");
  const out: Link[] = [];
  for (const k of keys) {
    const v = await kv().get<Link>(k);
    if (v) out.push(v);
  }
  return out;
}

export async function unlink(tgId: number, address: string) {
  await kv().del(K.user(tgId));
  await kv().del(K.addr(address));
}

export async function kick(tgId: number) {
  const b = bot();
  // ban + unban = "kick" (they can rejoin later with a fresh invite once they hold again)
  await b.api.banChatMember(GROUP_ID, tgId).catch(() => {});
  await b.api.unbanChatMember(GROUP_ID, tgId, { only_if_banned: true }).catch(() => {});
}

function registerHandlers(b: Bot) {
  b.command("start", async (ctx) => {
    // codes are only redeemed in a private chat with the bot, never in a group
    if (ctx.chat?.type !== "private") return;
    const code = ctx.match?.trim();
    const from = ctx.from;
    if (!from) return;

    if (!code) {
      await ctx.reply(
        `gm. this bot gates the holders-only simp cult group.\n\nverify your wallet at ${SITE.url}/join, add your telegram there, then tap "verify with the bot". you'll come back here with a one-time code.`,
      );
      return;
    }

    const c = await kv().take<{ address: Address; username?: string }>(K.code(code));
    if (!c) {
      await ctx.reply('that code is expired or already used. go back to the join page and tap "verify with the bot" again.');
      return;
    }
    const address = getAddress(c.address);

    // username match: the code was issued to a specific @handle on the site —
    // only that handle (case-insensitive) can redeem it.
    if (c.username) {
      const current = (from.username ?? "").toLowerCase();
      const expected = c.username.toLowerCase();
      if (!current || current !== expected) {
        await ctx.reply(
          `this code was bound to @${c.username} — verify again from the site with your current username.`,
        );
        return;
      }
    }

    // the handle declared on the site must still be this one (it may have changed since the code was issued)
    const decl = await kv().get<Declared>(K.decl(address));
    if (!decl || decl.handle.toLowerCase() !== (from.username ?? "").toLowerCase()) {
      await ctx.reply("the telegram handle on the site changed since this code was issued. get a new code from the join page.");
      return;
    }

    // live check — never trust anything cached
    const bal = await nftBalance(address).catch(() => 0);
    if (bal < 1) {
      await ctx.reply(`wallet ${address} holds no simp cult nft right now. grab one → ${LINKS.opensea}`);
      return;
    }

    // one address ⇄ one telegram account
    const existingTg = await kv().get<number>(K.addr(address));
    if (existingTg && existingTg !== from.id) {
      await ctx.reply("this wallet is already linked to another telegram account. unlink it there first (send /unlink) or use a different wallet.");
      return;
    }
    const existingLink = await kv().get<Link>(K.user(from.id));
    if (existingLink && existingLink.address.toLowerCase() !== address.toLowerCase()) {
      await kv().del(K.addr(existingLink.address)); // switching wallets — release the old one
    }

    const link: Link = { address, username: from.username, linkedAt: Date.now(), tgId: from.id };
    await kv().set(K.user(from.id), link);
    await kv().set(K.addr(address), from.id);

    if (!GROUP_ID) {
      await ctx.reply("linked ✓ — but TELEGRAM_GROUP_ID isn't configured yet. ping an admin.");
      return;
    }
    try {
      const invite = await b.api.createChatInviteLink(GROUP_ID, {
        name: `simp ${address.slice(0, 8)}`,
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 600,
      });
      await ctx.reply(
        `verified ✓  ${address.slice(0, 6)}…${address.slice(-4)} holds ${bal} simp.\n\nyour one-time invite (expires in 10 min, single use):\n${invite.invite_link}\n\nsell your simp and you'll be removed automatically. simp responsibly.`,
      );
    } catch (e) {
      console.error("[tg] createChatInviteLink failed", e);
      await ctx.reply("couldn't create an invite link — the bot probably isn't an admin of the group yet. ping an admin.");
    }
  });

  b.command("status", async (ctx) => {
    if (!ctx.from) return;
    const l = await kv().get<Link>(K.user(ctx.from.id));
    if (!l) return ctx.reply("not linked. verify at " + SITE.url + "/join");
    const bal = await nftBalance(l.address).catch(() => 0);
    return ctx.reply(`linked to ${l.address}\nholding ${bal} simp — ${bal > 0 ? "you're good" : "not a holder anymore; you'll be removed on the next check"}`);
  });

  b.command("unlink", async (ctx) => {
    if (!ctx.from) return;
    const l = await kv().get<Link>(K.user(ctx.from.id));
    if (!l) return ctx.reply("nothing to unlink.");
    await unlink(ctx.from.id, l.address);
    if (GROUP_ID) await kick(ctx.from.id);
    return ctx.reply("bot link removed and you're out of the group. your handle stays on the site for the 3x (remove it on the join page). verify again any time.");
  });

  // someone joined the group without going through the bot → remove unless linked & holding
  b.on("chat_member", async (ctx) => {
    const upd = ctx.chatMember;
    if (String(upd.chat.id) !== String(GROUP_ID)) return;
    const nowIn = ["member", "administrator", "creator"].includes(upd.new_chat_member.status);
    if (!nowIn || upd.new_chat_member.status !== "member") return;
    const uid = upd.new_chat_member.user.id;
    const l = await kv().get<Link>(K.user(uid));
    const bal = l ? await nftBalance(l.address).catch(() => 0) : 0;
    if (!l || bal < 1) {
      await kick(uid);
      if (l) await unlink(uid, l.address);
    }
  });
}
