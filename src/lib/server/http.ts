import "server-only";
import { NextResponse } from "next/server";
import { StorageUnconfiguredError } from "./store";

/** JSON response that is never cached */
export function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

export const fail = (status: number, error: string, headers?: Record<string, string>) => json({ error }, status, headers);

export const tooMany = (msg = "too many tries. wait a minute and try again.") => fail(429, msg, { "retry-after": "60" });

/**
 * Defence in depth on cookie-authenticated writes: refuse a request whose
 * Origin header names another site. SameSite=Lax already keeps our cookies off
 * cross-site POSTs; this also covers a browser or proxy that gets that wrong.
 * Requests with no Origin (curl, server-to-server) carry no browser cookies by
 * accident, so they pass through to the normal checks.
 */
export function crossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true;
  }
}

/** wraps a handler so a missing store or a thrown RPC call is a clean JSON error, not a crash page */
export function guard<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof StorageUnconfiguredError) return fail(503, "sign-in is offline for a moment. try again soon.");
      console.error("[auth]", (e as Error)?.message ?? e);
      return fail(502, "something went wrong on our side. try again.");
    }
  };
}
