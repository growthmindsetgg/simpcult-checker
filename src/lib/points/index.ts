import "server-only";

/**
 * SIMP Points — shared server API (games and everything else call only these).
 *
 *   getBalance(addr)                         → number
 *   credit(addr, amount, reason, refId)      → Receipt   (house → user, idempotent)
 *   debit(addr, amount, reason, refId)       → Receipt   (atomic; throws PointsError "insufficient_balance")
 *   ledger(addr, limit = 50)                 → LedgerEntry[] (newest first)
 *
 * Amounts are positive whole numbers. Addresses are case-insensitive.
 * refIds are scoped per address and per direction (credit vs debit).
 * Client-safe config + season maths: import from "@/lib/points/config".
 */
export { getBalance, credit, debit, ledger, PointsError } from "./ledger";
export type { LedgerEntry, Receipt, PointsErrorCode } from "./ledger";
