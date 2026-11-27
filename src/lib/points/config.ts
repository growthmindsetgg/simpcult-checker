import type { Address } from "viem";

/**
 * SIMP Points — every tunable lives here.
 *
 * Safe to import from client components: no secrets, no `server-only`.
 * Server-only knobs (admin allowlist, cron secret) are read from env inside
 * `src/lib/points/server/*`.
 *
 * Supply model (confirmed 2026-11-24, rules v2 2026-11-27 — see
 * research/POINTS-RULES-v2.md):
 *   1,000,000,000 points, fixed. Three pools:
 *     active    69%  — Simp Cult holders, earned through activities
 *     holding   21%  — Simp Cult holders, one season-end drop by NFT-days
 *     community 10%  — 9% Monad card holders + 1% active Monad users
 *   Seasons are 6 weeks. Each pool releases half of its allocation in S1,
 *   then halves every season forever: S1 = 500M, S2 = 250M, S3 = 125M …
 *   The sum converges to the cap and never exceeds it.
 *
 * Active and community pools follow the 10/90 rule: 10% of the season
 * budget pays instantly for activities, 90% is shared at season end
 * pro-rata by points earned in that pool, only to wallets that posted in
 * the final 48 hours. Shares of wallets that didn't post are burnt.
 *
 * Pool id vs. name: the community pool keeps the stable id `"monad"` (it is
 * also the Redis key segment and the home page keys its copy by it). Show it
 * as "community" everywhere; use `COMMUNITY` in code.
 */

export type PoolId = "active" | "holding" | "monad";
export const POOLS: PoolId[] = ["active", "holding", "monad"];
/** the community pool's stable id (displayed as "community") */
export const COMMUNITY: PoolId = "monad";

/**
 * Ledger buckets: every emission hits exactly one. The community pool is
 * split into its two sub-pools so each gets its own caps and season-end
 * share. Bucket ids are also Redis key segments.
 *   card — Monad card holders (90% of the community pool = 9% overall)
 *   amu  — active Monad users (10% of it = 1% overall)
 */
export type BucketId = "active" | "holding" | "card" | "amu";
export const BUCKETS: BucketId[] = ["active", "holding", "card", "amu"];
/** buckets that pay activities instantly (10%) + a season-end share (90%) */
export const SHARE_BUCKETS: BucketId[] = ["active", "card", "amu"];
export const BUCKET_POOL: Record<BucketId, PoolId> = {
  active: "active",
  holding: "holding",
  card: "monad",
  amu: "monad",
};

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
    /** X post using the word "simp" (card holders / active Monad users → community pool) */
    simpPost: { reward: 2_500, dailyCap: 3, maxAgeDays: 7 },
    /** alpha / contributions — admin picks the amount within [min, max] */
    alpha: { default: 25_000, min: 1_000, max: 250_000, dailyCap: 3 },
  },

  /** the 10/90 rule (basis points of a bucket's season budget) */
  split: {
    instantBps: 1_000,
    /** card holders' cut of the community pool; the rest is active Monad users */
    cardBpsOfCommunity: 9_000,
    /** the final-window X post that unlocks the 90% share */
    finalWindowHours: 48,
  },

  /** Telegram-bound wallets: every activity payout × this */
  telegramMultiplier: 3,

  /** transactions on Monad (`getTransactionCount`) a wallet needs */
  tx: {
    /** non-holders without a card: "active Monad users" */
    activeUser: 50,
    /** holders: to receive the season-end holding drop */
    holdingDrop: 1,
  },

  /**
   * Holding: NFT-days are counted once per UTC day per tokenId (to whoever
   * holds it at the daily accrual) and the whole holding budget pays out
   * once at season end, pro-rata by NFT-days. `snapshots` random checks a
   * season: a counted wallet holding nothing at one loses the drop.
   */
  holding: {
    // literal env access so Next inlines it in client bundles too
    nftSupply: toInt(process.env.NEXT_PUBLIC_NFT_SUPPLY, 421),
    snapshots: 5,
  },

  /** one-time welcome bonus, flat (never season-scaled, never 3x) */
  welcome: {
    holder: 1_000,
    /** how long the wallet must have held a Simp Cult NFT */
    holdMinutes: 69,
    /** Monad card holders and active Monad users */
    community: 100,
    /** welcome payouts may use at most this share of a sub-pool's season instant budget; the rest wait for next season */
    maxShareOfInstant: 0.2,
  },

  /**
   * Auto-pace (the daily split). Each share sub-pool (active, card, amu) gets
   * a daily allowance = remaining instant budget ÷ remaining season days,
   * fixed at the day's first touch. During the day every activity pays a
   * small instant amount (`rate` points per weight unit; weight = the reward
   * table's base × Telegram 3x), and at UTC day close the rest of the
   * allowance is shared pro-rata by weight units among that day's
   * participants — fewer participants, bigger share each.
   *   rate = instantFraction × allowance ÷ expected units, ≤ 1 (never above
   *          the reward table). Expected units = yesterday's units in this
   *          season (day 1: `priorUnits`), never below `minUnits`, both
   *          quoted at season-1 value and halved each season.
   *   Once instant payouts reach instantFraction of the allowance, actions
   *   pay 1 point instantly; their weight still counts for the close.
   */
  pace: {
    instantFraction: 0.25,
    /** no wallet's day total (instant + day share) may exceed this share of the day's allowance; the excess rolls forward */
    walletCapShare: 0.05,
    priorUnits: { active: 5_000_000, card: 700_000, amu: 700_000 } as Record<string, number>,
    minUnits: { active: 60_000, card: 35_000, amu: 35_000 } as Record<string, number>,
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
    /** a community "simp" post must contain one of these */
    simpKeywords: ["simp"],
    /** the final-48h post must also mention the season */
    seasonKeywords: ["season"],
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

/** a bucket's share of its pool's season budget */
export function bucketBudget(bucket: BucketId, season: number): number {
  if (bucket === "active" || bucket === "holding") return poolBudget(bucket, season);
  const community = poolBudget(COMMUNITY, season);
  const card = Math.floor((community * POINTS_CONFIG.split.cardBpsOfCommunity) / 10_000);
  return bucket === "card" ? card : community - card;
}

/** hard cap on a bucket's instant (activity) payouts in a season: 10%, holding 0 */
export function instantCap(bucket: BucketId, season: number): number {
  if (bucket === "holding") return 0;
  return Math.floor((bucketBudget(bucket, season) * POINTS_CONFIG.split.instantBps) / 10_000);
}

/**
 * The season-end pot: whatever of the budget the instant side may not use.
 * 90% for the share buckets, 100% for holding. `instantEmitted` lowers it
 * only when instant payouts went past the cap (legacy daily holding payouts
 * made before rules v2), so the season total can never exceed the budget.
 */
export function endPot(bucket: BucketId, season: number, instantEmitted = 0): number {
  const b = bucketBudget(bucket, season);
  return Math.max(0, b - Math.max(instantCap(bucket, season), instantEmitted));
}

/** the final-48h window in which the "upcoming season" post must be submitted */
export function finalWindow(season: number): { start: number; end: number } {
  const { end } = seasonBounds(season);
  return { start: end - POINTS_CONFIG.split.finalWindowHours * 3_600_000, end };
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
