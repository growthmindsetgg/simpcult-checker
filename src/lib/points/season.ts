import "server-only";
import {
  BUCKETS,
  BUCKET_POOL,
  MONAD_CARD_ENABLED,
  SHARE_BUCKETS,
  POINTS_CONFIG,
  POOLS,
  bucketBudget,
  endPot,
  finalWindow,
  instantCap,
  poolBudget,
  seasonAt,
  seasonBounds,
  type BucketId,
  type PoolId,
} from "./config";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { snapshotCount } from "./snapshots";
import { todayPool, type TodayPool } from "./pace";

/** season overview, pool meters and leaderboard (season-earned points) */

/** `emitted` = instant payouts + season-end payouts credited so far */
export type PoolMeter = { pool: PoolId; budget: number; emitted: number };

export type BucketMeter = {
  bucket: BucketId;
  pool: PoolId;
  budget: number;
  /** 10% instant cap (0 for holding) and what it has paid */
  instantCap: number;
  instantPaid: number;
  /** the season-end pot (90%, or the whole holding budget) and what's been credited */
  endPot: number;
  endPaid: number;
  /** basis so far: bucket points (instant paid) or NFT-days for holding */
  basis: number;
  /** false while the card sub-pool waits for the card contract */
  open: boolean;
};

export async function seasonOverview(season = seasonAt()) {
  const s = Math.max(1, season);
  const { start, end } = seasonBounds(s);
  const [instant, endPaid, nftDays, stats, simps, snaps] = await Promise.all([
    Promise.all(BUCKETS.map((b) => store().num(K.pool(s, b)))),
    Promise.all(BUCKETS.map((b) => store().num(K.poolEnd(s, b)))),
    store().num(K.nftDaysTotal(s)),
    store().hgetall(K.stats(s)),
    store().zcard(K.lb(s)),
    snapshotCount(s),
  ]);
  const buckets: BucketMeter[] = BUCKETS.map((bucket, i) => ({
    bucket,
    pool: BUCKET_POOL[bucket],
    budget: bucketBudget(bucket, s),
    instantCap: instantCap(bucket, s),
    instantPaid: instant[i],
    endPot: endPot(bucket, s, instant[i]),
    endPaid: endPaid[i],
    basis: bucket === "holding" ? nftDays : instant[i],
    open: bucket !== "card" || MONAD_CARD_ENABLED,
  }));
  const pools: PoolMeter[] = POOLS.map((pool) => ({
    pool,
    budget: poolBudget(pool, s),
    emitted: buckets.filter((b) => b.pool === pool).reduce((a, b) => a + b.instantPaid + b.endPaid, 0),
  }));
  const w = finalWindow(s);
  const now = Date.now();
  const today: TodayPool[] = season >= 1 && s === seasonAt() ? await Promise.all(SHARE_BUCKETS.map((b) => todayPool(b))) : [];
  return {
    season: s,
    /** this season is the one running right now */
    live: season >= 1 && s === seasonAt(),
    start,
    end,
    pools,
    buckets,
    finalWindow: { start: w.start, end: w.end, open: now >= w.start && now < w.end },
    snapshots: snaps,
    /** today's daily-split pool per share sub-pool (current season only) */
    today,
    telegramMultiplier: POINTS_CONFIG.telegramMultiplier,
    house: { out: stats.house_out ?? 0, in: -(stats.house_in ?? 0) },
    simps,
  };
}

export type LeaderRow = { rank: number; address: string; points: number };

export async function leaderboard(season = seasonAt(), size: number = POINTS_CONFIG.leaderboardSize): Promise<LeaderRow[]> {
  const s = Math.max(1, season);
  const rows = await store().zrevrange(K.lb(s), 0, size - 1);
  return rows.filter((r) => r.score > 0).map((r, i) => ({ rank: i + 1, address: r.member, points: r.score }));
}

export async function myRank(addr: string, season = seasonAt()): Promise<{ rank: number | null; points: number }> {
  const s = Math.max(1, season);
  const a = normAddr(addr);
  const [rank, score] = await Promise.all([store().zrevrank(K.lb(s), a), store().zscore(K.lb(s), a)]);
  return { rank: score && score > 0 && rank !== null ? rank + 1 : null, points: score ?? 0 };
}

/** every address with season-earned points > 0 */
export async function seasonEarners(season: number): Promise<{ address: string; points: number }[]> {
  const rows = await store().zrevrange(K.lb(season), 0, -1);
  return rows.filter((r) => r.score > 0).map((r) => ({ address: r.member, points: r.score }));
}

export type Projection = {
  /** points earned per share bucket this season (the pro-rata basis) */
  earned: Partial<Record<BucketId, number>>;
  /** estimated season-end payout per bucket if the season ended now */
  share: Partial<Record<BucketId, number>>;
  total: number;
  /**
   * "posters": split against the wallets that have posted so far (plus this
   * one); "if_all_post": nobody has posted yet, so this is the floor — the
   * share if every earner posts. Fewer posters means more.
   */
  basis: "posters" | "if_all_post";
  posters: number;
  /**
   * Unspent daily (10%) budget joins the season pot at close. While the
   * season runs it isn't known yet, so it's left out (false) and the real
   * share will be higher by that much; after the season ends it's included.
   */
  includesUnspentDaily: boolean;
};

/**
 * Estimate of a wallet's season-end payouts at current totals, assuming it
 * posts in the final 48h (and, for holding, keeps clearing the snapshots).
 * Share buckets split among posters only, so the estimate uses the posters
 * so far; before anyone posts it's the floor (everyone posts). Others still
 * earning will dilute it.
 */
export async function projection(addr: string, season = seasonAt()): Promise<Projection> {
  const s = Math.max(1, season);
  const a = normAddr(addr);
  const earned: Projection["earned"] = {};
  const share: Projection["share"] = {};
  const posters = (await store().smembers(K.seasonPosters(s))).filter((p) => p !== a);
  const ended = Date.now() >= seasonBounds(s).end;
  await Promise.all(
    BUCKETS.map(async (b) => {
      const [mine, instant] = await Promise.all([
        store().zscore(b === "holding" ? K.nftDays(s) : K.lbBucket(s, b), a),
        store().num(K.pool(s, b)),
      ]);
      if (!mine || mine <= 0) return;
      let basis: number;
      if (b === "holding") basis = await store().num(K.nftDaysTotal(s));
      else if (posters.length > 0) {
        const theirs = await Promise.all(posters.map((p) => store().zscore(K.lbBucket(s, b), p)));
        basis = mine + theirs.reduce((x: number, v) => x + Math.max(0, v ?? 0), 0);
      } else basis = instant;
      if (basis <= 0) return;
      earned[b] = mine;
      const pot = endPot(b, s, instant) + (ended && b !== "holding" ? Math.max(0, instantCap(b, s) - instant) : 0);
      share[b] = Number((BigInt(pot) * BigInt(Math.floor(mine))) / BigInt(Math.floor(basis)));
    }),
  );
  return {
    earned,
    share,
    total: Object.values(share).reduce((x, v) => x + (v ?? 0), 0),
    basis: posters.length > 0 ? "posters" : "if_all_post",
    posters: posters.length,
    includesUnspentDaily: ended,
  };
}
