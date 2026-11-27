import "server-only";
import { seasonAt, utcDay } from "./config";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { SKIP_OWNERS, ownerMap } from "./chain";
import { maybeSnapshot, type SnapshotRecord } from "./snapshots";
import { closeDueDays } from "./pace";

/**
 * Holding pool, rules v2: no daily payouts. Once per UTC day every Simp Cult
 * tokenId adds one NFT-day to whoever holds it at the accrual (a token sold
 * and re-counted the same day can't count twice). The whole holding budget
 * pays once at season end, pro-rata by NFT-days (see settlement.ts), to
 * wallets with ≥1 Monad transaction that were never missing at a snapshot.
 * Safe to run many times a day.
 *
 * Trigger: Vercel cron → GET /api/admin/points/holding (Bearer CRON_SECRET),
 * or an admin presses "count holding" in /portal/admin. Each run also takes
 * any random snapshot that's due (the cron is the backstop for those).
 */

export type HoldingRun = {
  day: string;
  season: number;
  owners: number;
  /** NFT-days added by this run */
  tokensCounted: number;
  skippedAlreadyCounted: number;
  snapshotsTaken: number;
  /** daily-split days closed by this run */
  daysClosed: number;
  errors: string[];
};

export async function runHoldingAccrual(): Promise<HoldingRun> {
  const day = utcDay();
  const season = seasonAt();
  const run: HoldingRun = {
    day,
    season,
    owners: 0,
    tokensCounted: 0,
    skippedAlreadyCounted: 0,
    snapshotsTaken: 0,
    daysClosed: 0,
    errors: [],
  };
  if (season < 1) return run;

  const map = await ownerMap({ fresh: true });
  for (const [owner, tokens] of Object.entries(map)) {
    if (SKIP_OWNERS.has(owner)) continue;
    run.owners++;
    const fresh = await store().saddEach(K.holdingTokens(day), tokens.map(String), 60 * 60 * 72);
    const newTokens = tokens.filter((_, i) => fresh[i]);
    run.skippedAlreadyCounted += tokens.length - newTokens.length;
    if (newTokens.length === 0) continue;
    try {
      await store().zincrby(K.nftDays(season), newTokens.length, owner);
      await store().incrby(K.nftDaysTotal(season), newTokens.length);
      run.tokensCounted += newTokens.length;
    } catch (e) {
      run.errors.push(`${owner}: ${(e as Error).message}`);
      // nothing was counted: free these tokens so the next run counts them
      await store().sremEach(K.holdingTokens(day), newTokens.map(String)).catch(() => {});
    }
  }
  try {
    const snaps: SnapshotRecord[] = await maybeSnapshot({ force: true });
    run.snapshotsTaken = snaps.length;
  } catch (e) {
    run.errors.push(`snapshot: ${(e as Error).message}`);
  }
  try {
    run.daysClosed = (await closeDueDays({ deadline: Date.now() + 30_000 })).closed;
  } catch (e) {
    run.errors.push(`day close: ${(e as Error).message}`);
  }
  await store().set(K.holdingRun(day), run, { ex: 60 * 60 * 24 * 7 });
  return run;
}

export async function lastHoldingRun(): Promise<HoldingRun | null> {
  return store().get<HoldingRun>(K.holdingRun(utcDay()));
}

/** a wallet's holding standing this season */
export async function holdingStatus(addr: string, season = seasonAt()) {
  const a = normAddr(addr);
  const s = Math.max(1, season);
  const [mine, total, out] = await Promise.all([
    store().zscore(K.nftDays(s), a),
    store().num(K.nftDaysTotal(s)),
    store().sismember(K.holdOut(s), a),
  ]);
  return { nftDays: mine ?? 0, totalNftDays: total, missedSnapshot: out };
}
