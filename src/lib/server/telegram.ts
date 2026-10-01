import "server-only";
import { Bot } from "grammy";
import { getAddress, type Address } from "viem";
import { kv } from "./store";
import { nftBalance } from "./chain";
import { LINKS, SITE } from "@/lib/config";

/**
 * Telegram holder gate.
 *
 * Flow
 *  1. verified holder clicks "join telegram" on /verify → POST /api/telegram/link
 *     issues a short code bound to their address (10 min).
 *  2. they open t.me/<bot>?start=<code>. the bot resolves code → address,
 *     re-checks NFT balance on-chain, links tgId ⇄ address (1:1) and replies
 *     with a single-use invite link that expires in 10 min.
 *  3. /api/cron/recheck runs hourly: every linked address is re-checked;
 *     wallets that sold get kicked and unlinked.
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

const K = {
  code: (c: string) => `tg:code:${c}`,
  user: (id: number | string) => `tg:user:${id}`, // tgId → { address, username, linkedAt }
  addr: (a: string) => `tg:addr:${a.toLowerCase()}`, // address → tgId
};

export type Link = { address: Address; username?: string; linkedAt: number; tgId: number };

export async function issueCode(address: Address): Promise<string> {
  const code = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  await kv().set(K.code(code), { address: getAddress(address) }, 600);
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
    const code = ctx.match?.trim();
    const from = ctx.from;
    if (!from) return;

    if (!code) {
      await ctx.reply(
        `gm. this bot gates the holders-only simp cult group.\n\nverify your wallet at ${SITE.url}/verify and tap "join telegram" — you'll come back here with a one-time code.`,
      );
      return;
    }

    const c = await kv().take<{ address: Address }>(K.code(code));
    if (!c) {
      await ctx.reply("that code is expired or already used. go back to the site and tap join again.");
      return;
    }
    const address = getAddress(c.address);

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
    const l = await kv().get<Link>(K.user(ctx.from!.id));
    if (!l) return ctx.reply("not linked. verify at " + SITE.url + "/verify");
    const bal = await nftBalance(l.address).catch(() => 0);
    return ctx.reply(`linked to ${l.address}\nholding ${bal} simp — ${bal > 0 ? "you're good" : "not a holder anymore; you'll be removed on the next check"}`);
  });

  b.command("unlink", async (ctx) => {
    const l = await kv().get<Link>(K.user(ctx.from!.id));
    if (!l) return ctx.reply("nothing to unlink.");
    await unlink(ctx.from!.id, l.address);
    if (GROUP_ID) await kick(ctx.from!.id);
    return ctx.reply("unlinked and removed from the group. verify again any time.");
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
