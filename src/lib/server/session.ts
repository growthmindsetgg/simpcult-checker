import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Address } from "viem";

export const SESSION_COOKIE = "simp_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type Session = {
  address: Address;
  /** how the address was proven: signature (SIWE) or self-transaction */
  method: "siwe" | "tx";
  /** NFT balance at verification time (re-checked live where it matters) */
  balance: number;
  iat: number;
  exp: number;
};

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production")
      throw new Error("SESSION_SECRET must be set (>=32 chars) in production");
    return Buffer.from("dev-secret-dev-secret-dev-secret-dev-secret");
  }
  return Buffer.from(s);
}

const b64u = (b: Buffer) => b.toString("base64url");
const sign = (payload: string) => b64u(createHmac("sha256", secret()).update(payload).digest());

export function encodeSession(s: Omit<Session, "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000);
  const full: Session = { ...s, iat: now, exp: now + SESSION_TTL_SEC };
  const payload = b64u(Buffer.from(JSON.stringify(full)));
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token?: string | null): Session | null {
  if (!token) return null;
  if (token.length > 2048) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  let expect: string;
  try {
    expect = sign(payload);
  } catch {
    return null; // no SESSION_SECRET (e.g. a preview deploy): treat everyone as signed out
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    // the HMAC already vouches for the payload; this only refuses shapes no
    // version of encodeSession ever produced
    if (
      !s ||
      typeof s.address !== "string" ||
      !ADDRESS_RE.test(s.address) ||
      (s.method !== "siwe" && s.method !== "tx") ||
      typeof s.exp !== "number" ||
      s.exp < Math.floor(Date.now() / 1000)
    )
      return null;
    return s;
  } catch {
    return null;
  }
}

export async function setSessionCookie(s: Omit<Session, "iat" | "exp">) {
  const c = await cookies();
  c.set(SESSION_COOKIE, encodeSession(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  // same attributes as when it was set, so every browser matches and drops it
  c.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  return decodeSession(c.get(SESSION_COOKIE)?.value);
}

export const newNonce = () => randomBytes(16).toString("hex");
