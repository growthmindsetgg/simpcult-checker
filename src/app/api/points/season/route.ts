import { seasonAt } from "@/lib/points/config";
import { seasonOverview } from "@/lib/points/season";
import { maybeSnapshot } from "@/lib/points/snapshots";
import { closeDueDays } from "@/lib/points/pace";
import { background, handle, ok } from "@/lib/points/http";

export const dynamic = "force-dynamic";
// room for the after-response work (snapshot, closing yesterday's daily split)
export const maxDuration = 60;

export const GET = handle(async (req: Request) => {
  background(() => maybeSnapshot());
  background(() => closeDueDays());
  const q = Number(new URL(req.url).searchParams.get("season"));
  const o = await seasonOverview(Number.isSafeInteger(q) && q >= 1 ? q : seasonAt());
  // house (game) flow stays admin-only; snapshot times are never revealed, only how many were taken
  return ok({
    season: o.season,
    live: o.live,
    start: o.start,
    end: o.end,
    pools: o.pools,
    buckets: o.buckets,
    finalWindow: o.finalWindow,
    snapshots: o.snapshots,
    today: o.today,
    telegramMultiplier: o.telegramMultiplier,
    simps: o.simps,
    current: seasonAt(),
    now: Date.now(),
  });
});
