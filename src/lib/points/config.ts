import type { Address } from "viem";

/**
 * SIMP Points — every tunable lives here.
 *
 * Safe to import from client components: no secrets, no `server-only`.
 * Server-only knobs (admin allowlist, cron secret) are read from env inside
 * `src/lib/points/server/*`.
 *
 * Supply model (confirmed 2026-11-24):
 *   1,000,000,000 points, fixed. Three pools:
 *     active  69%  — Simp Cult holders, earned through tasks
 *     holding 21%  — Simp Cult holders, passive, per NFT held
 *     monad   10%  — Monad card holders ("simp" posts)
 *   Seasons are 6 weeks. Each pool releases half of its allocation in S1,
 *   then halves every season forever: S1 = 500M, S2 = 250M, S3 = 125M …
 *   The sum converges to the cap and never exceeds it.
 */

export type PoolId = "active" | "holding" | "monad";
export const POOLS: PoolId[] = ["active", "holding", "monad"];

const DAY_MS = 86_400_000;

function toInt(v: string | undefined, fallback: number): number {
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const POINTS_CONFIG = {
  /** fixed total supply of SIMP Points */
  supply: 1_000_000_000,

  /** share of supply per pool, in basis points (must sum to 10_000) */
  poolBps: { active: 6_900, holding: 2_100, monad: 1_000 } as Record<PoolId, number>,

  season: {
    /**
     * Season 1 kickoff (UTC). Override with NEXT_PUBLIC_POINTS_SEASON1_START
     * (ISO string). Before this instant earning is closed and the portal
     * shows a countdown.
     */
    season1Start: process.env.NEXT_PUBLIC_POINTS_SEASON1_START ?? "2026-11-24T00:00:00Z",
    lengthDays: 42, // 6 weeks
    /**
     * Fraction of a pool's allocation released in season 1. Each later season
     * releases `decay` × the previous season. 0.5 / 0.5 = the confirmed
     * "half of what's left, every season" schedule.
     */
    firstSeasonShare: 0.5,
    decay: 0.5,
  },

  /**
   * Per-action rewards, quoted at season-1 value. When `scaleWithSeason` is
   * on, they shrink with the same decay as the pools (S2 = ½, S3 = ¼ …), so a
   * later season doesn't run dry in its first week. Never below `minReward`.
   */
  rewards: {
    scaleWithSeason: true,
    minReward: 1,
    checkin: {
      base: 1_000,
      /** +10% per consecutive day … */
      streakBonusPerDay: 0.1,
      /** … capped at +100% (a 2× check-in from day 11) */
      maxStreakBonus: 1.0,
    },
    /** X post about Simp Cult (holders → active pool) */
    xPost: { reward: 5_000, dailyCap: 3, maxAgeDays: 7 },
    /** X post using the word "simp" (Monad card holders → monad pool) */
    simpPost: { reward: 2_500, dailyCap: 3, maxAgeDays: 7 },
    /** alpha / contributions — admin picks the amount within [min, max] */
    alpha: { default: 25_000, min: 1_000, max: 250_000, dailyCap: 3 },
  },

  /**
   * Passive holding. Paid once per UTC day per tokenId to whoever holds it at
   * the snapshot. Rate per NFT per day is derived so the season's holding
   * budget is exactly spread across `nftSupply` × season days.
   */
  holding: {
    // literal env access so Next inlines it in client bundles too
    nftSupply: toInt(process.env.NEXT_PUBLIC_NFT_SUPPLY, 421),
  },

  /**
   * X post checks. We never call the paid X API. When `autoVerify` is on we
   * try X's free public oEmbed endpoint: if it confirms the author handle and
   * a keyword, the post is credited instantly; anything else goes to the
   * admin queue.
   */
  x: {
    autoVerify: true,
    oembedUrl: "https://publish.x.com/oembed",
    /** a Simp Cult post must contain one of these (case-insensitive) */
    simpCultKeywords: ["simp cult", "simpcult", "@monadsimpcult", "#simpcult"],
    /** a Monad card "simp" post must contain one of these */
    simpKeywords: ["simp"],
  },

  /**
   * Monad card (Q3 — still unconfirmed). While `address` is the zero address
   * the Monad card pool is switched off in the UI and API.
   * Override with NEXT_PUBLIC_MONAD_CARD_ADDRESS / _STANDARD / _TOKEN_ID.
   */
  monadCard: {
    address: (process.env.NEXT_PUBLIC_MONAD_CARD_ADDRESS ??
      "0x0000000000000000000000000000000000000000") as Address,
    standard: (process.env.NEXT_PUBLIC_MONAD_CARD_STANDARD ?? "erc721") as "erc721" | "erc1155",
    tokenId: BigInt(process.env.NEXT_PUBLIC_MONAD_CARD_TOKEN_ID ?? "0"),
  },

  /** most recent ledger entries kept per address */
  ledgerKeep: 500,
  /** rows shown on the season leaderboard */
  leaderboardSize: 100,
} as const;

export const MONAD_CARD_ENABLED =
  POINTS_CONFIG.monadCard.address.toLowerCase() !== "0x0000000000000000000000000000000000000000";

// ─────────────────────────── season maths ───────────────────────────

export const SEASON_MS = POINTS_CONFIG.season.lengthDays * DAY_MS;
export const SEASON1_START_MS = Date.parse(POINTS_CONFIG.season.season1Start);
// a typo here would make every season NaN and quietly switch earning off
if (!Number.isFinite(SEASON1_START_MS)) {
  throw new Error(
    `NEXT_PUBLIC_POINTS_SEASON1_START is not a valid date: "${POINTS_CONFIG.season.season1Start}" — use ISO 8601, e.g. 2026-11-24T00:00:00Z`,
  );
}

/** 0 = before season 1 starts; 1, 2, 3 … afterwards. */
export function seasonAt(ts: number = Date.now()): number {
  if (ts < SEASON1_START_MS) return 0;
  return Math.floor((ts - SEASON1_START_MS) / SEASON_MS) + 1;
}

export function seasonBounds(season: number): { start: number; end: number } {
  const s = Math.max(1, season);
  const start = SEASON1_START_MS + (s - 1) * SEASON_MS;
  return { start, end: start + SEASON_MS };
}

/** release multiplier for a season: S1 = firstSeasonShare, then × decay each season */
export function seasonFactor(season: number): number {
  if (season < 1) return 0;
  const { firstSeasonShare, decay } = POINTS_CONFIG.season;
  return firstSeasonShare * Math.pow(decay, season - 1);
}

export function poolAllocation(pool: PoolId): number {
  return Math.floor((POINTS_CONFIG.supply * POINTS_CONFIG.poolBps[pool]) / 10_000);
}

/** hard cap a pool may emit in a season */
export function poolBudget(pool: PoolId, season: number): number {
  return Math.floor(poolAllocation(pool) * seasonFactor(season));
}

export function seasonBudget(season: number): number {
  return POOLS.reduce((a, p) => a + poolBudget(p, season), 0);
}

/** per-action reward scaled for the season (S1 = face value) */
export function scaledReward(base: number, season: number): number {
  const r = POINTS_CONFIG.rewards;
  if (season < 1) return 0;
  const k = r.scaleWithSeason ? Math.pow(POINTS_CONFIG.season.decay, season - 1) : 1;
  return Math.max(r.minReward, Math.floor(base * k));
}

/** check-in reward for a streak of `streak` days (1 = first day) */
export function checkinReward(season: number, streak: number): number {
  const c = POINTS_CONFIG.rewards.checkin;
  const bonus = Math.min(c.maxStreakBonus, Math.max(0, streak - 1) * c.streakBonusPerDay);
  return scaledReward(Math.floor(c.base * (1 + bonus)), season);
}

/** holding points per NFT per UTC day in a season */
export function holdingRatePerNftPerDay(season: number): number {
  const days = POINTS_CONFIG.season.lengthDays;
  const n = Math.max(1, POINTS_CONFIG.holding.nftSupply);
  return Math.floor(poolBudget("holding", season) / (n * days));
}

/** UTC day key, e.g. "2026-11-24" */
export function utcDay(ts: number = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function previousUtcDay(day: string): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) - DAY_MS);
}

/** next UTC midnight after `ts` */
export function nextUtcMidnight(ts: number = Date.now()): number {
  return Date.parse(`${utcDay(ts)}T00:00:00Z`) + DAY_MS;
}
