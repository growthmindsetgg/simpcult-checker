import "server-only";
import {
  POINTS_CONFIG,
  SHARE_BUCKETS,
  instantCap,
  previousUtcDay,
  seasonAt,
  seasonBounds,
  utcDay,
  type BucketId,
} from "./config";
import { emitInSeason, normAddr, PointsError } from "./ledger";
import { store } from "./store";
import { K } from "./keys";

/**
 * Auto-pace: the daily split (owner rule, 2026-11-27: "on days with fewer
 * post submissions, the users who post get a bigger bonus").
 *
 * For each share sub-pool (active, card, amu) and UTC day:
 *   allowance = (instant cap − instant paid − still-owed shares of unclosed
 *               days) ÷ days left in the season (today included).
 *   Fixed once at the day's first touch (NX), so it's stable all day. An
 *   empty or quiet day leaves budget unspent, which lifts later allowances.
 *
 * During the day an activity pays `instant` right away and records its
 * weight units (base reward × Telegram multiplier) for the wallet:
 *   instant = min(units, max(1, ⌊units × rate⌋)) — never above the table —
 *   rate    = instantFraction × allowance ÷ expected units (≤ 1),
 *   and once instant payouts hit instantFraction × allowance, 1 point.
 * So a surge can never spend more than ~a quarter of the day instantly.
 *
 * At UTC day close (the daily cron, or lazily after the first request of
 * the next day; locked, resumable, idempotent per day and sub-pool) the rest
 * of the allowance is shared pro-rata by weight units among that day's
 * participants, as "dayshare" ledger credits (refId
 * `dayshare:<day>:<bucket>:<addr>`). They are instant emissions of that
 * day's season: atomic instant cap, season board, and the 90% basis.
 *
 * Per-wallet daily cap (owner, 2026-11-27): a wallet's day total (instant +
 * day share) is at most `walletCapShare` (5%) of the day's allowance. The
 * close water-fills: shares are pro-rata by units, a wallet that would go
 * over its room gets exactly its room, and the excess is re-split among the
 * rest, repeated until stable or everyone is capped. What's still left is
 * never paid that day, so it rolls into later allowances like an empty day.
 * Instant slices respect the remaining room too, except that every action
 * pays at least 1 point (its receipt), so a wallet acting past its cap can
 * exceed it by 1 point per such action.
 */

const DAY = 86_400_000;
const LOOKBACK_DAYS = 3;
const CLOSE_LOCK_SEC = 90;
const PACE_TTL_SEC = 60 * 60 * 24 * 60;

export type PaceDay = {
  season: number;
  bucket: BucketId;
  day: string;
  allowance: number;
  /** instant points per weight unit (≤ 1) */
  rate: number;
  expectedUnits: number;
  remaining: number;
  remainingDays: number;
  computedAt: number;
};

export type DayClose = {
  season: number;
  bucket: BucketId;
  day: string;
  allowance: number;
  /** per-wallet cap on the day total */
  walletCap: number;
  /** wallets that hit the cap */
  capped: number;
  /** leftover − shares: not paid, rolls into later days */
  rolled: number;
  instantPaid: number;
  /** allowance − instant paid: what the participants share */
  leftover: number;
  totalUnits: number;
  participants: number;
  /** [address, share] */
  shares: [string, number][];
  sharesTotal: number;
  closedAt: number;
  done: boolean;
};

const dayStart = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** the most one wallet can get in a day (instant + share) */
export const walletCap = (allowance: number) => Math.floor(allowance * POINTS_CONFIG.pace.walletCapShare);

/**
 * Water-filling split: `leftover` pro-rata by `units`, but nobody above
 * `room`. Capped wallets get exactly their room and the excess is re-split
 * among the rest, repeated until stable. Returns integer shares (floored)
 * in input order; their sum is ≤ leftover and the remainder rolls forward.
 */
export function waterFill(leftover: number, rows: { units: number; room: number }[]): number[] {
  const out = rows.map(() => 0);
  let open = rows.map((r, i) => i).filter((i) => rows[i].units > 0 && rows[i].room > 0);
  let rest = leftover;
  while (open.length > 0 && rest > 0) {
    const total = open.reduce((a, i) => a + rows[i].units, 0);
    const over = open.filter((i) => (rest * rows[i].units) / total >= rows[i].room);
    if (over.length === 0) {
      for (const i of open) out[i] = Number((BigInt(Math.floor(rest)) * BigInt(Math.floor(rows[i].units))) / BigInt(Math.floor(total)));
      break;
    }
    for (const i of over) {
      out[i] = Math.floor(rows[i].room);
      rest -= out[i];
    }
    open = open.filter((i) => !over.includes(i));
  }
  return out;
}
const isShareBucket = (b: BucketId) => SHARE_BUCKETS.includes(b);
const seasonScale = (season: number) => Math.pow(POINTS_CONFIG.season.decay, Math.max(0, season - 1));

/** what an unclosed day still owes its participants */
async function owed(season: number, b: BucketId, day: string): Promise<number> {
  const [rec, plan] = await Promise.all([
    store().get<PaceDay>(K.paceDay(season, b, day)),
    store().get<DayClose>(K.paceClose(season, b, day)),
  ]);
  if (!rec) return 0;
  if (plan) {
    if (plan.done) return 0;
    const cursor = await store().num(K.paceCursor(season, b, day));
    return plan.shares.slice(cursor).reduce((a, [, v]) => a + v, 0);
  }
  return Math.max(0, rec.allowance - (await store().num(K.paceSpent(season, b, day))));
}

/** today's allowance record for a share bucket (created on first touch) */
export async function paceDay(bucket: BucketId, now = Date.now()): Promise<PaceDay> {
  const season = seasonAt(now);
  const day = utcDay(now);
  const key = K.paceDay(season, bucket, day);
  const cached = await store().get<PaceDay>(key);
  if (cached) return cached;

  const { start, end } = seasonBounds(season);
  let reserved = 0;
  let d = day;
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    d = previousUtcDay(d);
    if (dayStart(d) + DAY <= start) break;
    reserved += await owed(season, bucket, d);
  }
  const remaining = Math.max(0, instantCap(bucket, season) - (await store().num(K.pool(season, bucket))) - reserved);
  const remainingDays = Math.max(1, Math.ceil((end - Math.max(dayStart(day), start)) / DAY));
  const allowance = Math.floor(remaining / remainingDays);

  const p = POINTS_CONFIG.pace;
  const k = seasonScale(season);
  const prev = previousUtcDay(day);
  const prevInSeason = dayStart(prev) >= start;
  const prevUnits = prevInSeason ? await store().num(K.paceUnitsTotal(season, bucket, prev)) : 0;
  const base = prevInSeason ? prevUnits : (p.priorUnits[bucket] ?? 0) * k;
  const expectedUnits = Math.max(base, (p.minUnits[bucket] ?? 1) * k, 1);
  const rate = Math.min(1, (p.instantFraction * allowance) / expectedUnits);

  const rec: PaceDay = { season, bucket, day, allowance, rate, expectedUnits, remaining, remainingDays, computedAt: now };
  if (await store().set(key, rec, { nx: true, ex: PACE_TTL_SEC })) return rec;
  return (await store().get<PaceDay>(key)) ?? rec;
}

/**
 * The instant amount `units` pays right now in `bucket` (for `address`, also
 * within its remaining daily room; never below 1, the action's receipt).
 */
export async function quote(
  bucket: BucketId,
  units: number,
  address?: string,
  now = Date.now(),
): Promise<{ instant: number; day: PaceDay; throttled: boolean }> {
  const day = await paceDay(bucket, now);
  const [spent, mine] = await Promise.all([
    store().num(K.paceSpent(day.season, bucket, day.day)),
    address ? store().zscore(K.paceInstant(day.season, bucket, day.day), normAddr(address)) : Promise.resolve(null),
  ]);
  const throttled = spent >= day.allowance * POINTS_CONFIG.pace.instantFraction;
  const room = Math.max(0, walletCap(day.allowance) - (mine ?? 0));
  const instant = throttled ? 1 : Math.max(1, Math.min(units, Math.floor(units * day.rate), room));
  return { instant, day, throttled };
}

/** after an instant activity payout landed: count its weight and its points */
export async function recordActivity(day: PaceDay, address: string, units: number, paid: number) {
  const a = normAddr(address);
  await Promise.all([
    store().zincrby(K.paceUnits(day.season, day.bucket, day.day), units, a),
    store().incrby(K.paceUnitsTotal(day.season, day.bucket, day.day), units, PACE_TTL_SEC),
    store().incrby(K.paceSpent(day.season, day.bucket, day.day), paid, PACE_TTL_SEC),
    store().zincrby(K.paceInstant(day.season, day.bucket, day.day), paid, a),
  ]);
}

export type TodayPool = {
  bucket: BucketId;
  day: string;
  allowance: number;
  instantPaid: number;
  /** what's left for the close right now */
  left: number;
  participants: number;
  totalUnits: number;
  closesAt: number;
  /** the most one wallet can get today (instant + share) */
  walletCap: number;
  mine?: { units: number; instant: number; provisional: number; roomLeft: number };
};

/** today's pool for a share bucket, and optionally one wallet's provisional share */
export async function todayPool(bucket: BucketId, address?: string, now = Date.now()): Promise<TodayPool> {
  const d = await paceDay(bucket, now);
  const [spent, totalUnits, participants, mine, mineInstant] = await Promise.all([
    store().num(K.paceSpent(d.season, bucket, d.day)),
    store().num(K.paceUnitsTotal(d.season, bucket, d.day)),
    store().zcard(K.paceUnits(d.season, bucket, d.day)),
    address ? store().zscore(K.paceUnits(d.season, bucket, d.day), normAddr(address)) : Promise.resolve(null),
    address ? store().zscore(K.paceInstant(d.season, bucket, d.day), normAddr(address)) : Promise.resolve(null),
  ]);
  const cap = walletCap(d.allowance);
  const left = Math.max(0, d.allowance - spent);
  const out: TodayPool = {
    bucket,
    day: d.day,
    allowance: d.allowance,
    instantPaid: spent,
    left,
    participants,
    totalUnits,
    closesAt: dayStart(d.day) + DAY,
    walletCap: cap,
  };
  if (address) {
    const u = mine ?? 0;
    const inst = mineInstant ?? 0;
    const room = Math.max(0, cap - inst);
    // estimate only: the close water-fills, so others hitting their cap can lift this
    const raw = totalUnits > 0 ? Math.floor((left * u) / totalUnits) : 0;
    out.mine = { units: u, instant: inst, provisional: Math.min(raw, room), roomLeft: room };
  }
  return out;
}

/**
 * Close one day for one bucket: freeze the split (NX), then credit it,
 * resumably. Returns true when the day is fully closed (or had nothing).
 */
export async function closeDay(season: number, bucket: BucketId, day: string, deadline = Date.now() + 25_000): Promise<boolean> {
  const rec = await store().get<PaceDay>(K.paceDay(season, bucket, day));
  if (!rec) return true;
  const planKey = K.paceClose(season, bucket, day);
  let plan = await store().get<DayClose>(planKey);
  if (plan?.done) return true;
  if (!(await store().set(K.paceLock(season, bucket, day), "1", { nx: true, ex: CLOSE_LOCK_SEC }))) return false;
  try {
    plan = await store().get<DayClose>(planKey);
    if (plan?.done) return true;
    if (!plan) {
      const [instantPaid, rows, poolPaid, instRows] = await Promise.all([
        store().num(K.paceSpent(season, bucket, day)),
        store().zrevrange(K.paceUnits(season, bucket, day), 0, -1),
        store().num(K.pool(season, bucket)),
        store().zrevrange(K.paceInstant(season, bucket, day), 0, -1),
      ]);
      const instOf = new Map(instRows.map((r) => [r.member, r.score]));
      const cap = walletCap(rec.allowance);
      const live = rows.filter((r) => r.score > 0);
      const totalUnits = live.reduce((a, r) => a + r.score, 0);
      // welcome bonuses and admin grants draw on the same instant budget: never
      // plan more than what's really left under the cap, so no share gets dropped
      const leftover = Math.min(Math.max(0, rec.allowance - instantPaid), Math.max(0, instantCap(bucket, season) - poolPaid));
      const rooms = live.map((r) => ({ units: r.score, room: Math.max(0, cap - (instOf.get(r.member) ?? 0)) }));
      const fill = waterFill(leftover, rooms);
      const shares: [string, number][] = [];
      let capped = 0;
      live.forEach((r, i) => {
        if (fill[i] > 0) shares.push([r.member, fill[i]]);
        if (fill[i] >= rooms[i].room) capped++;
      });
      const fresh: DayClose = {
        season,
        bucket,
        day,
        allowance: rec.allowance,
        walletCap: cap,
        capped,
        rolled: 0,
        instantPaid,
        leftover,
        totalUnits,
        participants: live.length,
        shares,
        sharesTotal: shares.reduce((a, [, v]) => a + v, 0),
        closedAt: Date.now(),
        done: false,
      };
      fresh.rolled = leftover - fresh.sharesTotal;
      await store().set(planKey, fresh, { nx: true, ex: PACE_TTL_SEC });
      plan = (await store().get<DayClose>(planKey)) ?? fresh;
    }
    let i = await store().num(K.paceCursor(season, bucket, day));
    while (i < plan.shares.length) {
      if (Date.now() > deadline) return false;
      const [a, v] = plan.shares[i];
      try {
        await emitInSeason(bucket, a, v, season, "dayshare", `dayshare:${day}:${bucket}:${a}`, { day, bucket });
      } catch (e) {
        // the instant cap is the hard stop; a share that can't fit is dropped, never retried into overspend
        if (!(e instanceof PointsError && e.code === "pool_exhausted")) throw e;
      }
      i++;
      await store().set(K.paceCursor(season, bucket, day), String(i), { ex: PACE_TTL_SEC });
    }
    await store().set(planKey, { ...plan, done: true }, { ex: PACE_TTL_SEC });
    return true;
  } finally {
    await store().del(K.paceLock(season, bucket, day));
  }
}

/** close every unclosed day before today (last few days, every share bucket) */
export async function closeDueDays(opts: { now?: number; deadline?: number } = {}): Promise<{ closed: number; pending: number }> {
  const now = opts.now ?? Date.now();
  const deadline = opts.deadline ?? Date.now() + 25_000;
  let closed = 0;
  let pending = 0;
  let d = utcDay(now);
  for (let i = 0; i < LOOKBACK_DAYS; i++) {
    d = previousUtcDay(d);
    const season = seasonAt(dayStart(d));
    if (season < 1) break;
    for (const b of SHARE_BUCKETS) {
      const plan = await store().get<DayClose>(K.paceClose(season, b, d));
      if (plan?.done) continue;
      if (!(await store().get<PaceDay>(K.paceDay(season, b, d)))) continue;
      if (await closeDay(season, b, d, deadline)) closed++;
      else pending++;
    }
  }
  return { closed, pending };
}

/** what a season's unclosed days still owe their participants, per bucket */
export async function seasonOwed(season: number, bucket: BucketId): Promise<number> {
  const { start, end } = seasonBounds(season);
  let total = 0;
  for (let t = start; t < end; t += DAY) total += await owed(season, bucket, utcDay(t));
  return total;
}

/** close every day of a past season (before its freeze); true when all are closed */
export async function closeSeasonDays(season: number, deadline = Date.now() + 25_000): Promise<boolean> {
  const { start, end } = seasonBounds(season);
  if (Date.now() < end) return false;
  for (let t = start; t < end; t += DAY) {
    const day = utcDay(t);
    for (const b of SHARE_BUCKETS) {
      if (!(await closeDay(season, b, day, deadline))) return false;
    }
  }
  return true;
}

export { isShareBucket };
