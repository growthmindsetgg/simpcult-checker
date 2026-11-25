import "server-only";
import { POINTS_CONFIG, POOLS, poolBudget, seasonAt, seasonBounds, type PoolId } from "./config";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";

/** season overview, pool meters and leaderboard (season-earned points) */

export type PoolMeter = { pool: PoolId; budget: number; emitted: number };

export async function seasonOverview(season = seasonAt()) {
  const s = Math.max(1, season);
  const { start, end } = seasonBounds(s);
  const emitted = await Promise.all(POOLS.map((p) => store().num(K.pool(s, p))));
  const pools: PoolMeter[] = POOLS.map((pool, i) => ({ pool, budget: poolBudget(pool, s), emitted: emitted[i] }));
  const stats = await store().hgetall(K.stats(s));
  return {
    season: s,
    live: season >= 1,
    start,
    end,
    pools,
    house: { out: stats.house_out ?? 0, in: -(stats.house_in ?? 0) },
    simps: await store().zcard(K.lb(s)),
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

/** every address with season-earned points > 0 (for settlement) */
export async function seasonEarners(season: number): Promise<{ address: string; points: number }[]> {
  const rows = await store().zrevrange(K.lb(season), 0, -1);
  return rows.filter((r) => r.score > 0).map((r) => ({ address: r.member, points: r.score }));
}
