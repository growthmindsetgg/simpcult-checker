import "server-only";
import { kv } from "@/lib/server/store";
import * as points from "./pointsAdapter";
import { isValidBet } from "./config";
import { resolveFromBytes } from "./engine";
import { CLIENT_SEED_RE, outcomeBytes, randomHex, sha256Hex } from "./fair";
import type { RecentSpin, SlotError, SlotState, SpinResponse } from "./types";

/**
 * Server side of the Simp Machine. Outcomes are only ever decided here.
 *
 * ── one seed, one spin ────────────────────────────────────────────────────
 * Per address the KV holds one committed server seed. A spin consumes it with
 * an atomic get-and-delete (`kv().take`), so two spins can never share a seed.
 *
 * ── every spin is idempotent ──────────────────────────────────────────────
 * A spin is fully defined by (address, committed seed, client seed, bet):
 *   - its id, and the Points refId for both the bet and the win, is derived
 *     from the seed commitment, so it is unique per spin and the same on every
 *     retry. The Points API ignores a repeated refId.
 *   - before any points move, the spin is written to `slot:run:<address>`.
 *     A repeat of the same request (lost response, client retry, a function
 *     that died half-way) finds that record and finishes the SAME spin: same
 *     outcome, no second debit, no second credit.
 *   - once settled, the result is kept under `slot:done:<address>:<hash>` and
 *     simply replayed to any later repeat.
 */

const COMMIT_TTL = 60 * 60 * 24; // unused commitments expire after a day
const RUN_TTL = 60 * 60 * 24; // an interrupted spin can be resumed for a day
const RUN_ORPHAN_MS = 10_000; // a run older than this is treated as interrupted
const DONE_TTL = 60 * 60 * 24; // settled results stay replayable for a day
const SPIN_TTL = 60 * 60 * 24 * 30; // audit record
const RECENT_KEEP = 20;

/** Pacing: a minimum gap between new spins plus a per-minute cap. */
export const RATE = { minGapMs: 700, perMinute: 40 };

type Commit = { serverSeed: string; hash: string; at: number };
type Run = { commit: Commit; clientSeed: string; bet: number; at: number };
/** the part of a response that never changes once the spin is settled */
type Settled = Omit<SpinResponse, "nextServerSeedHash" | "balance" | "replayed">;

const K = {
  commit: (a: string) => `slot:commit:${a}`,
  run: (a: string) => `slot:run:${a}`,
  done: (a: string, hash: string) => `slot:done:${a}:${hash}`,
  last: (a: string) => `slot:last:${a}`,
  minute: (a: string, m: number) => `slot:rl:${a}:${m}`,
  spin: (id: string) => `slot:spin:${id}`,
  recent: (a: string) => `slot:recent:${a}`,
  pending: (id: string) => `slot:pending:${id}`,
};

const norm = (a: string) => a.toLowerCase();
/** unique per spin, stable across retries: also the Points refId */
const spinIdFor = (commit: Commit) => `slot-${commit.hash.slice(0, 32)}`;

export class SpinError extends Error {
  constructor(
    public status: number,
    public body: SlotError,
  ) {
    super(body.error);
  }
}

async function newCommit(addr: string): Promise<Commit> {
  const serverSeed = randomHex(32);
  const c: Commit = { serverSeed, hash: await sha256Hex(serverSeed), at: Date.now() };
  await kv().set(K.commit(addr), c, COMMIT_TTL);
  return c;
}

/**
 * The commitment for the next spin, creating one if there is none. A stored
 * commitment that already has a settled result is never served again: it is
 * replaced.
 */
async function nextCommitHash(addr: string): Promise<string> {
  const c = await kv().get<Commit>(K.commit(addr));
  if (c && !(await kv().get(K.done(addr, c.hash)))) return c.hash;
  return (await newCommit(addr)).hash;
}

/**
 * Hash to show the player. Null for a moment while a spin is in flight. A spin
 * that was interrupted (its function died after the bet) is finished here, so
 * nobody is left with a debit and no result.
 */
async function currentCommitHash(address: string, addr: string): Promise<string | null> {
  const run = await kv().get<Run>(K.run(addr));
  if (run) {
    if (Date.now() - run.at < RUN_ORPHAN_MS) return null;
    try {
      await settle(address, addr, run);
    } catch (e) {
      // still unfinished (points unavailable): no new spin until it settles
      if (await kv().get(K.run(addr))) {
        console.error("[slot] could not finish interrupted spin", e);
        return null;
      }
    }
  }
  return nextCommitHash(addr);
}

export async function getState(address: string): Promise<SlotState> {
  const addr = norm(address);
  const serverSeedHash = await currentCommitHash(address, addr);
  const [balance, recent] = await Promise.all([points.getBalance(address), kv().get<RecentSpin[]>(K.recent(addr))]);
  return { address, balance, serverSeedHash, recent: recent ?? [] };
}

/**
 * Best-effort pacing on the shared KV (its interface has no atomic INCR, so two
 * simultaneous requests can both pass). It is not the safety mechanism: the
 * single-use seed and the idempotent refId are.
 */
async function rateLimit(addr: string): Promise<number> {
  const now = Date.now();
  const last = (await kv().get<number>(K.last(addr))) ?? 0;
  if (now - last < RATE.minGapMs) return RATE.minGapMs - (now - last);
  const minute = Math.floor(now / 60_000);
  const count = (await kv().get<number>(K.minute(addr, minute))) ?? 0;
  if (count >= RATE.perMinute) return 60_000 - (now % 60_000);
  await kv().set(K.minute(addr, minute), count + 1, 70);
  await kv().set(K.last(addr), now, 60);
  return 0;
}

async function respond(address: string, addr: string, settled: Settled, replayed: boolean): Promise<SpinResponse> {
  const [nextServerSeedHash, balance] = await Promise.all([
    nextCommitHash(addr).catch((e) => {
      console.error("[slot] next commit failed", e);
      return null;
    }),
    points.getBalance(address).catch(() => null),
  ]);
  return { ...settled, nextServerSeedHash, balance, ...(replayed ? { replayed } : {}) };
}

/**
 * Finish the spin described by `run`. Safe to call more than once, and from
 * two requests at the same time: the outcome is a pure function of the run,
 * and the Points API drops repeated refIds.
 */
async function settle(address: string, addr: string, run: Run): Promise<Settled> {
  const { commit, clientSeed, bet } = run;
  const spinId = spinIdFor(commit);

  try {
    await points.debit(address, bet, "game:slot:bet", spinId);
  } catch (e) {
    if (points.isInsufficient(e)) {
      // The Points API checks for a repeated refId before it checks the balance,
      // so this refusal means the bet was never taken for this spin: the spin
      // did not happen. Drop it, and hand the unused seed back unless a newer
      // commitment (or, defensively, a settled result) already exists.
      await kv().del(K.run(addr));
      const [stored, done] = await Promise.all([kv().get<Commit>(K.commit(addr)), kv().get(K.done(addr, commit.hash))]);
      if (!stored && !done) await kv().set(K.commit(addr), commit, COMMIT_TTL);
      throw new SpinError(402, {
        code: "insufficient",
        error: "not enough points for that bet",
        serverSeedHash: stored ? stored.hash : done ? null : commit.hash,
      });
    }
    // Anything else: we cannot know whether the bet was taken. Keep the run
    // record so the same spin is finished by a retry or the next state load,
    // and never hand the seed back.
    console.error("[slot] debit failed", spinId, e);
    throw new SpinError(503, { code: "server", error: "points are unavailable right now. try again.", serverSeedHash: null });
  }

  const outcome = resolveFromBytes(await outcomeBytes(commit.serverSeed, clientSeed), bet);

  let creditPending = false;
  if (outcome.totalWin > 0) {
    try {
      await points.credit(address, outcome.totalWin, "game:slot:win", spinId);
    } catch {
      try {
        await points.credit(address, outcome.totalWin, "game:slot:win", spinId); // idempotent per refId
      } catch (e) {
        creditPending = true;
        console.error("[slot] credit failed", spinId, e);
        await kv()
          .set(K.pending(spinId), { address, amount: outcome.totalWin, at: Date.now() })
          .catch(() => {});
      }
    }
  }

  const settled: Settled = {
    spinId,
    bet,
    stops: outcome.stops,
    grid: outcome.grid,
    lineWins: outcome.lineWins,
    scatterCount: outcome.scatterCount,
    scatterWin: outcome.scatterWin,
    totalWin: outcome.totalWin,
    serverSeed: commit.serverSeed,
    serverSeedHash: commit.hash,
    clientSeed,
    ...(creditPending ? { creditPending } : {}),
  };

  // points have moved: bookkeeping below must never fail the spin
  try {
    const record: RecentSpin = {
      spinId,
      at: Date.now(),
      bet,
      totalWin: outcome.totalWin,
      stops: outcome.stops,
      clientSeed,
      serverSeed: commit.serverSeed,
      serverSeedHash: commit.hash,
    };
    await kv().set(K.done(addr, commit.hash), settled, DONE_TTL);
    const recent = ((await kv().get<RecentSpin[]>(K.recent(addr))) ?? []).filter((r) => r.spinId !== spinId);
    await Promise.all([
      kv().set(K.spin(spinId), { address, ...record, lineWins: outcome.lineWins }, SPIN_TTL),
      kv().set(K.recent(addr), [record, ...recent].slice(0, RECENT_KEEP), SPIN_TTL),
    ]);
    await kv().del(K.run(addr));
  } catch (e) {
    console.error("[slot] spin bookkeeping failed", spinId, e);
  }
  return settled;
}

export type SpinRequest = { bet: unknown; clientSeed: unknown; serverSeedHash: unknown };

export async function spin(address: string, req: SpinRequest): Promise<SpinResponse> {
  const addr = norm(address);
  const { bet, clientSeed } = req;

  if (!isValidBet(bet)) throw new SpinError(400, { code: "bad-request", error: "pick one of the listed bet sizes" });
  if (typeof clientSeed !== "string" || !CLIENT_SEED_RE.test(clientSeed))
    throw new SpinError(400, { code: "bad-request", error: "your seed must be 8–64 letters, digits, - or _" });
  if (typeof req.serverSeedHash !== "string" || !/^[0-9a-f]{64}$/i.test(req.serverSeedHash))
    throw new SpinError(400, { code: "bad-request", error: "missing server seed hash" });
  const hash = req.serverSeedHash.toLowerCase();
  const same = (r: { clientSeed: string; bet: number }) => r.clientSeed === clientSeed && r.bet === bet;

  /** Is this request a repeat of a spin we already know? Then answer with that spin. */
  const repeatOf = async (): Promise<SpinResponse | null> => {
    const done = await kv().get<Settled>(K.done(addr, hash));
    if (done) {
      if (same(done)) return respond(address, addr, done, true);
      // that commitment is spent, and not by this request
      throw new SpinError(409, {
        code: "stale-commit",
        error: "that seed commitment was already used",
        serverSeedHash: await nextCommitHash(addr),
      });
    }
    const run = await kv().get<Run>(K.run(addr));
    if (run && run.commit.hash === hash) {
      if (!same(run)) throw new SpinError(409, { code: "busy", error: "a spin is already running", serverSeedHash: null });
      return respond(address, addr, await settle(address, addr, run), true);
    }
    return null;
  };

  const repeated = await repeatOf();
  if (repeated) return repeated;

  const wait = await rateLimit(addr);
  if (wait > 0) throw new SpinError(429, { code: "rate-limited", error: "easy, simp. one spin at a time.", retryAfterMs: wait });

  // an earlier spin that never finished must settle before a new one starts,
  // or its record would be overwritten
  const unfinished = await kv().get<Run>(K.run(addr));
  if (unfinished && unfinished.commit.hash !== hash) {
    if (Date.now() - unfinished.at < RUN_ORPHAN_MS)
      throw new SpinError(409, { code: "busy", error: "a spin is already running", serverSeedHash: null });
    try {
      await settle(address, addr, unfinished);
    } catch (e) {
      if (await kv().get(K.run(addr))) {
        console.error("[slot] previous spin still unsettled", e);
        throw new SpinError(503, { code: "server", error: "still settling your last spin. try again in a moment.", serverSeedHash: null });
      }
    }
  }

  // consume the commitment (atomic get+delete): one spin per seed
  const commit = await kv().take<Commit>(K.commit(addr));
  if (!commit) {
    // someone took it a moment ago: if it was this same request, join it
    const joined = await repeatOf();
    if (joined) return joined;
    throw new SpinError(409, { code: "busy", error: "a spin is already running", serverSeedHash: null });
  }
  if (commit.hash !== hash) {
    await kv().set(K.commit(addr), commit, COMMIT_TTL);
    throw new SpinError(409, { code: "stale-commit", error: "seed commitment changed. refreshed it.", serverSeedHash: commit.hash });
  }

  let balance: number;
  try {
    balance = await points.getBalance(address);
  } catch (e) {
    await kv().set(K.commit(addr), commit, COMMIT_TTL);
    console.error("[slot] balance read failed", e);
    throw new SpinError(503, { code: "server", error: "points are unavailable right now. try again.", serverSeedHash: commit.hash });
  }
  if (balance < bet) {
    await kv().set(K.commit(addr), commit, COMMIT_TTL);
    throw new SpinError(402, { code: "insufficient", error: "not enough points for that bet", serverSeedHash: commit.hash });
  }

  // from here the spin exists: any repeat of this request resumes it
  const run: Run = { commit, clientSeed, bet, at: Date.now() };
  await kv().set(K.run(addr), run, RUN_TTL);
  return respond(address, addr, await settle(address, addr, run), false);
}
