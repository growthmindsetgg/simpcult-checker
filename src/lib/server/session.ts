import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Address } from "viem";

export const SESSION_COOKIE = "simp_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days

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
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expect = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (s.exp < Math.floor(Date.now() / 1000)) return null;
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
  c.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

export async function getSession(): Promise<Session | null> {
  const c = await cookies();
  return decodeSession(c.get(SESSION_COOKIE)?.value);
}

export const newNonce = () => randomBytes(16).toString("hex");
