"use client";

import { useEffect, useState } from "react";
import type { LedgerEntry } from "@/lib/points/ledger";
import type { Submission, SubmissionKind } from "@/lib/points/submissions";
import type { PoolId } from "@/lib/points/config";

export type { LedgerEntry, Submission, SubmissionKind, PoolId };

export type Me = {
  address: string;
  balance: number;
  holder: boolean;
  nfts: number;
  monadCard: { enabled: boolean; holder: boolean };
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
  simps: number;
  current: number;
  now: number;
};

export type LeaderRow = { rank: number; address: string; points: number };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
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

export const POOL_LABEL: Record<PoolId, string> = {
  active: "active simps",
  holding: "holding",
  monad: "monad card",
};

export const KIND_LABEL: Record<SubmissionKind, string> = {
  x_post: "x post",
  simp_post: "simp post",
  alpha: "alpha",
};

export function reasonLabel(e: LedgerEntry): string {
  const r = e.reason;
  if (r === "checkin") return `daily check-in${e.meta?.streak ? ` · ${e.meta.streak}-day streak` : ""}`;
  if (r === "holding") return `holding · ${e.meta?.tokens ?? "?"} simp${e.meta?.tokens === 1 ? "" : "s"}`;
  if (r === "x_post") return "x post approved";
  if (r === "simp_post") return "simp post approved";
  if (r === "alpha") return "alpha approved";
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
