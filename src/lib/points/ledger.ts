import "server-only";
import { isAddress } from "viem";
import { BUCKET_POOL, POINTS_CONFIG, instantCap, seasonAt, type BucketId, type PoolId } from "./config";
import { store, type ApplyResult } from "./store";
import { K } from "./keys";

/**
 * The points ledger. Server-authoritative; nothing here is reachable from
 * client JS except through the API routes.
 *
 * Three kinds of balance change:
 *   - instant emissions (`emit`): new points from a bucket (pool / sub-pool).
 *     Capped by the bucket's instant budget (10% of its season budget) inside
 *     the same atomic script, and counted on the season leaderboard and the
 *     bucket's earned board (the pro-rata basis for the season-end share).
 *   - season-end payouts (`emitSeasonEnd`): the frozen 90% shares and the
 *     holding drop, capped by the bucket's end pot. They touch neither board:
 *     the frozen settlement already counts them.
 *   - transfers with the house (`credit` / `debit`): games and other spends.
 *     They never touch pool budgets or the leaderboard; they're tallied in the
 *     season stats (`house_out` / `house_in`) so net game flow stays visible.
 */

export type LedgerEntry = {
  /** `${direction}:${refId}` — unique per address */
  id: string;
  refId: string;
  address: string;
  /** signed: + credit, − debit */
  amount: number;
  reason: string;
  /** pool the points came from; null for house transfers */
  pool: PoolId | null;
  /** sub-pool (bucket) for emissions; absent on entries before rules v2 */
  bucket?: BucketId;
  season: number;
  ts: number;
  meta?: Record<string, unknown>;
};

export type Receipt = {
  /** balance after the operation (or current balance on a duplicate) */
  balance: number;
  entry: LedgerEntry;
  /** true when this refId was already applied — nothing changed */
  duplicate: boolean;
};

export type PointsErrorCode =
  | "insufficient_balance"
  | "pool_exhausted"
  | "season_closed"
  | "invalid_amount"
  | "invalid_address"
  | "invalid_ref"
  | "invalid_season"
  | "not_earned";

export class PointsError extends Error {
  constructor(
    public code: PointsErrorCode,
    message: string,
    public balance?: number,
  ) {
    super(message);
    this.name = "PointsError";
  }
}

export function normAddr(addr: string): string {
  if (typeof addr !== "string" || !isAddress(addr, { strict: false })) {
    throw new PointsError("invalid_address", `invalid address: ${String(addr)}`);
  }
  return addr.toLowerCase();
}

function checkAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new PointsError("invalid_amount", `amount must be a positive whole number, got ${amount}`);
  }
}

function checkRef(refId: string) {
  if (typeof refId !== "string" || refId.length === 0 || refId.length > 200) {
    throw new PointsError("invalid_ref", "refId must be a non-empty string (≤200 chars)");
  }
}

function checkReason(reason: string) {
  if (typeof reason !== "string" || reason.length === 0 || reason.length > 120) {
    throw new PointsError("invalid_ref", "reason must be a non-empty string (≤120 chars)");
  }
}

type ApplyOpts = {
  dir: "c" | "d" | "e";
  address: string;
  delta: number;
  reason: string;
  refId: string;
  bucket: BucketId | null;
  meta?: Record<string, unknown>;
  /** season whose pool / leaderboard / stats this touches (default: current) */
  season?: number;
  /** season-end payout: counted against the end pot, not on the boards */
  end?: { cap: number };
};

/**
 * House transfers (game bets and wins) are high-volume, and a spin can only be
 * retried for a day, so their idempotency keys expire. Emission and admin
 * refs stay forever: a replay there would mint points twice.
 */
const HOUSE_REF_TTL_SEC = 60 * 60 * 24 * 30;

async function apply(o: ApplyOpts): Promise<Receipt> {
  const season = o.season ?? seasonAt();
  const entry: LedgerEntry = {
    id: `${o.dir}:${o.refId}`,
    refId: o.refId,
    address: o.address,
    amount: o.delta,
    reason: o.reason,
    pool: o.bucket ? BUCKET_POOL[o.bucket] : null,
    ...(o.bucket ? { bucket: o.bucket } : {}),
    season,
    ts: Date.now(),
    ...(o.meta ? { meta: o.meta } : {}),
  };
  const isEmission = o.bucket !== null;
  const b = o.bucket!;
  const res: ApplyResult = await store().apply({
    balKey: K.bal(o.address),
    refKey: K.ref(o.dir, o.address, o.refId),
    ...(isEmission ? {} : { refTtl: HOUSE_REF_TTL_SEC }),
    ledgerKey: K.ledger(o.address),
    delta: o.delta,
    entry: JSON.stringify(entry),
    ...(isEmission && o.end
      ? { poolKey: K.poolEnd(season, b), poolCap: o.end.cap }
      : isEmission
        ? {
            poolKey: K.pool(season, b),
            // negative deltas skip the cap check but still return points to the bucket
            poolCap: instantCap(b, season),
            lbKey: K.lb(season),
            lbMember: o.address,
            lbBucketKey: K.lbBucket(season, b),
          }
        : {}),
    statsKey: K.stats(season),
    statsField: isEmission ? `${o.end ? "end" : "emit"}_${b}` : o.delta > 0 ? "house_out" : "house_in",
    keep: POINTS_CONFIG.ledgerKeep,
  });

  switch (res.status) {
    case "ok":
      return { balance: res.balance, entry, duplicate: false };
    case "duplicate":
      return { balance: res.balance, entry: JSON.parse(res.entry) as LedgerEntry, duplicate: true };
    case "insufficient":
      throw new PointsError(
        "insufficient_balance",
        `not enough points: have ${res.balance}, need ${-o.delta}`,
        res.balance,
      );
    case "not_earned":
      throw new PointsError(
        "not_earned",
        `can't take back ${-o.delta}: that's more than this wallet earned in season ${season}`,
        res.balance,
      );
    case "pool_exhausted":
      throw new PointsError(
        "pool_exhausted",
        o.end
          ? `the ${b} season-end pot for season ${season} is fully paid`
          : `this season's instant ${b === "card" || b === "amu" ? "community" : b} budget is used up — season-end shares still pay`,
        res.balance,
      );
  }
}

// ───────────────────────── shared API (stable) ─────────────────────────

/** current spendable balance (whole points) */
export async function getBalance(addr: string): Promise<number> {
  return store().num(K.bal(normAddr(addr)));
}

/**
 * Add points from the house (game wins, refunds…). Not pool-capped; never
 * counts toward the leaderboard. Idempotent per (address, refId): calling
 * again with the same refId returns the original receipt with
 * `duplicate: true` and changes nothing. Credits and debits have separate
 * refId namespaces, so one spin id can be used for both the bet and the win.
 */
export async function credit(addr: string, amount: number, reason: string, refId: string): Promise<Receipt> {
  const address = normAddr(addr);
  checkAmount(amount);
  checkReason(reason);
  checkRef(refId);
  return apply({ dir: "c", address, delta: amount, reason, refId, bucket: null });
}

/**
 * Remove points (bets, spends). Atomic: throws `PointsError` with code
 * `insufficient_balance` (and `.balance`) when the balance can't cover it —
 * nothing is deducted in that case. Idempotent per (address, refId).
 */
export async function debit(addr: string, amount: number, reason: string, refId: string): Promise<Receipt> {
  const address = normAddr(addr);
  checkAmount(amount);
  checkReason(reason);
  checkRef(refId);
  return apply({ dir: "d", address, delta: -amount, reason, refId, bucket: null });
}

/** most recent entries first */
export async function ledger(addr: string, limit = 50): Promise<LedgerEntry[]> {
  const n = Math.max(1, Math.min(POINTS_CONFIG.ledgerKeep, Math.floor(limit)));
  return store().lrange<LedgerEntry>(K.ledger(normAddr(addr)), 0, n - 1);
}

// ───────────────────────── internal: emissions ─────────────────────────

/**
 * Mint new points out of a bucket's instant budget for the current season.
 * The cap check and the credit happen in one atomic step. Throws
 * `season_closed` before season 1 and `pool_exhausted` when the bucket's
 * instant budget (10% of its season budget; 0 for holding) can't cover
 * `amount`. Activity payouts go through `payActivity` (activity.ts), which
 * applies the Telegram multiplier before calling this.
 */
export async function emit(
  bucket: BucketId,
  addr: string,
  amount: number,
  reason: string,
  refId: string,
  meta?: Record<string, unknown>,
): Promise<Receipt> {
  const address = normAddr(addr);
  checkAmount(amount);
  checkReason(reason);
  checkRef(refId);
  if (seasonAt() < 1) throw new PointsError("season_closed", "season 1 hasn't started yet");
  return apply({ dir: "e", address, delta: amount, reason, refId, bucket, meta });
}

/**
 * Instant emission booked to an explicit season (the daily-share close of a
 * day that may belong to a season that just ended). Same cap and boards as
 * `emit`.
 */
export async function emitInSeason(
  bucket: BucketId,
  addr: string,
  amount: number,
  season: number,
  reason: string,
  refId: string,
  meta?: Record<string, unknown>,
): Promise<Receipt> {
  const address = normAddr(addr);
  checkAmount(amount);
  checkReason(reason);
  checkRef(refId);
  if (!Number.isSafeInteger(season) || season < 1) throw new PointsError("invalid_season", "bad season");
  return apply({ dir: "e", address, delta: amount, reason, refId, bucket, meta, season });
}

/**
 * Credit a frozen season-end share / holding drop for `season` (a past
 * season). Capped atomically by `pot` on the bucket's end counter;
 * idempotent per (address, refId).
 */
export async function emitSeasonEnd(
  bucket: BucketId,
  addr: string,
  amount: number,
  season: number,
  pot: number,
  reason: string,
  refId: string,
  meta?: Record<string, unknown>,
): Promise<Receipt> {
  const address = normAddr(addr);
  checkAmount(amount);
  checkReason(reason);
  checkRef(refId);
  if (!Number.isSafeInteger(season) || season < 1) throw new PointsError("invalid_season", "bad season");
  return apply({ dir: "e", address, delta: amount, reason, refId, bucket, meta, season, end: { cap: pot } });
}

/**
 * Admin correction: take back emitted points (returns them to `season`'s pool
 * and leaderboard — pass the season the points were earned in; default is the
 * current one). Fails on insufficient balance like `debit`, and with
 * `not_earned` when the wallet earned less than `amount` in that season, so a
 * pool counter can never drop below what it really emitted.
 */
export async function revokeEmission(
  bucket: BucketId,
  addr: string,
  amount: number,
  reason: string,
  refId: string,
  meta?: Record<string, unknown>,
  season: number = seasonAt(),
): Promise<Receipt> {
  const address = normAddr(addr);
  checkAmount(amount);
  checkReason(reason);
  checkRef(refId);
  if (!Number.isSafeInteger(season) || season < 1 || season > seasonAt()) {
    throw new PointsError("invalid_season", `season must be a whole number between 1 and ${seasonAt()}`);
  }
  return apply({ dir: "e", address, delta: -amount, reason, refId, bucket, meta, season });
}
