import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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
 */

export const NONCE_COOKIE = "simp_nonce";
const NONCE_TTL_SEC = 300;
const COOKIE_RE = /^[0-9a-f]{64}$/;

type NonceRecord = { t: number; c: string };

const digest = (v: string) => createHash("sha256").update(v).digest();
const matches = (rec: NonceRecord | null, cookie: string) =>
  !!rec && typeof rec.c === "string" && rec.c.length === 64 && timingSafeEqual(Buffer.from(rec.c, "hex"), digest(cookie));

/** new single-use nonce (5 minute TTL), tied to this browser's nonce cookie */
export async function issueNonce(): Promise<string> {
  const c = await cookies();
  // always a fresh value: reusing one the browser sent would let anyone who can
  // plant a cookie choose the secret the nonce is bound to
  const cookie = randomBytes(32).toString("hex");
  const nonce = newNonce();
  await kv().set(`nonce:${nonce}`, { t: Date.now(), c: digest(cookie).toString("hex") } satisfies NonceRecord, NONCE_TTL_SEC);
  c.set(NONCE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: NONCE_TTL_SEC,
  });
  return nonce;
}

/**
 * Spend a nonce. True only for the browser it was issued to, and only once.
 * The cookie is compared BEFORE the nonce is deleted, so someone who merely
 * knows a nonce can't burn it for its owner.
 */
export async function consumeNonce(nonce: string): Promise<boolean> {
  const cookie = (await cookies()).get(NONCE_COOKIE)?.value;
  if (!cookie || !COOKIE_RE.test(cookie)) return false;
  const key = `nonce:${nonce}`;
  if (!matches(await kv().get<NonceRecord>(key), cookie)) return false;
  // atomic get-and-delete: of any concurrent requests, exactly one gets the record
  return matches(await kv().take<NonceRecord>(key), cookie);
}
