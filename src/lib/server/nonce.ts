import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, type Address } from "viem";
import { kv } from "./store";
import { newNonce } from "./session";

/**
 * Sign-in nonces, bound to the browser that asked for them.
 *
 * A nonce on its own proves nothing about who presents it: in the
 * self-transaction flow it sits in public calldata, so anyone watching the
 * chain could replay `{hash, nonce}`. Issuing a nonce therefore also sets a
 * random httpOnly cookie, and the nonce is stored with that cookie's hash.
 * Only a request carrying the same cookie can spend the nonce, and spending
 * is an atomic get-and-delete, so at most one request ever succeeds.
 *
 * One live nonce per browser: issuing a new one replaces the cookie, which
 * orphans any nonce issued before it.
 */

export const NONCE_COOKIE = "simp_nonce";
/** a signature happens in seconds */
export const SIWE_NONCE_TTL_SEC = 300;
/**
 * a self-transaction is typed into another wallet app, sent, mined and pasted
 * back, so it gets longer. verify-tx still refuses transactions older than 30 min.
 */
export const TX_NONCE_TTL_SEC = 900;
const COOKIE_RE = /^[0-9a-f]{64}$/;
export const NONCE_RE = /^[0-9a-f]{32}$/;

export type NonceRecord = {
  /** issued at (ms) */
  t: number;
  /** sha256(cookie), hex */
  c: string;
  /** checksummed address the nonce was issued for (send-and-set only) */
  a?: Address;
};

const digest = (v: string) => createHash("sha256").update(v).digest();
const matches = (rec: NonceRecord | null, cookie: string) =>
  !!rec && typeof rec.c === "string" && rec.c.length === 64 && timingSafeEqual(Buffer.from(rec.c, "hex"), digest(cookie));

/**
 * New single-use nonce tied to this browser's nonce cookie. With an address
 * it is a self-transaction nonce (15 min) that only verifies a transaction
 * sent from that address; without one it is a SIWE nonce (5 min).
 */
export async function issueNonce(address?: Address): Promise<{ nonce: string; expiresAt: number }> {
  const c = await cookies();
  const ttl = address ? TX_NONCE_TTL_SEC : SIWE_NONCE_TTL_SEC;
  // always a fresh value: reusing one the browser sent would let anyone who can
  // plant a cookie choose the secret the nonce is bound to
  const cookie = randomBytes(32).toString("hex");
  const nonce = newNonce();
  const t = Date.now();
  const rec: NonceRecord = { t, c: digest(cookie).toString("hex"), ...(address ? { a: getAddress(address) } : {}) };
  await kv().set(`nonce:${nonce}`, rec, ttl);
  c.set(NONCE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: ttl,
  });
  return { nonce, expiresAt: t + ttl * 1000 };
}

async function nonceCookie(): Promise<string | null> {
  const cookie = (await cookies()).get(NONCE_COOKIE)?.value;
  return cookie && COOKIE_RE.test(cookie) ? cookie : null;
}

/**
 * Look at a nonce without spending it. Returns the record only for the
 * browser it was issued to. Used to run slow chain checks first, so a hash
 * pasted a few seconds early doesn't burn a nonce that's already on chain.
 */
export async function peekNonce(nonce: string): Promise<NonceRecord | null> {
  if (!NONCE_RE.test(nonce)) return null;
  const cookie = await nonceCookie();
  if (!cookie) return null;
  const rec = await kv().get<NonceRecord>(`nonce:${nonce}`);
  return matches(rec, cookie) ? rec : null;
}

/**
 * Spend a nonce. True only for the browser it was issued to, and only once.
 * The cookie is compared BEFORE the nonce is deleted, so someone who merely
 * knows a nonce can't burn it for its owner.
 */
export async function consumeNonce(nonce: string): Promise<boolean> {
  if (!NONCE_RE.test(nonce)) return false;
  const cookie = await nonceCookie();
  if (!cookie) return false;
  const key = `nonce:${nonce}`;
  if (!matches(await kv().get<NonceRecord>(key), cookie)) return false;
  // atomic get-and-delete: of any concurrent requests, exactly one gets the record
  return matches(await kv().take<NonceRecord>(key), cookie);
}
