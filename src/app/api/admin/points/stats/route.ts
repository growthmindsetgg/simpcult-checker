import { holdingRatePerNftPerDay, seasonAt, seasonBudget } from "@/lib/points/config";
import { seasonOverview } from "@/lib/points/season";
import { lastHoldingRun } from "@/lib/points/holding";
import { store } from "@/lib/points/store";
import { handle, ok, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  const season = Math.max(1, seasonAt());
  return ok({
    overview: await seasonOverview(season),
    seasonBudget: seasonBudget(season),
    holdingRatePerNftPerDay: holdingRatePerNftPerDay(season),
    lastHoldingRun: await lastHoldingRun(),
    persistent: store().persistent,
  });
});
