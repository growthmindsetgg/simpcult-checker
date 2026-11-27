import "server-only";
import { createHmac } from "node:crypto";
import { POINTS_CONFIG, seasonAt, seasonBounds } from "./config";
import { store } from "./store";
import { K } from "./keys";
import { SKIP_OWNERS, ownerMap } from "./chain";

/**
 * Random holding snapshots: `POINTS_CONFIG.holding.snapshots` (5) a season.
 *
 * Times: each one is HMAC-SHA256(secret, "simp-snapshot:<season>:<i>")
 * mapped uniformly onto [season start + 12h, season end − 26h], so nobody
 * without the server secret can know them, yet every server instance agrees
 * on them without storing anything. The window ends 26h before the season
 * so the daily cron always gets a chance to take the last one in time.
 * Secret: POINTS_SNAPSHOT_SECRET, else CRON_SECRET, else SESSION_SECRET (any
 * ≥16 chars). Production with none of them takes no snapshots (fails
 * closed, logged) rather than use a guessable schedule.
 *
 * Taking: a snapshot is taken by whichever comes first once its time has
 * passed — any points request (`after()` in the hot routes) or the daily
 * holding cron — under an NX lock, so it lands close to its random time
 * when the site has traffic. Each record logs the scheduled and actual
 * time and every token → owner. A wallet that has NFT-days this season but
 * holds no NFT at a snapshot goes into `holdOut`: no holding drop.
 * The API only ever reveals snapshots already taken, never upcoming times.
 */

const H = 3_600_000;
const START_PAD = 12 * H;
const END_PAD = 26 * H;

export type SnapshotRecord = {
  season: number;
  index: number;
  scheduledAt: number;
  takenAt: number;
  holders: number;
  tokens: number;
  /** wallets with NFT-days that held nothing at this snapshot */
  missing: string[];
  /** owner → tokenIds at the snapshot */
  owners: Record<string, number[]>;
};

let warned = false;

function snapshotSecret(): string | null {
  const s = process.env.POINTS_SNAPSHOT_SECRET || process.env.CRON_SECRET || process.env.SESSION_SECRET || "";
  if (s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") {
    if (!warned) console.error("[points] no snapshot secret set (POINTS_SNAPSHOT_SECRET) — holding snapshots are off");
    warned = true;
    return null;
  }
  return "dev-only-snapshot-secret-not-for-production";
}

/** the season's snapshot times, ascending; null when no secret is configured */
export function snapshotSchedule(season: number): number[] | null {
  const secret = snapshotSecret();
  if (!secret || season < 1) return null;
  const { start, end } = seasonBounds(season);
  const lo = start + START_PAD;
  const span = end - END_PAD - lo;
  const out: number[] = [];
  for (let i = 0; i < POINTS_CONFIG.holding.snapshots; i++) {
    const h = createHmac("sha256", secret).update(`simp-snapshot:${season}:${i}`).digest();
    const frac = h.readUIntBE(0, 6) / 2 ** 48;
    out.push(Math.floor(lo + frac * span));
  }
  return out.sort((a, b) => a - b);
}

declare global {
  var __simpSnapCheckedAt: number | undefined;
}

/**
 * Take every snapshot whose time has passed and isn't taken yet. Cheap when
 * nothing is due (one counter read, at most every 20s per instance unless
 * `force`). Returns the snapshots it took.
 */
export async function maybeSnapshot(opts: { force?: boolean } = {}): Promise<SnapshotRecord[]> {
  const now = Date.now();
  if (!opts.force && globalThis.__simpSnapCheckedAt && now - globalThis.__simpSnapCheckedAt < 20_000) return [];
  globalThis.__simpSnapCheckedAt = now;
  const season = seasonAt(now);
  const sched = snapshotSchedule(season);
  if (!sched) return [];
  const due = sched.filter((t) => t <= now).length;
  if (due === 0) return [];
  if ((await store().num(K.snapCount(season))) >= due) return [];
  if (!(await store().set(K.snapLock(season), "1", { nx: true, ex: 60 }))) return [];
  try {
    const taken = await store().num(K.snapCount(season));
    if (taken >= due) return [];
    const map = await ownerMap({ fresh: true });
    const owners: Record<string, number[]> = {};
    let tokens = 0;
    for (const [o, ids] of Object.entries(map)) {
      if (SKIP_OWNERS.has(o) || ids.length === 0) continue;
      owners[o] = ids;
      tokens += ids.length;
    }
    const counted = await store().zrevrange(K.nftDays(season), 0, -1);
    const missing = counted.filter((r) => r.score > 0 && !owners[r.member]).map((r) => r.member);
    if (missing.length) await store().saddEach(K.holdOut(season), missing);
    const takenAt = Date.now();
    const out: SnapshotRecord[] = [];
    for (let i = taken; i < due; i++) {
      const rec: SnapshotRecord = {
        season,
        index: i + 1,
        scheduledAt: sched[i],
        takenAt,
        holders: Object.keys(owners).length,
        tokens,
        missing,
        owners,
      };
      await store().lpush(K.snaps(season), rec, POINTS_CONFIG.holding.snapshots * 2);
      out.push(rec);
    }
    await store().incrby(K.snapCount(season), due - taken);
    if (out.length) {
      console.info(`[points] season ${season} snapshot ${due}/${sched.length} taken: ${tokens} tokens, ${missing.length} missing`);
    }
    return out;
  } finally {
    await store().del(K.snapLock(season));
  }
}

/** taken snapshots, oldest first (owner maps stripped unless `full`) */
export async function takenSnapshots(season: number, full = false) {
  const rows = await store().lrange<SnapshotRecord>(K.snaps(season), 0, -1);
  return rows
    .reverse()
    .map((r) => (full ? r : { ...r, owners: undefined, missing: r.missing.length }));
}

export async function snapshotCount(season: number): Promise<{ taken: number; total: number }> {
  return { taken: await store().num(K.snapCount(Math.max(1, season))), total: POINTS_CONFIG.holding.snapshots };
}
