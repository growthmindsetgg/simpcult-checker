import "server-only";
import { isAddress } from "viem";
import { POINTS_CONFIG, poolBudget, seasonAt, type PoolId } from "./config";
import { store, type ApplyResult } from "./store";
import { K } from "./keys";

/**
 * The points ledger. Server-authoritative; nothing here is reachable from
 * client JS except through the API routes.
 *
 * Two kinds of balance change:
 *   - emissions (`emit`): new points from a pool. Capped by the pool's season
 *     budget inside the same atomic script, and counted on the season
 *     leaderboard (season-earned points = what settles onchain).
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
  | "invalid_ref";

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
  pool: PoolId | null;
  meta?: Record<string, unknown>;
};

async function apply(o: ApplyOpts): Promise<Receipt> {
  const season = seasonAt();
  const entry: LedgerEntry = {
    id: `${o.dir}:${o.refId}`,
    refId: o.refId,
    address: o.address,
    amount: o.delta,
    reason: o.reason,
    pool: o.pool,
    season,
    ts: Date.now(),
    ...(o.meta ? { meta: o.meta } : {}),
  };
  const isEmission = o.pool !== null;
  const res: ApplyResult = await store().apply({
    balKey: K.bal(o.address),
    refKey: K.ref(o.dir, o.address, o.refId),
    ledgerKey: K.ledger(o.address),
    delta: o.delta,
    entry: JSON.stringify(entry),
    ...(isEmission
      ? {
          poolKey: K.pool(season, o.pool!),
          // negative deltas skip the cap check but still return points to the pool
          poolCap: poolBudget(o.pool!, season),
          lbKey: K.lb(season),
          lbMember: o.address,
        }
      : {}),
    statsKey: K.stats(season),
    statsField: isEmission ? `emit_${o.pool}` : o.delta > 0 ? "house_out" : "house_in",
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
    case "pool_exhausted":
      throw new PointsError(
        "pool_exhausted",
        `the ${o.pool} pool is tapped out for season ${season}`,
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
  return apply({ dir: "c", address, delta: amount, reason, refId, pool: null });
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
  return apply({ dir: "d", address, delta: -amount, reason, refId, pool: null });
}

/** most recent entries first */
export async function ledger(addr: string, limit = 50): Promise<LedgerEntry[]> {
  const n = Math.max(1, Math.min(POINTS_CONFIG.ledgerKeep, Math.floor(limit)));
  return store().lrange<LedgerEntry>(K.ledger(normAddr(addr)), 0, n - 1);
}

// ───────────────────────── internal: emissions ─────────────────────────

/**
 * Mint new points out of a pool for the current season. The budget check and
 * the credit happen in one atomic step. Throws `season_closed` before season 1
 * and `pool_exhausted` when the season's pool budget can't cover `amount`.
 */
export async function emit(
  pool: PoolId,
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
  return apply({ dir: "e", address, delta: amount, reason, refId, pool, meta });
}

/**
 * Admin correction: take back emitted points (returns them to the season's
 * pool and the leaderboard). Fails on insufficient balance like `debit`.
 */
export async function revokeEmission(
  pool: PoolId,
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
  return apply({ dir: "e", address, delta: -amount, reason, refId, pool, meta });
}
