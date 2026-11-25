import "server-only";
import { PointsError } from "@/lib/points";

/**
 * The game's single door to SIMP Points: a thin seam over the shared Points
 * API in `src/lib/points` (built by the Points Engine). Nothing else in
 * `src/games/slot` imports points code, so if the Points API ever moves or
 * needs wrapping (metrics, limits), this is the only file to touch.
 *
 * Contract the game relies on (see src/lib/points/index.ts):
 *   - `debit` is atomic and throws PointsError("insufficient_balance") without
 *     deducting anything when the balance is short.
 *   - `credit` / `debit` are idempotent per (address, direction, refId): a
 *     repeat with the same refId changes nothing and returns `duplicate: true`.
 *     The game uses ONE refId per spin (derived from that spin's single-use
 *     seed commitment) for both the bet and the win, so a retried or resumed
 *     spin can never double-debit or double-credit.
 *   - Both are house transfers: they never touch season pools or the
 *     leaderboard.
 */
export { getBalance, credit, debit, ledger, PointsError } from "@/lib/points";
export type { LedgerEntry, Receipt } from "@/lib/points";

export function isInsufficient(e: unknown): boolean {
  return e instanceof PointsError && e.code === "insufficient_balance";
}
