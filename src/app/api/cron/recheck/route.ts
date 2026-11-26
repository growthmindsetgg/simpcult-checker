import { NextResponse } from "next/server";
import { linkedUsers, kick, unlink, GROUP_ID, bot } from "@/lib/server/telegram";
import { nftBalance } from "@/lib/server/chain";
import { isCron } from "@/lib/points/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hourly (vercel.json). Re-checks every linked wallet; non-holders are removed.
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically. Fails
 * closed: without CRON_SECRET set, nobody can run it. The response carries
 * counts only; addresses and error details go to the server log.
 */
export async function GET(req: Request) {
  if (!isCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const users = await linkedUsers();
  let removed = 0;
  let errors = 0;

  for (const u of users) {
    try {
      const bal = await nftBalance(u.address);
      if (bal < 1) {
        if (GROUP_ID) await kick(u.tgId);
        await unlink(u.tgId, u.address);
        removed++;
        await bot()
          .api.sendMessage(u.tgId, `your wallet ${u.address.slice(0, 6)}…${u.address.slice(-4)} no longer holds a simp cult nft, so you've been removed from the holders group. verify again when you're back.`)
          .catch(() => {});
      }
    } catch (e) {
      errors++; // RPC hiccup → keep them, retry next hour
      console.error("[cron/recheck]", u.address, (e as Error).message);
    }
  }

  return NextResponse.json({ checked: users.length, removed, errors, at: new Date().toISOString() });
}
