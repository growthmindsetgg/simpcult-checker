import "server-only";
import { getAddress, type Hex } from "viem";
import { seasonAt, seasonBounds, seasonBudget } from "./config";
import { normAddr } from "./ledger";
import { store } from "./store";
import { K } from "./keys";
import { HttpError } from "./http";
import { seasonEarners } from "./season";
import { MerkleTree, leafHash } from "./merkle";

/**
 * Season settlement → SimpPoints (soulbound XP, one ERC-1155 id per season).
 *
 * Basis: season-EARNED points (the leaderboard score: emissions minus admin
 * revocations), not spendable balance — games move balances around, but XP
 * records what you earned that season.
 *
 * Freezing snapshots the earners once; the snapshot is immutable afterwards.
 * The admin then calls `setSeasonRoot(season, root, total)` on the contract
 * (or `settleBatch` with the exported rows). Holders claim with their proof.
 */

export type Settlement = {
  season: number;
  root: Hex;
  total: number;
  count: number;
  frozenAt: number;
  frozenBy: string;
  /** [address(lowercase), points] sorted by points desc */
  entries: [string, number][];
};

export async function getSettlement(season: number): Promise<Settlement | null> {
  return store().get<Settlement>(K.settle(season));
}

export async function freezeSeason(season: number, by: string, opts: { force?: boolean } = {}): Promise<Settlement> {
  if (!Number.isSafeInteger(season) || season < 1) throw new HttpError(400, "bad season");
  const existing = await getSettlement(season);
  if (existing) return existing;
  const ended = Date.now() >= seasonBounds(season).end;
  if (!ended && !opts.force) {
    throw new HttpError(409, `season ${season} is still running (current: ${seasonAt()})`, "season_live");
  }
  const earners = await seasonEarners(season);
  if (earners.length === 0) throw new HttpError(409, "nobody earned points that season", "empty");
  const total = earners.reduce((a, e) => a + e.points, 0);
  if (total > seasonBudget(season)) {
    throw new HttpError(500, `earned total ${total} exceeds season budget ${seasonBudget(season)} — investigate before settling`);
  }
  const tree = new MerkleTree(earners.map((e) => leafHash(getAddress(e.address), BigInt(season), BigInt(e.points))));
  const s: Settlement = {
    season,
    root: tree.root,
    total,
    count: earners.length,
    frozenAt: Date.now(),
    frozenBy: by,
    entries: earners.map((e) => [e.address, e.points]),
  };
  // NX: two admins freezing at once can't produce two different snapshots
  const wrote = await store().set(K.settle(season), s, { nx: true });
  return wrote ? s : ((await getSettlement(season)) ?? s);
}

export async function proofFor(addr: string, season: number) {
  const a = normAddr(addr);
  const s = await getSettlement(season);
  if (!s) return null;
  const row = s.entries.find(([x]) => x === a);
  if (!row) return { season, root: s.root, amount: 0, proof: [] as Hex[] };
  const tree = new MerkleTree(s.entries.map(([x, p]) => leafHash(getAddress(x), BigInt(season), BigInt(p))));
  const leaf = leafHash(getAddress(a), BigInt(season), BigInt(row[1]));
  return { season, root: s.root, amount: row[1], proof: tree.proof(leaf) };
}
