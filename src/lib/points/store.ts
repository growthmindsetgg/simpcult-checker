import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Points storage. The shared `kv()` in src/lib/server/store.ts has no atomic
 * read-modify-write, which money-like balances need, so points get their own
 * thin layer:
 *   - Upstash Redis (UPSTASH_REDIS_REST_URL / _TOKEN). The balance-changing
 *     step is a single Lua script, so check + write is atomic.
 *   - In-memory twin for local dev (same semantics; JS is single-threaded so
 *     each `apply` runs to completion without interleaving). Production
 *     refuses it: `store()` throws when the Upstash vars are missing.
 *
 * Every key starts with the hash tag `{pts}` so multi-key scripts stay in one
 * slot on any Redis topology.
 */

export const P = "{pts}";

export type ApplyArgs = {
  /** balance key */
  balKey: string;
  /** idempotency key */
  refKey: string;
  /** seconds the idempotency key lives (omit = forever) */
  refTtl?: number;
  /** ledger list key */
  ledgerKey: string;
  /** signed integer delta */
  delta: number;
  /** JSON-serialised ledger entry */
  entry: string;
  /** pool-emitted counter key + cap (cap < 0 = no pool check) */
  poolKey?: string;
  poolCap?: number;
  /** season leaderboard zset + member (only for pool emissions) */
  lbKey?: string;
  lbMember?: string;
  /** season stats hash + field to HINCRBY by delta */
  statsKey?: string;
  statsField?: string;
  /** ledger length to keep */
  keep: number;
};

export type ApplyResult =
  | { status: "ok"; balance: number }
  | { status: "duplicate"; balance: number; entry: string }
  | { status: "insufficient"; balance: number }
  /** a revoke larger than what the address earned in that season */
  | { status: "not_earned"; balance: number }
  | { status: "pool_exhausted"; balance: number };

export interface PointsStore {
  apply(a: ApplyArgs): Promise<ApplyResult>;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<boolean>;
  del(key: string): Promise<void>;
  incrby(key: string, by: number, ex?: number): Promise<number>;
  num(key: string): Promise<number>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  lpush(key: string, value: unknown, keep?: number): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  /** highest scores first */
  zrevrange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]>;
  /** lowest scores first */
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zscore(key: string, member: string): Promise<number | null>;
  zrevrank(key: string, member: string): Promise<number | null>;
  zcard(key: string): Promise<number>;
  /** returns how many members were newly added, per member, in order */
  saddEach(key: string, members: string[], ex?: number): Promise<boolean[]>;
  hgetall(key: string): Promise<Record<string, number>>;
  readonly persistent: boolean;
}

// ───────────────────────────── Upstash ─────────────────────────────

/*
 * KEYS: 1 bal, 2 ref, 3 ledger, 4 pool, 5 lb, 6 stats
 * ARGV: 1 delta, 2 entry, 3 poolCap (-1 = none), 4 lbMember ('' = none),
 *       5 keep, 6 statsField ('' = none), 7 refTtl seconds (0 = forever)
 * Returns {code, balance, extra}: code 1 ok, 2 duplicate, 0 refused.
 * ARGV values arrive as strings — everything numeric goes through tonumber.
 */
const APPLY_LUA = `
local prev = redis.call('GET', KEYS[2])
local bal = tonumber(redis.call('GET', KEYS[1]) or '0')
if prev then return {2, bal, prev} end
local delta = tonumber(ARGV[1])
if delta < 0 and bal + delta < 0 then return {0, bal, 'insufficient'} end
local cap = tonumber(ARGV[3])
if cap >= 0 then
  local em = tonumber(redis.call('GET', KEYS[4]) or '0')
  if delta > 0 and em + delta > cap then return {0, bal, 'pool_exhausted'} end
  if delta < 0 and ARGV[4] ~= '' then
    local earned = tonumber(redis.call('ZSCORE', KEYS[5], ARGV[4]) or '0')
    if earned + delta < 0 then return {0, bal, 'not_earned'} end
  end
  redis.call('INCRBY', KEYS[4], delta)
end
bal = redis.call('INCRBY', KEYS[1], delta)
local ttl = tonumber(ARGV[7])
if ttl > 0 then
  redis.call('SET', KEYS[2], ARGV[2], 'EX', ttl)
else
  redis.call('SET', KEYS[2], ARGV[2])
end
redis.call('LPUSH', KEYS[3], ARGV[2])
redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[5]) - 1)
if ARGV[4] ~= '' then redis.call('ZINCRBY', KEYS[5], delta, ARGV[4]) end
if ARGV[6] ~= '' then redis.call('HINCRBY', KEYS[6], ARGV[6], delta) end
return {1, bal, ''}
`;

const asString = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

class UpstashStore implements PointsStore {
  readonly persistent = true;
  constructor(private r: Redis) {}

  async apply(a: ApplyArgs): Promise<ApplyResult> {
    const keys = [
      a.balKey,
      a.refKey,
      a.ledgerKey,
      a.poolKey ?? `${P}:none`,
      a.lbKey ?? `${P}:none`,
      a.statsKey ?? `${P}:none`,
    ];
    const args = [
      String(a.delta),
      a.entry,
      String(a.poolKey && a.poolCap !== undefined ? a.poolCap : -1),
      a.lbKey && a.lbMember ? a.lbMember : "",
      String(a.keep),
      a.statsKey && a.statsField ? a.statsField : "",
      String(a.refTtl ?? 0),
    ];
    const [code, bal, extra] = await this.r.eval<string[], [number, number, unknown]>(APPLY_LUA, keys, args);
    const balance = Number(bal);
    if (Number(code) === 1) return { status: "ok", balance };
    if (Number(code) === 2) return { status: "duplicate", balance, entry: asString(extra) };
    if (extra === "pool_exhausted" || extra === "not_earned") return { status: extra, balance };
    return { status: "insufficient", balance };
  }

  async get<T>(key: string) {
    return ((await this.r.get<T>(key)) ?? null) as T | null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    const v = typeof value === "string" ? value : JSON.stringify(value);
    let res: unknown;
    if (opts?.nx && opts.ex) res = await this.r.set(key, v, { nx: true, ex: opts.ex });
    else if (opts?.nx) res = await this.r.set(key, v, { nx: true });
    else if (opts?.ex) res = await this.r.set(key, v, { ex: opts.ex });
    else res = await this.r.set(key, v);
    return res === "OK" || res === true;
  }
  async del(key: string) {
    await this.r.del(key);
  }
  async incrby(key: string, by: number, ex?: number) {
    const n = await this.r.incrby(key, by);
    if (ex && n === by) await this.r.expire(key, ex);
    return n;
  }
  async num(key: string) {
    return Number((await this.r.get<number | string>(key)) ?? 0);
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const rows = await this.r.lrange<unknown>(key, start, stop);
    return rows.map((r) => (typeof r === "string" ? (JSON.parse(r) as T) : (r as T)));
  }
  async lpush(key: string, value: unknown, keep?: number) {
    await this.r.lpush(key, asString(value));
    if (keep) await this.r.ltrim(key, 0, keep - 1);
  }
  async zadd(key: string, score: number, member: string) {
    await this.r.zadd(key, { score, member });
  }
  async zrem(key: string, member: string) {
    await this.r.zrem(key, member);
  }
  async zrevrange(key: string, start: number, stop: number) {
    const flat = await this.r.zrange<(string | number)[]>(key, start, stop, { rev: true, withScores: true });
    const out: { member: string; score: number }[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ member: String(flat[i]), score: Number(flat[i + 1]) });
    return out;
  }
  async zrange(key: string, start: number, stop: number) {
    const rows = await this.r.zrange<(string | number)[]>(key, start, stop);
    return rows.map(String);
  }
  async zscore(key: string, member: string) {
    const s = await this.r.zscore(key, member);
    return s === null || s === undefined ? null : Number(s);
  }
  async zrevrank(key: string, member: string) {
    const r = await this.r.zrevrank(key, member);
    return r === null || r === undefined ? null : Number(r);
  }
  async zcard(key: string) {
    return Number(await this.r.zcard(key));
  }
  async saddEach(key: string, members: string[], ex?: number) {
    if (members.length === 0) return [];
    const p = this.r.pipeline();
    for (const m of members) p.sadd(key, m);
    if (ex) p.expire(key, ex);
    const res = (await p.exec()) as unknown[];
    return members.map((_, i) => Number(res[i]) === 1);
  }
  async hgetall(key: string) {
    const h = (await this.r.hgetall<Record<string, number | string>>(key)) ?? {};
    return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
  }
}

// ───────────────────────────── memory ─────────────────────────────

type Entry = { v: unknown; exp: number };

class MemoryStore implements PointsStore {
  readonly persistent = false;
  private m = new Map<string, Entry>();

  private read<T>(k: string): T | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) {
      this.m.delete(k);
      return undefined;
    }
    return e.v as T;
  }
  private write(k: string, v: unknown, ex?: number) {
    const prev = this.m.get(k);
    this.m.set(k, { v, exp: ex ? Date.now() + ex * 1000 : (prev?.exp ?? 0) });
  }
  private zset(k: string): Map<string, number> {
    let z = this.read<Map<string, number>>(k);
    if (!z) {
      z = new Map();
      this.write(k, z);
    }
    return z;
  }
  private sorted(k: string, rev: boolean) {
    const z = this.read<Map<string, number>>(k) ?? new Map<string, number>();
    return [...z.entries()].sort((a, b) => (rev ? b[1] - a[1] : a[1] - b[1]) || a[0].localeCompare(b[0]));
  }

  async apply(a: ApplyArgs): Promise<ApplyResult> {
    const bal = Number(this.read(a.balKey) ?? 0);
    const prev = this.read<string>(a.refKey);
    if (prev !== undefined) return { status: "duplicate", balance: bal, entry: prev };
    if (a.delta < 0 && bal + a.delta < 0) return { status: "insufficient", balance: bal };
    if (a.poolKey && a.poolCap !== undefined && a.poolCap >= 0) {
      const em = Number(this.read(a.poolKey) ?? 0);
      if (a.delta > 0 && em + a.delta > a.poolCap) return { status: "pool_exhausted", balance: bal };
      if (a.delta < 0 && a.lbKey && a.lbMember) {
        const earned = this.read<Map<string, number>>(a.lbKey)?.get(a.lbMember) ?? 0;
        if (earned + a.delta < 0) return { status: "not_earned", balance: bal };
      }
      this.write(a.poolKey, em + a.delta);
    }
    const next = bal + a.delta;
    this.write(a.balKey, next);
    this.write(a.refKey, a.entry, a.refTtl);
    await this.lpush(a.ledgerKey, a.entry, a.keep);
    if (a.lbKey && a.lbMember) {
      const z = this.zset(a.lbKey);
      z.set(a.lbMember, (z.get(a.lbMember) ?? 0) + a.delta);
    }
    if (a.statsKey && a.statsField) {
      const h = this.read<Record<string, number>>(a.statsKey) ?? {};
      h[a.statsField] = (h[a.statsField] ?? 0) + a.delta;
      this.write(a.statsKey, h);
    }
    return { status: "ok", balance: next };
  }

  async get<T>(key: string) {
    const v = this.read<unknown>(key);
    if (v === undefined) return null;
    if (typeof v === "string") {
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as T;
      }
    }
    return v as T;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
    if (opts?.nx && this.read(key) !== undefined) return false;
    this.write(key, typeof value === "string" ? value : JSON.stringify(value), opts?.ex);
    return true;
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async incrby(key: string, by: number, ex?: number) {
    const fresh = this.read(key) === undefined;
    const n = Number(this.read(key) ?? 0) + by;
    this.write(key, n, fresh ? ex : undefined);
    return n;
  }
  async num(key: string) {
    return Number(this.read(key) ?? 0);
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const l = this.read<string[]>(key) ?? [];
    const end = stop < 0 ? l.length + stop + 1 : stop + 1;
    return l.slice(start, end).map((s) => JSON.parse(s) as T);
  }
  async lpush(key: string, value: unknown, keep?: number) {
    const l = [asString(value), ...(this.read<string[]>(key) ?? [])];
    this.write(key, keep ? l.slice(0, keep) : l);
  }
  async zadd(key: string, score: number, member: string) {
    this.zset(key).set(member, score);
  }
  async zrem(key: string, member: string) {
    this.zset(key).delete(member);
  }
  async zrevrange(key: string, start: number, stop: number) {
    const rows = this.sorted(key, true);
    const end = stop < 0 ? rows.length + stop + 1 : stop + 1;
    return rows.slice(start, end).map(([member, score]) => ({ member, score }));
  }
  async zrange(key: string, start: number, stop: number) {
    const rows = this.sorted(key, false);
    const end = stop < 0 ? rows.length + stop + 1 : stop + 1;
    return rows.slice(start, end).map(([m]) => m);
  }
  async zscore(key: string, member: string) {
    return this.read<Map<string, number>>(key)?.get(member) ?? null;
  }
  async zrevrank(key: string, member: string) {
    const i = this.sorted(key, true).findIndex(([m]) => m === member);
    return i < 0 ? null : i;
  }
  async zcard(key: string) {
    return this.read<Map<string, number>>(key)?.size ?? 0;
  }
  async saddEach(key: string, members: string[], ex?: number) {
    let s = this.read<Set<string>>(key);
    if (!s) {
      s = new Set();
      this.write(key, s, ex);
    }
    return members.map((m) => {
      if (s.has(m)) return false;
      s.add(m);
      return true;
    });
  }
  async hgetall(key: string) {
    return { ...(this.read<Record<string, number>>(key) ?? {}) };
  }
}

declare global {
  var __simpPointsStore: PointsStore | undefined;
}

export function store(): PointsStore {
  if (globalThis.__simpPointsStore) return globalThis.__simpPointsStore;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    globalThis.__simpPointsStore = new UpstashStore(new Redis({ url, token }));
  } else {
    // called per request, never at import time, so `next build` is unaffected
    if (process.env.NODE_ENV === "production") {
      throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN must be set in production");
    }
    globalThis.__simpPointsStore = new MemoryStore();
  }
  return globalThis.__simpPointsStore;
}
