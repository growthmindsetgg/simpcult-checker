import "server-only";
import { POINTS_CONFIG, SEASON1_START_MS, instantCap, seasonAt, type BucketId } from "./config";
import { emit, normAddr, PointsError, type LedgerEntry } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { ownedAtAge } from "./chain";
import type { WalletProfile } from "./eligibility";

/**
 * One-time welcome bonus, granted lazily (the portal's /api/points/me call
 * after sign-in) and idempotent on refId `welcome:<address>` — one refId for
 * every path, so a wallet can never get both amounts. Flat, never
 * season-scaled, never multiplied by the Telegram bonus.
 *
 *   holders     — 1,000 from the active pool's instant budget, once the
 *                 wallet has held a Simp Cult NFT for 69+ minutes. Proof,
 *                 whichever comes first:
 *                   1. on-chain: it owned the token at a block ≥69 min old
 *                      and still owns it (historical ownerOf; proves "then
 *                      and now", not every block in between — Monad's RPC
 *                      won't scan Transfer logs that far);
 *                   2. first seen: we recorded the token in this wallet 69+
 *                      minutes ago and it's still there.
 *                 Each tokenId can bring one welcome ever (permanent lock),
 *                 so one NFT passed around can't farm it. A holder never gets
 *                 the 100 path, even while its 1,000 is pending.
 *   card holders / active Monad users — 100 from their community sub-pool's
 *                 instant budget, right away.
 *   An empty instant budget leaves it pending (retried on the next visit).
 *   Welcome payouts may use at most 20% (`maxShareOfInstant`) of a sub-pool's
 *   season instant budget, so a flood of new wallets can't starve the daily
 *   allowances; past that they wait (pending, "budget") for next season's
 *   budget. The check is a soft pre-check; the atomic instant cap still holds.
 */

export type WelcomeStatus =
  | { status: "granted"; amount: number; at: number }
  | { status: "pending"; amount: number; eta: number | null; reason: "holding_time" | "budget" | "season_closed" }
  | { status: "not_eligible"; reason: "not_in_season" | "tokens_used" };

const refFor = (a: string) => `welcome:${a}`;
const CHAIN_CHECK_COOLDOWN_SEC = 300;

export async function welcomeStatus(profile: WalletProfile): Promise<WelcomeStatus> {
  const a = normAddr(profile.address);
  const prev = await store().get<LedgerEntry>(K.ref("e", a, refFor(a)));
  if (prev) return { status: "granted", amount: prev.amount, at: prev.ts };

  const w = POINTS_CONFIG.welcome;
  if (profile.category === "none") return { status: "not_eligible", reason: "not_in_season" };
  const holder = profile.category === "holder";
  const amount = holder ? w.holder : w.community;
  if (seasonAt() < 1) return { status: "pending", amount, eta: SEASON1_START_MS, reason: "season_closed" };

  if (!holder) {
    const bucket: BucketId = profile.card ? "card" : "amu";
    return pay(bucket, a, amount, { path: profile.card ? "card" : "active_monad" });
  }

  const holdMs = w.holdMinutes * 60_000;
  const now = Date.now();
  const used = new Set(await store().smembers(K.welcomeTokens()));
  const candidates = profile.tokens.filter((t) => !used.has(String(t)));
  if (candidates.length === 0) return { status: "not_eligible", reason: "tokens_used" };

  // first-seen times, for tokens still in the wallet
  const seen = (await store().get<Record<string, number>>(K.welcomeSeen(a))) ?? {};
  const next: Record<string, number> = {};
  for (const t of candidates) next[t] = seen[t] ?? now;
  if (JSON.stringify(next) !== JSON.stringify(seen)) await store().set(K.welcomeSeen(a), next, { ex: 60 * 60 * 24 * 30 });

  let proven = candidates.filter((t) => now - next[t] >= holdMs);
  if (proven.length === 0 && (await store().set(K.welcomeCheck(a), "1", { nx: true, ex: CHAIN_CHECK_COOLDOWN_SEC }))) {
    proven = await ownedAtAge(a, candidates, holdMs).catch(() => []);
  }
  if (proven.length === 0) {
    const eta = Math.min(...candidates.map((t) => next[t])) + holdMs;
    return { status: "pending", amount, eta, reason: "holding_time" };
  }

  // lock one proven token for good; it can never welcome another wallet
  let token: number | null = null;
  for (const t of proven) {
    const [fresh] = await store().saddEach(K.welcomeTokens(), [String(t)]);
    if (fresh) {
      token = t;
      break;
    }
  }
  if (token === null) return { status: "not_eligible", reason: "tokens_used" };
  const r = await pay("active", a, amount, { path: "holder", token });
  if (r.status !== "granted") await store().sremEach(K.welcomeTokens(), [String(token)]).catch(() => {});
  return r;
}

async function pay(bucket: BucketId, a: string, amount: number, meta: Record<string, unknown>): Promise<WelcomeStatus> {
  const season = seasonAt();
  const paidKey = K.welcomePaid(season, bucket);
  if ((await store().num(paidKey)) + amount > instantCap(bucket, season) * POINTS_CONFIG.welcome.maxShareOfInstant) {
    return { status: "pending", amount, eta: null, reason: "budget" };
  }
  try {
    const r = await emit(bucket, a, amount, "welcome", refFor(a), meta);
    if (!r.duplicate) await store().incrby(paidKey, amount);
    return { status: "granted", amount: r.entry.amount, at: r.entry.ts };
  } catch (e) {
    if (e instanceof PointsError && (e.code === "pool_exhausted" || e.code === "season_closed")) {
      return { status: "pending", amount, eta: null, reason: e.code === "pool_exhausted" ? "budget" : "season_closed" };
    }
    throw e;
  }
}
