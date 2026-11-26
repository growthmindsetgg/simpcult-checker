import "server-only";
import { kv } from "./store";

/**
 * Fixed-window rate limit on the shared KV. The counter is one atomic
 * INCR + EXPIRE (`kv().incr`), so concurrent requests can't slip past it and
 * every key cleans itself up.
 *
 * Returns true when the request is within `max` per `windowSec`.
 */
export async function rateLimit(scope: string, id: string, max: number, windowSec: number): Promise<boolean> {
  const window = Math.floor(Date.now() / (windowSec * 1000));
  const n = await kv().incr(`rl:${scope}:${id}:${window}`, windowSec + 5);
  return n <= max;
}

/** caller's IP as set by the platform proxy (Vercel overwrites these headers) */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}
