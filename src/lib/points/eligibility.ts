import "server-only";
import { getAddress } from "viem";
import { publicClient } from "@/lib/server/chain";
import { MONAD_CARD_ENABLED, POINTS_CONFIG, seasonAt, type BucketId } from "./config";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { HttpError } from "./http";
import { monadCardBalance, tokensOf } from "./chain";

/**
 * Who can earn this season (rules v2):
 *   holder        — holds a Simp Cult NFT → active pool
 *   card          — holds a Monad card (while MONAD_CARD_ENABLED) → community 9%
 *   active_monad  — no NFT, no card, 50+ transactions on Monad → community 1%
 *   none          — out of the season: no earning, no share
 * A wallet can be a holder and a card holder at once; its category is the
 * first that applies, but card holders who also hold an NFT can still earn
 * in the card sub-pool with community ("simp") posts.
 *
 * A holder that was missing at one of this season's random snapshots moves
 * to the community category for the rest of the season, even if it holds
 * again: card → 9%, 50+ txs → 1%, otherwise out of the season.
 */

export type Category = "holder" | "card" | "active_monad" | "none";

export const CATEGORY_LABEL: Record<Category, string> = {
  holder: "simp cult holder",
  card: "monad card holder",
  active_monad: "active monad user",
  none: "not in this season",
};

const TX_NEG_TTL_SEC = 600;

/**
 * Monad transaction count (the account nonce). It only ever goes up, so a
 * count that already clears the active-user bar is cached for good; lower
 * counts are cached 10 minutes. Throws HttpError 503 when the chain can't
 * be read, so an RPC hiccup is never reported as "not eligible".
 */
export async function txCount(addr: string): Promise<number> {
  const a = normAddr(addr);
  const cached = await store().get<number | string>(K.txCount(a));
  if (cached !== null && cached !== undefined && Number.isFinite(Number(cached))) return Number(cached);
  let n: number;
  try {
    n = await publicClient.getTransactionCount({ address: getAddress(a) });
  } catch {
    throw new HttpError(503, "couldn't read monad right now — try again in a minute", "chain_unavailable");
  }
  const forGood = n >= POINTS_CONFIG.tx.activeUser;
  await store().set(K.txCount(a), String(n), forGood ? undefined : { ex: TX_NEG_TTL_SEC });
  return n;
}

export type WalletProfile = {
  address: string;
  tokens: number[];
  /** missed a snapshot this season: not a holder for earning until next season */
  missedSnapshot: boolean;
  card: boolean;
  /** null when it wasn't needed (holders / card holders on the earning path) */
  txCount: number | null;
  category: Category;
};

/**
 * Category for a wallet. `withTx` forces the tx count read even when the
 * category doesn't need it (the portal shows it; the holding drop needs ≥1).
 */
export async function walletProfile(addr: string, opts: { withTx?: boolean } = {}): Promise<WalletProfile> {
  const a = normAddr(addr);
  const season = seasonAt();
  const [tokens, cards, missedSnapshot] = await Promise.all([
    tokensOf(a),
    MONAD_CARD_ENABLED ? monadCardBalance(a).catch(() => 0) : Promise.resolve(0),
    season >= 1 ? store().sismember(K.holdOut(season), a) : Promise.resolve(false),
  ]);
  const card = cards > 0;
  const holder = tokens.length > 0 && !missedSnapshot;
  const needTx = opts.withTx || (!holder && !card);
  const tx = needTx ? await txCount(a) : null;
  const category: Category = holder
    ? "holder"
    : card
      ? "card"
      : (tx ?? 0) >= POINTS_CONFIG.tx.activeUser
        ? "active_monad"
        : "none";
  return { address: a, tokens, missedSnapshot, card, txCount: tx, category };
}

export function notEligible(p?: WalletProfile): HttpError {
  if (p?.missedSnapshot) {
    return new HttpError(
      403,
      `this wallet missed a holding snapshot, so it sits out the rest of the season. it can still earn with a monad card or ${POINTS_CONFIG.tx.activeUser}+ monad transactions.`,
      "not_eligible",
    );
  }
  return new HttpError(
    403,
    `this wallet isn't in the season yet. hold a simp cult nft${MONAD_CARD_ENABLED ? ", a monad card," : ""} or make ${POINTS_CONFIG.tx.activeUser}+ transactions on monad to join in.`,
    "not_eligible",
  );
}

/** the community bucket a non-holder earns into; null = out of the season */
export function communityBucket(p: WalletProfile): BucketId | null {
  if (p.card) return "card";
  if (p.category === "active_monad") return "amu";
  return null;
}

/** the bucket check-ins and alpha pay from for this wallet */
export function activityBucket(p: WalletProfile): BucketId | null {
  if (p.category === "holder") return "active";
  return communityBucket(p);
}
