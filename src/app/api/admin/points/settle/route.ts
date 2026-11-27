import { freezeSeason, getSettlement, payoutProgress, payoutSeason } from "@/lib/points/settlement";
import { assertSameOrigin, handle, HttpError, ok, readJson, requireAdmin } from "@/lib/points/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?season=N → frozen snapshot (root, rows for settleBatch, season-end drops, burn) + payout progress */
export const GET = handle(async (req: Request) => {
  await requireAdmin();
  const season = Number(new URL(req.url).searchParams.get("season"));
  if (!Number.isSafeInteger(season) || season < 1) throw new HttpError(400, "bad season");
  return ok({ settlement: await getSettlement(season), payout: await payoutProgress(season) });
});

/**
 * { season, force? } → close the season: freeze it once (season-end shares,
 * holding drop, burn, merkle root), then credit the frozen payouts to
 * balances in a time-boxed chunk. Call again until `payout.done`.
 */
export const POST = handle(async (req: Request) => {
  assertSameOrigin(req);
  const s = await requireAdmin();
  const b = await readJson<{ season?: number; force?: boolean }>(req);
  const settlement = await freezeSeason(Number(b.season), s.address.toLowerCase(), { force: b.force === true });
  const payout = await payoutSeason(settlement.season, { budgetMs: 40_000 });
  return ok({ settlement, payout });
});
