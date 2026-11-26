import "server-only";
import { randomBytes } from "node:crypto";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { HttpError } from "./http";
import { HANDLE_RE, fetchOEmbed, normHandle, parseStatusUrl } from "./x";
import { monadCardBalance, nftBalance } from "./chain";
import { rateLimit } from "@/lib/server/ratelimit";

/**
 * One X handle ⇄ one wallet.
 *
 * 1. claim: the wallet names its handle and gets a short code.
 * 2. verify: it posts the code from that handle and pastes the link. X's free
 *    oEmbed confirms author + code → the handle is verified and reserved.
 *
 * Unverified handles still work for submissions, but every post then goes to
 * admin review; only verified handles get instant credit. A handle that one
 * wallet has verified can't be used by any other wallet.
 *
 * Verifying reserves a handle for good, so it is for holders only and
 * rate-limited per wallet.
 */

export type XHandle = { handle: string; verified: boolean; code: string; at: number };

export async function getHandle(addr: string): Promise<XHandle | null> {
  return store().get<XHandle>(K.xHandle(normAddr(addr)));
}

export async function claimHandle(addr: string, raw: string): Promise<XHandle> {
  const a = normAddr(addr);
  const handle = normHandle(raw ?? "");
  if (!HANDLE_RE.test(handle)) throw new HttpError(400, "that doesn't look like an X handle", "bad_handle");

  const owner = await store().get<string>(K.xOwner(handle));
  if (owner && owner !== a) throw new HttpError(409, `@${handle} is already bound to another wallet`, "handle_taken");

  const cur = await getHandle(a);
  if (cur && cur.handle.toLowerCase() === handle.toLowerCase()) return cur;
  if (cur?.verified) await store().del(K.xOwner(cur.handle)); // switching handles releases the old one

  const next: XHandle = {
    handle,
    verified: false,
    code: `simp-${randomBytes(3).toString("hex")}`,
    at: Date.now(),
  };
  await store().set(K.xHandle(a), next);
  return next;
}

export async function verifyHandle(addr: string, url: string): Promise<XHandle> {
  const a = normAddr(addr);
  const cur = await getHandle(a);
  if (!cur) throw new HttpError(400, "add your X handle first", "no_handle");
  if (cur.verified) return cur;

  const parsed = parseStatusUrl(url ?? "");
  if (!parsed) throw new HttpError(400, "paste the link to your post (x.com/you/status/…)", "bad_url");

  const [nfts, cards] = await Promise.all([
    nftBalance(a as `0x${string}`).catch(() => 0),
    monadCardBalance(a).catch(() => 0),
  ]);
  if (nfts < 1 && cards < 1) throw new HttpError(403, "verifying a handle is for holders", "not_holder");
  if (!(await rateLimit("xverify", a, 5, 600))) {
    throw new HttpError(429, "too many tries — wait a few minutes and try again", "rate_limited");
  }

  const o = await fetchOEmbed(parsed.canonical);
  if (!o) throw new HttpError(503, "couldn't read that post from X right now — try again in a minute", "x_unavailable");
  if (o.authorHandle.toLowerCase() !== cur.handle.toLowerCase()) {
    throw new HttpError(400, `that post is by @${o.authorHandle}, not @${cur.handle}`, "wrong_author");
  }
  if (!o.text.toLowerCase().includes(cur.code.toLowerCase())) {
    throw new HttpError(400, `couldn't find ${cur.code} in that post`, "code_missing");
  }

  const reserved = await store().set(K.xOwner(cur.handle), a, { nx: true });
  if (!reserved && (await store().get<string>(K.xOwner(cur.handle))) !== a) {
    throw new HttpError(409, `@${cur.handle} is already bound to another wallet`, "handle_taken");
  }
  const next: XHandle = { ...cur, verified: true, at: Date.now() };
  await store().set(K.xHandle(a), next);
  return next;
}
