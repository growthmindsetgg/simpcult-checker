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
/**
 * Production with no Upstash credentials throws an error with
 * `code: "storage-unconfigured"` from any of the calls above. Answer it with
 * a 503 (`{ code: "storage-unconfigured" }`) so the UI can show its
 * "warming up" state instead of a crash.
 */
export { isStorageUnconfigured } from "./store";
