import "server-only";
import { Redis } from "@upstash/redis";

/**
 * Key/value store.
 *  - Production: Upstash Redis (set UPSTASH_REDIS_REST_URL / _TOKEN — Vercel
 *    Marketplace → Upstash creates these for you).
 *  - Local dev without Redis: in-memory Map (NOT safe on serverless — nonces
 *    and Telegram links won't persist between invocations).
 */
export interface KV {
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** get-and-delete (atomic on Redis) — used to consume single-use nonces */
  take<T = string>(key: string): Promise<T | null>;
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
    const v = await this.get<T>(k);
    this.m.delete(k);
    return v;
  }
  async keys(prefix: string) {
    return [...this.m.keys()].filter((k) => k.startsWith(prefix));
  }
}

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
  if (globalThis.__simpKV) return globalThis.__simpKV;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    globalThis.__simpKV = new UpstashKV(new Redis({ url, token }));
  } else {
    if (process.env.NODE_ENV === "production") {
      console.warn("[simp] UPSTASH_REDIS_* not set — using in-memory store (not persistent!)");
    }
    globalThis.__simpKV = new MemoryKV();
  }
  return globalThis.__simpKV;
}
