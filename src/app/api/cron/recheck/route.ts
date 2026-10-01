import { NextResponse } from "next/server";
import { linkedUsers, kick, unlink, GROUP_ID, bot } from "@/lib/server/telegram";
import { nftBalance } from "@/lib/server/chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hourly (vercel.json). Re-checks every linked wallet; non-holders are removed.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await linkedUsers();
  const removed: string[] = [];
  const errors: string[] = [];

  for (const u of users) {
    try {
      const bal = await nftBalance(u.address);
      if (bal < 1) {
        if (GROUP_ID) await kick(u.tgId);
        await unlink(u.tgId, u.address);
        removed.push(u.address);
        await bot()
          .api.sendMessage(u.tgId, `your wallet ${u.address.slice(0, 6)}…${u.address.slice(-4)} no longer holds a simp cult nft, so you've been removed from the holders group. verify again when you're back.`)
          .catch(() => {});
      }
    } catch (e) {
      errors.push(`${u.address}: ${(e as Error).message}`); // RPC hiccup → keep them, retry next hour
    }
  }

  return NextResponse.json({ checked: users.length, removed, errors, at: new Date().toISOString() });
}
