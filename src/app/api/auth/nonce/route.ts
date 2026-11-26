import { NextResponse } from "next/server";
import { issueNonce } from "@/lib/server/nonce";
import { clientIp, rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

/**
 * Single-use nonce, 5 minute TTL. Consumed by /verify or /verify-tx — and only
 * by the browser that asked for it (see src/lib/server/nonce.ts).
 */
export async function GET(req: Request) {
  if (!(await rateLimit("nonce", clientIp(req), 30, 60))) {
    return NextResponse.json({ error: "too many requests — slow down" }, { status: 429, headers: { "retry-after": "60" } });
  }
  const nonce = await issueNonce();
  return NextResponse.json({ nonce }, { headers: { "cache-control": "no-store" } });
}
