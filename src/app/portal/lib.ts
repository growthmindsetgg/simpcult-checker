"use client";

import { useEffect, useState } from "react";
import type { LedgerEntry } from "@/lib/points/ledger";
import type { Submission, SubmissionKind } from "@/lib/points/submissions";
import type { BucketId, PoolId } from "@/lib/points/config";
import { ApiError } from "./api-error";
import { FIXTURES_ENABLED, fixtureApi, readFixture } from "./fixtures";

export { ApiError };
export type { LedgerEntry, Submission, SubmissionKind, PoolId, BucketId };

export type Category = "holder" | "card" | "active_monad" | "none";

export type TodayPool = {
  bucket: BucketId;
  day: string;
  allowance: number;
  instantPaid: number;
  left: number;
  participants: number;
  totalUnits: number;
  closesAt: number;
  /** the most one wallet can get today (instant + share) */
  walletCap?: number;
  mine?: { units: number; instant?: number; provisional: number; roomLeft?: number };
};

export type Welcome =
  | { status: "granted"; amount: number; at: number }
  | { status: "pending"; amount: number; eta: number | null; reason: "holding_time" | "budget" | "season_closed" }
  | { status: "not_eligible"; reason: "not_in_season" | "tokens_used" };

export type Me = {
  address: string;
  balance: number;
  holder: boolean;
  nfts: number;
  monadCard: { enabled: boolean; holder: boolean };
  category: Category;
  categoryLabel: string;
  categories: { holder: boolean; card: boolean; activeMonad: boolean };
  txCount: number | null;
  telegram: { bound: boolean; multiplier: number; bonus: number };
  welcome: Welcome;
  seasonPost: { season: number; windowStart: number; windowEnd: number; open: boolean; state: "none" | "pending" | "approved" };
  holding: {
    nftDays: number;
    totalNftDays: number;
    missedSnapshot: boolean;
    txOk: boolean | null;
    snapshots: { taken: number; total: number };
  };
  projected: {
    earned: Partial<Record<BucketId, number>>;
    share: Partial<Record<BucketId, number>>;
    total: number;
    basis: "posters" | "if_all_post";
    posters: number;
    /** false: the estimate leaves out the daily budget that will go unspent (added at season end) */
    includesUnspentDaily?: boolean;
  };
  /** today's daily split in the wallet's sub-pool (null when it can't earn) */
  today:
    | null
    | (Omit<TodayPool, "walletCap" | "mine"> & {
        checkinNow: number | null;
        postNow: number;
        /** the most one wallet can take from today's pool (5%) */
        maxToday: number;
        walletCap: number;
        mine: { units: number; instant: number; provisional: number; roomLeft: number };
        yesterdayShare?: number | null;
      });
  checkin: { checkedInToday: boolean; streak: number; nextReward: number };
  x: { handle: string; verified: boolean; code?: string } | null;
  caps: Record<SubmissionKind, number>;
  submissions: Submission[];
  rank: { rank: number | null; points: number };
  admin: boolean;
};

export type SeasonInfo = {
  season: number;
  live: boolean;
  start: number;
  end: number;
  pools: { pool: PoolId; budget: number; emitted: number }[];
  buckets?: {
    bucket: BucketId;
    pool: PoolId;
    budget: number;
    instantCap: number;
    instantPaid: number;
    endPot: number;
    endPaid: number;
    basis: number;
    open: boolean;
  }[];
  finalWindow?: { start: number; end: number; open: boolean };
  snapshots?: { taken: number; total: number };
  today?: TodayPool[];
  telegramMultiplier?: number;
  simps: number;
  current: number;
  now: number;
};

export type LeaderRow = { rank: number; address: string; points: number };

/** production with no storage / session secret yet: show "warming up" */
export function isWarming(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 503 &&
    (e.code === "storage-unconfigured" || e.code === "session-unconfigured")
  );
}

/** retry flaky network a little, but never auth refusals or the warm-up gate */
export function retryPolicy(count: number, e: unknown): boolean {
  if (e instanceof ApiError && [400, 401, 403, 404, 409, 429, 503].includes(e.status)) return false;
  return count < 2;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  // dev-only design fixtures (?fixture=…); compiled out of production builds
  if (FIXTURES_ENABLED && readFixture()) return fixtureApi<T>(url, init);
  const r = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const d = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new ApiError(d.error ?? `request failed (${r.status})`, r.status, d.code);
  return d as T;
}

export const post = <T,>(url: string, body: unknown) => api<T>(url, { method: "POST", body: JSON.stringify(body) });

const nf = new Intl.NumberFormat("en-US");
export const fmt = (n: number) => nf.format(Math.round(n));
export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** the community pool's id is still "monad" (stable key); it shows as "community" */
export const POOL_LABEL: Record<PoolId, string> = {
  active: "Active simps",
  holding: "Holding",
  monad: "Community",
};

export const BUCKET_LABEL: Record<BucketId, string> = {
  active: "active simps",
  holding: "holding",
  card: "monad card holders",
  amu: "active monad users",
};

export const KIND_LABEL: Record<SubmissionKind, string> = {
  x_post: "x post",
  simp_post: "simp post",
  alpha: "alpha",
  season_post: "season post",
};

export function reasonLabel(e: LedgerEntry): string {
  const r = e.reason;
  const x3 = Number(e.meta?.multiplier ?? 1) > 1 ? ` · ${e.meta?.multiplier}× telegram` : "";
  if (r === "checkin") return `check-in${e.meta?.streak ? ` · day ${e.meta.streak}` : ""}${x3}`;
  if (r === "holding") return `holding · ${e.meta?.tokens ?? "?"} simp${e.meta?.tokens === 1 ? "" : "s"}`;
  if (r === "holding_drop") return `holding drop · season ${e.season}`;
  if (r === "season_share") return `season ${e.season} share · ${e.bucket ? BUCKET_LABEL[e.bucket] : "pool"}`;
  if (r === "welcome") return "welcome bonus";
  if (r === "dayshare") return `daily share · ${String(e.meta?.day ?? "").slice(5)}`;
  if (r === "x_post") return `x post paid${x3}`;
  if (r === "simp_post") return `simp post paid${x3}`;
  if (r === "alpha") return `alpha paid${x3}`;
  if (r === "admin:grant") return `bonus${e.meta?.note ? ` · ${String(e.meta.note)}` : ""}`;
  if (r === "admin:revoke") return `correction${e.meta?.note ? ` · ${String(e.meta.note)}` : ""}`;
  if (r.startsWith("game:")) {
    const [, game, what] = r.split(":");
    return `${game.replace(/[-_]/g, " ")}${what ? ` · ${what}` : ""}`;
  }
  return r;
}

/** ticking clock — `null` until mounted so SSR and first paint agree */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function countdown(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** receipt-style UTC stamp: "11-26 03:12" */
export function stamp(ts: number): string {
  return new Date(ts).toISOString().slice(5, 16).replace("T", " ");
}

/** short slip number from a submission id: "a1b2c3" */
export const slipNo = (id: string) => id.replace(/-/g, "").slice(0, 6);
