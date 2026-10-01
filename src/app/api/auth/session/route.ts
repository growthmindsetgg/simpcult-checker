import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/session";
import { nftBalance } from "@/lib/server/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ session: null }, { headers: { "cache-control": "no-store" } });
  // live balance so the UI never shows stale holder status
  const balance = await nftBalance(s.address).catch(() => s.balance);
  return NextResponse.json(
    { session: { address: s.address, method: s.method, balance, exp: s.exp } },
    { headers: { "cache-control": "no-store" } },
  );
}
