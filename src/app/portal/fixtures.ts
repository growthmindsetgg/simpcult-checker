"use client";

/**
 * Dev-only design fixtures for /portal and /portal/admin.
 *
 *   /portal?fixture=holder | punched | fresh | nonholder | signin | signedout
 *                   | warming | loading | error | admin
 *
 * They stand in for the API at the transport layer (`api()` in ./lib), so the
 * real components render with fake data. `FIXTURES_ENABLED` is false in
 * production builds (NODE_ENV is inlined), so `readFixture()` always returns
 * null there and the fake API can never answer.
 */

import { useSyncExternalStore } from "react";
import { POINTS_CONFIG, POOLS, checkinReward, poolBudget, seasonAt, seasonBounds } from "@/lib/points/config";
import type { LedgerEntry } from "@/lib/points/ledger";
import type { Submission } from "@/lib/points/submissions";
import { ApiError } from "./api-error";

export const FIXTURES_ENABLED = process.env.NODE_ENV !== "production";

export const FIXTURE_NAMES = [
  "holder",
  "punched",
  "fresh",
  "nonholder",
  "signin",
  "signedout",
  "warming",
  "loading",
  "error",
  "admin",
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

export function readFixture(): FixtureName | null {
  if (!FIXTURES_ENABLED || typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("fixture");
  return (FIXTURE_NAMES as readonly string[]).includes(v ?? "") ? (v as FixtureName) : null;
}

const noop = () => () => {};
/** the active fixture, hydration-safe (null on the server and first paint) */
export function useFixture(): FixtureName | null {
  return useSyncExternalStore(noop, readFixture, () => null);
}

const ME_ADDR = "0x7a3c9e2f41b05d8a6c1e9f3b2d4a5c6e7f80911b";

/** what wagmi + the session would say for this fixture */
export function fixtureSession(f: FixtureName): { connected: boolean; address: string | null; signedIn: boolean } {
  if (f === "signedout") return { connected: false, address: null, signedIn: false };
  if (f === "signin") return { connected: true, address: ME_ADDR, signedIn: false };
  return { connected: true, address: ME_ADDR, signedIn: true };
}

// ─────────────────────────── fake state ───────────────────────────

const HOUR = 3_600_000;
const addr = (seed: number) => `0x${(seed * 2654435761).toString(16).padStart(8, "0").repeat(5).slice(0, 40)}`;

type State = {
  balance: number;
  streak: number;
  checkedIn: boolean;
  x: { handle: string; verified: boolean; code?: string } | null;
  ledger: LedgerEntry[];
  subs: Submission[];
  holder: boolean;
};

let state: { name: FixtureName; s: State } | null = null;

function entry(amount: number, reason: string, agoH: number, meta?: Record<string, unknown>): LedgerEntry {
  const ts = Date.now() - agoH * HOUR;
  return {
    id: `e:${reason}:${ts}`,
    refId: `${reason}:${ts}`,
    address: ME_ADDR,
    amount,
    reason,
    pool: amount > 0 && !reason.startsWith("game:") ? "active" : null,
    season: Math.max(1, seasonAt()),
    ts,
    ...(meta ? { meta } : {}),
  };
}

function sub(partial: Partial<Submission> & Pick<Submission, "kind" | "status">, agoH: number): Submission {
  const id = `${(Math.random() * 1e8).toString(16).padStart(8, "0").slice(0, 8)}-4b1d-4c2a-9e7f-${agoH.toString().padStart(12, "0")}`;
  return { id, address: ME_ADDR, createdAt: Date.now() - agoH * HOUR, season: Math.max(1, seasonAt()), ...partial };
}

function build(name: FixtureName): State {
  if (name === "fresh") {
    return { balance: 0, streak: 0, checkedIn: false, x: null, ledger: [], subs: [], holder: true };
  }
  if (name === "nonholder") {
    return { balance: 0, streak: 0, checkedIn: false, x: null, ledger: [], subs: [], holder: false };
  }
  const ledger = [
    entry(5_938 * 2, "holding", 3, { tokens: 2 }),
    entry(-500, "game:slot:bet", 5),
    entry(1_750, "game:slot:win", 5),
    entry(5_000, "x_post", 9),
    entry(1_200, "checkin", 27, { streak: 3 }),
    entry(5_938 * 2, "holding", 27, { tokens: 2 }),
    entry(1_100, "checkin", 51, { streak: 2 }),
    entry(25_000, "alpha", 60),
    entry(1_000, "checkin", 75, { streak: 1 }),
  ];
  const balance = ledger.reduce((a, e) => a + e.amount, 0);
  return {
    balance,
    streak: 3,
    checkedIn: name === "punched",
    x: { handle: "simpmaxxing", verified: true },
    ledger,
    holder: true,
    subs: [
      sub({ kind: "x_post", status: "pending", url: "https://x.com/simpmaxxing/status/1861234567890123456", handle: "simpmaxxing" }, 1),
      sub({ kind: "x_post", status: "approved", reward: 5_000, auto: true, url: "https://x.com/simpmaxxing/status/1861111111111111111" }, 9),
      sub({ kind: "alpha", status: "approved", reward: 25_000, title: "mapped every simp cult holder's favourite monad app" }, 60),
      sub({ kind: "alpha", status: "rejected", title: "gm", reviewNote: "a gm is not alpha, sadly" }, 70),
    ],
  };
}

function cur(name: FixtureName): State {
  if (!state || state.name !== name) state = { name, s: build(name) };
  return state.s;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────── fake API ───────────────────────────

export async function fixtureApi<T>(url: string, init?: RequestInit): Promise<T> {
  const name = readFixture()!;
  const path = url.split("?")[0];
  const method = (init?.method ?? "GET").toUpperCase();
  await wait(name === "loading" ? 1e9 : 260);
  if (name === "warming") throw new ApiError("the machine is warming up — back soon", 503, "storage-unconfigured");
  const s = cur(name);
  const season = Math.max(1, seasonAt());
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};

  if (path === "/api/points/season") {
    const { start, end } = seasonBounds(season);
    const emitted = { active: 4_812_440, holding: 7_481_880, monad: 0 };
    return {
      season,
      live: seasonAt() >= 1,
      start,
      end,
      pools: POOLS.map((pool) => ({ pool, budget: poolBudget(pool, season), emitted: emitted[pool] })),
      simps: 212,
      current: seasonAt(),
      now: Date.now(),
    } as T;
  }
  if (path === "/api/points/leaderboard") {
    const pts = [412_300, 388_150, 301_900, 254_000, 199_420, 176_300, 150_050, 120_000, 98_400, 71_250, 64_000, 52_900];
    const rows = pts.map((points, i) => ({ rank: i + 1, address: i === 6 ? ME_ADDR : addr(i + 3), points }));
    return { season, rows } as T;
  }
  if (path === "/api/points/me") {
    if (name === "error") throw new ApiError("something broke on our side — try again", 500);
    const earned = s.ledger.filter((e) => e.pool).reduce((a, e) => a + e.amount, 0);
    return {
      address: ME_ADDR,
      balance: s.balance,
      holder: s.holder,
      nfts: s.holder ? 2 : 0,
      monadCard: { enabled: false, holder: false },
      checkin: {
        checkedInToday: s.checkedIn,
        streak: s.streak,
        nextReward: checkinReward(season, s.streak + 1),
      },
      x: s.x,
      caps: { x_post: 2, simp_post: 3, alpha: 3 },
      submissions: s.subs,
      rank: earned > 0 ? { rank: 7, points: earned } : { rank: null, points: 0 },
      admin: name === "admin",
    } as T;
  }
  if (path === "/api/points/ledger") return { entries: s.ledger } as T;
  if (path === "/api/points/checkin" && method === "POST") {
    if (s.checkedIn) throw new ApiError("already checked in today — back after midnight UTC", 409, "already");
    s.streak += 1;
    const amount = checkinReward(season, s.streak);
    s.checkedIn = true;
    s.balance += amount;
    s.ledger = [entry(amount, "checkin", 0, { streak: s.streak }), ...s.ledger];
    return { balance: s.balance, amount, streak: s.streak, duplicate: false } as T;
  }
  if (path === "/api/points/x-handle" && method === "POST") {
    if (typeof body.handle === "string") s.x = { handle: body.handle.replace(/^@/, ""), verified: false, code: "simp-4f2a9c" };
    else if (s.x) s.x = { handle: s.x.handle, verified: true };
    return s.x as T;
  }
  if (path === "/api/points/submit" && method === "POST") {
    const kind = body.kind as Submission["kind"];
    const next =
      kind === "alpha"
        ? sub({ kind, status: "pending", title: String(body.title ?? "") }, 0)
        : s.x?.verified
          ? sub({ kind, status: "approved", auto: true, reward: POINTS_CONFIG.rewards.xPost.reward, url: String(body.url) }, 0)
          : sub({ kind, status: "pending", url: String(body.url) }, 0);
    s.subs = [next, ...s.subs];
    if (next.status === "approved") {
      s.balance += next.reward ?? 0;
      s.ledger = [entry(next.reward ?? 0, kind, 0), ...s.ledger];
    }
    return { submission: next } as T;
  }
  if (path === "/api/admin/points/queue") {
    return {
      pending: [
        sub({ kind: "x_post", status: "pending", url: "https://x.com/degen_simp/status/1861234567890123456", handle: "degen_simp", handleVerified: false, check: { reachable: true, author: "degen_simp", keyword: true } }, 2),
        sub({ kind: "alpha", status: "pending", title: "a dune board of every simp cult sale since mint", note: "updates hourly. free to fork.", proof: ["https://dune.com/simpcult/sales"] }, 20),
      ],
      reviewed: s.subs.filter((x) => x.status !== "pending").map((x) => ({ ...x, reviewedBy: addr(1), reviewedAt: x.createdAt + HOUR })),
      rewards: {
        x_post: { default: 5_000, min: 1, max: 10_000 },
        simp_post: { default: 2_500, min: 1, max: 5_000 },
        alpha: { default: 25_000, min: 1_000, max: 250_000 },
      },
    } as T;
  }
  if (path === "/api/admin/points/stats") {
    return {
      overview: {
        season,
        pools: POOLS.map((pool) => ({ pool, budget: poolBudget(pool, season), emitted: pool === "monad" ? 0 : 4_000_000 })),
        house: { out: 120_400, in: 151_900 },
        simps: 212,
      },
      seasonBudget: POOLS.reduce((a, p) => a + poolBudget(p, season), 0),
      holdingRatePerNftPerDay: 5_938,
      lastHoldingRun: { day: "today", owners: 163, tokensPaid: 421, pointsPaid: 421 * 5_938, errors: [] },
      persistent: false,
    } as T;
  }
  if (path === "/api/admin/points/settle") return { settlement: null } as T;
  throw new ApiError(`fixture has no ${method} ${path}`, 404);
}
