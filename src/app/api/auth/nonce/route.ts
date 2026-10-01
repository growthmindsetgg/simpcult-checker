import { NextResponse } from "next/server";
import { kv } from "@/lib/server/store";
import { newNonce } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Single-use nonce, 5 minute TTL. Consumed by /verify or /verify-tx. */
export async function GET() {
  const nonce = newNonce();
  await kv().set(`nonce:${nonce}`, { t: Date.now() }, 300);
  return NextResponse.json({ nonce }, { headers: { "cache-control": "no-store" } });
}
