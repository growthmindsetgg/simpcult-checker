import { checkin } from "@/lib/points/checkin";
import { maybeSnapshot } from "@/lib/points/snapshots";
import { closeDueDays } from "@/lib/points/pace";
import { background, assertSameOrigin, handle, ok, requireSession } from "@/lib/points/http";

export const dynamic = "force-dynamic";
// room for the after-response work (snapshot, closing yesterday's daily split)
export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireSession();
  background(() => maybeSnapshot());
  background(() => closeDueDays());
  const r = await checkin(s.address);
  return ok({
    balance: r.balance,
    amount: r.entry.amount,
    multiplier: r.multiplier,
    units: r.units,
    streak: r.streak,
    duplicate: r.duplicate,
  });
});
