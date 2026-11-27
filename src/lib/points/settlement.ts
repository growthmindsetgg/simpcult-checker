import "server-only";
import { getAddress, type Hex } from "viem";
import {
  POINTS_CONFIG,
  SHARE_BUCKETS,
  endPot,
  instantCap,
  seasonAt,
  seasonBounds,
  seasonBudget,
  type BucketId,
} from "./config";
import { emitSeasonEnd, normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { HttpError } from "./http";
import { MerkleTree, leafHash } from "./merkle";
import { pendingSeasonPosts } from "./submissions";
import { txCount } from "./eligibility";
import { snapshotCount } from "./snapshots";
import { closeSeasonDays, seasonOwed } from "./pace";

/**
 * Season close → SimpPoints (soulbound XP, one ERC-1155 id per season).
 *
 * 0. Every day of the season is closed first (daily shares credited), so
 *    the basis is final.
 * 1. Freeze (once, NX): reads the whole basis and computes the season-end
 *    payouts from it, then fixes the merkle root.
 *    - Active / card / amu buckets (owner rule 2026-11-27, "share among
 *      posters"): the end pot (90% of the bucket budget) is split pro-rata
 *      by points earned in that bucket this season among ONLY the wallets
 *      with an approved final-48h season post — the denominator is the
 *      posters' points, so fewer posters means a bigger share each. A
 *      bucket with no qualifying poster burns its pot (recorded). Rounding
 *      dust is recorded as burnt. The pot is the 90% plus whatever of the
 *      bucket's 10% instant budget is still unspent (`instantLeftover`), so
 *      the bucket's season total is exactly its budget when posters exist.
 *    - Holding: the pot (the holding budget, less any legacy daily payouts)
 *      is split pro-rata by NFT-days. A wallet gets its share only if it was
 *      never missing at a snapshot and has ≥1 Monad transaction; other
 *      shares are burnt the same way.
 *    - XP per wallet = season-earned (the leaderboard: instant emissions
 *      minus revocations) + its season-end payouts. That's the merkle leaf.
 *    Freezing refuses while final posts for the season are still pending
 *    review, so nobody loses a share to an unread queue.
 * 2. Payout (`payoutSeason`, resumable): credits the frozen shares to
 *    spendable balances, idempotent per wallet and bucket, in time-boxed
 *    chunks (the admin route calls it until it reports done).
 *
 * The contract owner then calls `setSeasonRoot(season, root, total)` (or
 * `setSeasonCap` + a minter's `settleBatch` with the exported rows — one or
 * the other: batches close once a root is set). Holders claim with their
 * proof. The contract itself refuses a total above the season's maximum.
 */

export type BucketDrop = {
  bucket: BucketId;
  /** the season-end pot, including `instantLeftover` */
  pot: number;
  /** share buckets: the 10% instant budget left unspent at close, added to the pot (holding: 0) */
  instantLeftover: number;
  /** sum of the basis: posters' bucket points (share buckets), or all NFT-days (holding) */
  basis: number;
  wallets: number;
  recipients: number;
  paid: number;
  /** holding: shares of wallets that missed a snapshot / have no tx (share buckets: always 0) */
  burntIneligible: number;
  /** floor rounding, or the whole pot when nobody qualified in the bucket */
  dust: number;
  /** pot − paid */
  burnt: number;
};

export type Settlement = {
  season: number;
  root: Hex;
  total: number;
  count: number;
  frozenAt: number;
  frozenBy: string;
  /** [address(lowercase), XP] sorted by XP desc */
  entries: [string, number][];
  /** season-end payouts to credit: [address, bucket, amount] */
  shares: [string, BucketId, number][];
  drops: Record<BucketId, BucketDrop>;
  burnt: number;
  posters: number;
  snapshots: { taken: number; total: number };
};

export async function getSettlement(season: number): Promise<Settlement | null> {
  return store().get<Settlement>(K.settle(season));
}

/**
 * Pro-rata split; BigInt so pot × points can't lose precision.
 * `mode: "eligible_only"` puts only eligible wallets in the denominator
 * (season shares: posters split the whole pot); `"all"` keeps everyone in it
 * and burns the ineligible shares (holding drop).
 */
function split(
  bucket: BucketId,
  rows: { member: string; score: number }[],
  pot: number,
  eligible: (a: string) => boolean,
  out: [string, BucketId, number][],
  mode: "eligible_only" | "all",
): BucketDrop {
  const live = rows.filter((r) => r.score > 0);
  const inBasis = mode === "eligible_only" ? live.filter((r) => eligible(r.member)) : live;
  const basis = inBasis.reduce((x, r) => x + r.score, 0);
  const d: BucketDrop = { bucket, pot, instantLeftover: 0, basis, wallets: live.length, recipients: 0, paid: 0, burntIneligible: 0, dust: 0, burnt: 0 };
  if (basis > 0) {
    for (const r of inBasis) {
      const share = Number((BigInt(pot) * BigInt(r.score)) / BigInt(basis));
      if (share <= 0) continue;
      if (eligible(r.member)) {
        out.push([r.member, bucket, share]);
        d.paid += share;
        d.recipients++;
      } else {
        d.burntIneligible += share;
      }
    }
  }
  d.burnt = pot - d.paid;
  d.dust = d.burnt - d.burntIneligible;
  return d;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export async function freezeSeason(season: number, by: string, opts: { force?: boolean } = {}): Promise<Settlement> {
  if (!Number.isSafeInteger(season) || season < 1) throw new HttpError(400, "bad season");
  const existing = await getSettlement(season);
  if (existing) return existing;
  const ended = Date.now() >= seasonBounds(season).end;
  if (!ended && !opts.force) {
    throw new HttpError(409, `season ${season} is still running (current: ${seasonAt()})`, "season_live");
  }
  if (ended && !(await closeSeasonDays(season))) {
    throw new HttpError(409, `still closing season ${season}'s days (daily shares) — press again in a moment`, "closing_days");
  }
  const pending = await pendingSeasonPosts(season);
  if (pending > 0) {
    throw new HttpError(409, `review the ${pending} pending season post${pending === 1 ? "" : "s"} first — they decide who gets a share`, "pending_season_posts");
  }

  const s = season;
  const posters = new Set(await store().smembers(K.seasonPosters(s)));
  const shares: [string, BucketId, number][] = [];
  const drops = {} as Record<BucketId, BucketDrop>;

  for (const b of SHARE_BUCKETS) {
    const [rows, emitted] = await Promise.all([store().zrevrange(K.lbBucket(s, b), 0, -1), store().num(K.pool(s, b))]);
    // owner rule (2026-11-27): unspent instant budget (last-day roll-over, capped
    // excess, empty days) joins the season-end pot, minus anything still owed
    const owedNow = await seasonOwed(s, b);
    const instantLeftover = Math.max(0, instantCap(b, s) - emitted - owedNow);
    drops[b] = split(b, rows, endPot(b, s, emitted) + instantLeftover, (a) => posters.has(a), shares, "eligible_only");
    drops[b].instantLeftover = instantLeftover;
  }

  const [holdRows, holdEmitted, out] = await Promise.all([
    store().zrevrange(K.nftDays(s), 0, -1),
    store().num(K.pool(s, "holding")),
    store().smembers(K.holdOut(s)),
  ]);
  const missed = new Set(out);
  const holders = holdRows.filter((r) => r.score > 0 && !missed.has(r.member)).map((r) => r.member);
  // RPC failures throw (503) and abort the freeze: retry, never guess
  const txs = await mapLimit(holders, 10, (a) => txCount(a));
  const txOk = new Set(holders.filter((_, i) => txs[i] >= POINTS_CONFIG.tx.holdingDrop));
  drops.holding = split("holding", holdRows, endPot("holding", s, holdEmitted), (a) => txOk.has(a), shares, "all");

  const earned = await store().zrevrange(K.lb(s), 0, -1);
  const xp = new Map<string, number>();
  for (const r of earned) if (r.score > 0) xp.set(r.member, r.score);
  for (const [a, , amt] of shares) xp.set(a, (xp.get(a) ?? 0) + amt);
  const entries = [...xp.entries()].filter(([, p]) => p > 0).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  if (entries.length === 0) throw new HttpError(409, "nobody earned points that season", "empty");
  const total = entries.reduce((a, [, p]) => a + p, 0);
  if (total > seasonBudget(s)) {
    throw new HttpError(500, `season total ${total} exceeds season budget ${seasonBudget(s)} — investigate before settling`);
  }
  const tree = new MerkleTree(entries.map(([a, p]) => leafHash(getAddress(a), BigInt(s), BigInt(p))));
  const settlement: Settlement = {
    season: s,
    root: tree.root,
    total,
    count: entries.length,
    frozenAt: Date.now(),
    frozenBy: by,
    entries,
    shares,
    drops,
    burnt: Object.values(drops).reduce((a, d) => a + d.burnt, 0),
    posters: posters.size,
    snapshots: await snapshotCount(s),
  };
  // NX: two admins freezing at once can't produce two different snapshots
  const wrote = await store().set(K.settle(s), settlement, { nx: true });
  return wrote ? settlement : ((await getSettlement(s)) ?? settlement);
}

export type PayoutProgress = { season: number; credited: number; total: number; done: boolean };

/**
 * Credit the frozen season-end payouts to balances. Resumable: a cursor
 * remembers how far it got and every credit is idempotent
 * (`end:<season>:<bucket>`), so overlapping or retried runs never double-pay.
 */
export async function payoutSeason(season: number, opts: { budgetMs?: number } = {}): Promise<PayoutProgress> {
  const s = await getSettlement(season);
  if (!s) throw new HttpError(404, `season ${season} isn't frozen yet`, "not_settled");
  const stopAt = Date.now() + (opts.budgetMs ?? 40_000);
  let i = await store().num(K.payoutCursor(season));
  while (i < s.shares.length && Date.now() < stopAt) {
    const [a, b, amt] = s.shares[i];
    await emitSeasonEnd(b, a, amt, season, s.drops[b].pot, b === "holding" ? "holding_drop" : "season_share", `end:${season}:${b}`, {
      bucket: b,
    });
    i++;
    await store().set(K.payoutCursor(season), String(i));
  }
  return { season, credited: i, total: s.shares.length, done: i >= s.shares.length };
}

export async function payoutProgress(season: number): Promise<PayoutProgress | null> {
  const s = await getSettlement(season);
  if (!s) return null;
  const i = await store().num(K.payoutCursor(season));
  return { season, credited: i, total: s.shares.length, done: i >= s.shares.length };
}

export async function proofFor(addr: string, season: number) {
  const a = normAddr(addr);
  const s = await getSettlement(season);
  if (!s) return null;
  const row = s.entries.find(([x]) => x === a);
  const mine = (s.shares ?? []).filter(([x]) => x === a).map(([, bucket, amount]) => ({ bucket, amount }));
  if (!row) return { season, root: s.root, amount: 0, proof: [] as Hex[], shares: mine };
  const tree = new MerkleTree(s.entries.map(([x, p]) => leafHash(getAddress(x), BigInt(season), BigInt(p))));
  const leaf = leafHash(getAddress(a), BigInt(season), BigInt(row[1]));
  return { season, root: s.root, amount: row[1], proof: tree.proof(leaf), shares: mine };
}
