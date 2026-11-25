/** Wire types shared by the slot API routes and the client. */
import type { SymbolId } from "./config";
import type { LineWin } from "./engine";

export type RecentSpin = {
  spinId: string;
  at: number;
  bet: number;
  totalWin: number;
  stops: number[];
  clientSeed: string;
  serverSeed: string;
  serverSeedHash: string;
};

export type SlotState = {
  address: string;
  balance: number;
  /** sha256 of the server seed your next spin will use (null for a moment while a spin is in flight) */
  serverSeedHash: string | null;
  recent: RecentSpin[];
};

export type SpinResponse = {
  spinId: string;
  bet: number;
  stops: number[];
  grid: SymbolId[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  totalWin: number;
  /** revealed now; sha256(serverSeed) === serverSeedHash */
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  /** commitment for your next spin (null if it couldn't be stored; fetch state to get one) */
  nextServerSeedHash: string | null;
  /** null if the balance couldn't be read back; fetch state to refresh */
  balance: number | null;
  /** true if the win could not be credited yet (it is logged for reconciliation) */
  creditPending?: boolean;
  /** true when this is the stored result of a spin you already made (a retried request) */
  replayed?: boolean;
};

export type SlotErrorCode =
  | "unauthorized"
  | "bad-request"
  | "rate-limited"
  | "stale-commit"
  | "insufficient"
  | "busy"
  | "server";

export type SlotError = { error: string; code: SlotErrorCode; serverSeedHash?: string | null; retryAfterMs?: number };
