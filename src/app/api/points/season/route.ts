import { seasonAt } from "@/lib/points/config";
import { seasonOverview } from "@/lib/points/season";
import { handle, ok } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request) => {
  const q = Number(new URL(req.url).searchParams.get("season"));
  const o = await seasonOverview(Number.isSafeInteger(q) && q >= 1 ? q : seasonAt());
  // house (game) flow stays admin-only
  return ok({
    season: o.season,
    live: o.live,
    start: o.start,
    end: o.end,
    pools: o.pools,
    simps: o.simps,
    current: seasonAt(),
    now: Date.now(),
  });
});
