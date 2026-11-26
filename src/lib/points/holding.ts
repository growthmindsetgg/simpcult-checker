import "server-only";
import { createHash } from "node:crypto";
import { holdingRatePerNftPerDay, seasonAt, utcDay } from "./config";
import { emit, PointsError } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { ownerMap } from "./chain";

/**
 * Passive holding accrual: once per UTC day, every Simp Cult tokenId pays
 * `holdingRatePerNftPerDay(season)` to whoever holds it at the snapshot.
 * Each tokenId pays at most once per day (a token sold and re-snapshotted the
 * same day can't pay twice). Safe to run many times a day.
 *
 * Trigger: Vercel cron → GET /api/admin/points/holding (Bearer CRON_SECRET),
 * or an admin presses "run holding" in /portal/admin.
 */

const SKIP = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

export type HoldingRun = {
  day: string;
  season: number;
  ratePerNft: number;
  owners: number;
  tokensPaid: number;
  pointsPaid: number;
  skippedAlreadyPaid: number;
  errors: string[];
};

export async function runHoldingAccrual(): Promise<HoldingRun> {
  const day = utcDay();
  const season = seasonAt();
  const rate = holdingRatePerNftPerDay(season);
  const run: HoldingRun = {
    day,
    season,
    ratePerNft: rate,
    owners: 0,
    tokensPaid: 0,
    pointsPaid: 0,
    skippedAlreadyPaid: 0,
    errors: [],
  };
  if (season < 1 || rate < 1) return run;

  const map = await ownerMap({ fresh: true });
  for (const [owner, tokens] of Object.entries(map)) {
    if (SKIP.has(owner)) continue;
    run.owners++;
    const fresh = await store().saddEach(K.holdingTokens(day), tokens.map(String), 60 * 60 * 72);
    const newTokens = tokens.filter((_, i) => fresh[i]);
    run.skippedAlreadyPaid += tokens.length - newTokens.length;
    if (newTokens.length === 0) continue;
    const digest = createHash("sha256").update(newTokens.join(",")).digest("hex").slice(0, 16);
    const amount = rate * newTokens.length;
    try {
      await emit("holding", owner, amount, "holding", `holding:${day}:${digest}`, {
        day,
        tokens: newTokens.length,
        ratePerNft: rate,
      });
      run.tokensPaid += newTokens.length;
      run.pointsPaid += amount;
    } catch (e) {
      run.errors.push(`${owner}: ${e instanceof PointsError ? e.code : (e as Error).message}`);
      if (e instanceof PointsError && e.code === "pool_exhausted") break;
      // a transient failure paid nothing: free these tokens so the next run pays them
      await store().sremEach(K.holdingTokens(day), newTokens.map(String)).catch(() => {});
    }
  }
  await store().set(K.holdingRun(day), run, { ex: 60 * 60 * 24 * 7 });
  return run;
}

export async function lastHoldingRun(): Promise<HoldingRun | null> {
  return store().get<HoldingRun>(K.holdingRun(utcDay()));
}
