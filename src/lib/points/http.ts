import "server-only";
import { NextResponse } from "next/server";
import { getSession, type Session } from "@/lib/server/session";
import { PointsError } from "./ledger";

/** route-handler helpers shared by /api/points/* and /api/admin/* */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function fail(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
  }
  if (e instanceof PointsError) {
    const status =
      e.code === "insufficient_balance" || e.code === "pool_exhausted" || e.code === "season_closed" || e.code === "not_earned"
        ? 409
        : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status, headers: NO_STORE });
  }
  console.error("[points]", e);
  return NextResponse.json({ error: "something broke on our side — try again" }, { status: 500, headers: NO_STORE });
}

/** wraps a handler so thrown HttpError / PointsError become JSON responses */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return fail(e);
    }
  };
}

/**
 * Same-origin check for state-changing requests. The session cookie is
 * SameSite=Lax already; this also rejects cross-site POSTs that carry it.
 */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (curl, cron) send none
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (host && new URL(origin).host === host) return;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(403, "cross-site request refused");
}

export async function readJson<T>(req: Request): Promise<T> {
  const body = (await req.json().catch(() => null)) as T | null;
  if (!body || typeof body !== "object") throw new HttpError(400, "bad request");
  return body;
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, "connect and verify your wallet first", "no_session");
  return s;
}

function adminList(): Set<string> {
  return new Set(
    (process.env.POINTS_ADMINS ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdmin(addr?: string | null): boolean {
  return !!addr && adminList().has(addr.toLowerCase());
}

/**
 * Admin routes only accept a signature (SIWE) session. A self-transaction
 * session proves less — its nonce is public calldata — so it never unlocks
 * admin powers.
 */
export function isAdminSession(s: Session | null): boolean {
  return !!s && s.method === "siwe" && isAdmin(s.address);
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!isAdmin(s.address)) throw new HttpError(403, "admins only", "not_admin");
  if (s.method !== "siwe") {
    throw new HttpError(403, "admin needs a signature sign-in — sign out and verify by signing", "siwe_required");
  }
  return s;
}

/** Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. No secret set = nobody is cron. */
export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
