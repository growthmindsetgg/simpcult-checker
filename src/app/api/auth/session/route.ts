import { getSession } from "@/lib/server/session";
import { nftBalance } from "@/lib/server/chain";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (!s) return json({ session: null });
  // live balance so the UI never shows stale holder status
  const balance = await nftBalance(s.address).catch(() => s.balance);
  return json({ session: { address: s.address, method: s.method, balance, exp: s.exp } });
}
