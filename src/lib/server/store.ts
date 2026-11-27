import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Key/value store.
 *  - Production: Upstash Redis (set UPSTASH_REDIS_REST_URL / _TOKEN — Vercel
 *    Marketplace → Upstash creates these for you).
 *  - Local dev without Redis: in-memory Map (NOT safe on serverless — nonces
 *    and Telegram links won't persist between invocations). Production
 *    refuses to start on it: `kv()` throws when the Upstash vars are missing.
 */
/**
 * Thrown (per request) when production has no Upstash credentials. Carries
 * `code: "storage-unconfigured"` so route handlers can answer a clean 503
 * instead of crashing. Points' own store throws the same error.
 */
export class StorageUnconfiguredError extends Error {
  readonly code = "storage-unconfigured";
  constructor() {
    super("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN must be set in production");
    this.name = "StorageUnconfiguredError";
  }
}

export interface KV {
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** get-and-delete (atomic on Redis) — used to consume single-use nonces */
  take<T = string>(key: string): Promise<T | null>;
  /** set only if the key is absent (atomic on Redis). True when this call wrote it. */
  setnx(key: string, value: unknown, ttlSec?: number): Promise<boolean>;
  /** atomic INCR; the TTL is set when the key is created (fixed window) */
  incr(key: string, ttlSec: number): Promise<number>;
  keys(prefix: string): Promise<string[]>;
}

class MemoryKV implements KV {
  private m = new Map<string, { v: unknown; exp: number }>();
  private live(k: string) {
    const e = this.m.get(k);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) {
      this.m.delete(k);
      return null;
    }
    return e;
  }
  async get<T>(k: string) {
    return (this.live(k)?.v as T) ?? null;
  }
  async set(k: string, v: unknown, ttl?: number) {
    this.m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 });
  }
  async del(k: string) {
    this.m.delete(k);
  }
  async take<T>(k: string) {
    // no await between read and delete, so two concurrent takes can't both win
    const v = (this.live(k)?.v as T) ?? null;
    this.m.delete(k);
    return v;
  }
  async setnx(k: string, v: unknown, ttl?: number) {
    // no await between check and write, so two concurrent calls can't both win
    if (this.live(k)) return false;
    this.m.set(k, { v, exp: ttl ? Date.now() + ttl * 1000 : 0 });
    return true;
  }
  async incr(k: string, ttl: number) {
    const e = this.live(k);
    const n = Number(e?.v ?? 0) + 1;
    this.m.set(k, { v: n, exp: e ? e.exp : Date.now() + ttl * 1000 });
    return n;
  }
  async keys(prefix: string) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix));
  }
}

const INCR_LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

class UpstashKV implements KV {
  constructor(private r: Redis) {}
  async get<T>(k: string) {
    return (await this.r.get<T>(k)) ?? null;
  }
  async set(k: string, v: unknown, ttl?: number) {
    if (ttl) await this.r.set(k, v, { ex: ttl });
    else await this.r.set(k, v);
  }
  async del(k: string) {
    await this.r.del(k);
  }
  async take<T>(k: string) {
    return (await this.r.getdel<T>(k)) ?? null;
  }
  async setnx(k: string, v: unknown, ttl?: number) {
    const r = ttl ? await this.r.set(k, v, { nx: true, ex: ttl }) : await this.r.set(k, v, { nx: true });
    return r === "OK";
  }
  async incr(k: string, ttl: number) {
    return Number(await this.r.eval<string[], number>(INCR_LUA, [k], [String(ttl)]));
  }
  async keys(prefix: string) {
    const out: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.r.scan(cursor, { match: `${prefix}*`, count: 200 });
      out.push(...batch);
      cursor = String(next);
    } while (cursor !== "0");
    return out;
  }
}

declare global {
  var __simpKV: KV | undefined;
}

export function kv(): KV {
  const cached = globalThis.__simpKV;
  if (cached && typeof cached.setnx === "function") return cached;
  if (cached instanceof Object && "m" in cached) {
    // dev hot reload only: an in-memory store built by an older version of this
    // module keeps its data but gains the current methods
    const next = new MemoryKV();
    Object.assign(next, { m: (cached as unknown as { m: unknown }).m });
    globalThis.__simpKV = next;
    return next;
  }
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    globalThis.__simpKV = new UpstashKV(new Redis({ url, token }));
  } else {
    // called per request, never at import time, so `next build` is unaffected
    if (process.env.NODE_ENV === "production") throw new StorageUnconfiguredError();
    globalThis.__simpKV = new MemoryKV();
  }
  return globalThis.__simpKV;
}
