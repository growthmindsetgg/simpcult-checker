"use client";

/**
 * Dev-only design fixtures for /portal and /portal/admin.
 *
 *   /portal?fixture=holder | punched | fresh | nonholder | community | finalpost
 *                   | signin | signedout | warming | loading | error | admin
 *
 * They stand in for the API at the transport layer (`api()` in ./lib), so the
 * real components render with fake data. `FIXTURES_ENABLED` is false in
 * production builds (NODE_ENV is inlined), so `readFixture()` always returns
 * null there and the fake API can never answer.
 */

import { useSyncExternalStore } from "react";
import {
  BUCKETS,
  BUCKET_POOL,
  POINTS_CONFIG,
  POOLS,
  bucketBudget,
  checkinReward,
  endPot,
  finalWindow,
  instantCap,
  poolBudget,
  seasonAt,
  seasonBounds,
} from "@/lib/points/config";
import type { LedgerEntry } from "@/lib/points/ledger";
import type { Submission } from "@/lib/points/submissions";
import { ApiError } from "./api-error";

export const FIXTURES_ENABLED = process.env.NODE_ENV !== "production";

export const FIXTURE_NAMES = [
  "holder",
  "punched",
  "fresh",
  "nonholder",
  "community",
  "finalpost",
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
  /** an active Monad user (no NFT, 50+ txs) */
  community?: boolean;
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
  if (name === "community") {
    return {
      balance: 2_600,
      streak: 1,
      checkedIn: false,
      x: { handle: "monadmaxi", verified: true },
      ledger: [entry(100, "welcome", 30), entry(2_500, "simp_post", 20)],
      subs: [],
      holder: false,
      community: true,
    };
  }
  const ledger = [
    entry(1_000, "welcome", 3),
    entry(-500, "game:slot:bet", 5),
    entry(1_750, "game:slot:win", 5),
    entry(5_000, "x_post", 9),
    entry(1_200, "checkin", 27, { streak: 3 }),
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
    const emitted = { active: 4_812_440, holding: 0, monad: 41_300 };
    const w = name === "finalpost" ? { start: Date.now() - 6 * HOUR, end: Date.now() + 42 * HOUR } : finalWindow(season);
    return {
      season,
      live: seasonAt() >= 1,
      start,
      end,
      pools: POOLS.map((pool) => ({ pool, budget: poolBudget(pool, season), emitted: emitted[pool] })),
      buckets: BUCKETS.map((bucket) => ({
        bucket,
        pool: BUCKET_POOL[bucket],
        budget: bucketBudget(bucket, season),
        instantCap: instantCap(bucket, season),
        instantPaid: bucket === "active" ? emitted.active : bucket === "amu" ? emitted.monad : 0,
        endPot: endPot(bucket, season),
        endPaid: 0,
        basis: bucket === "holding" ? 1_264 : bucket === "active" ? emitted.active : 0,
        open: true,
      })),
      finalWindow: { ...w, open: Date.now() >= w.start && Date.now() < w.end },
      snapshots: { taken: 1, total: 5 },
      telegramMultiplier: POINTS_CONFIG.telegramMultiplier,
      simps: 212,
      current: seasonAt(),
      now: Date.now(),
    } as T;
  }
  if (path === "/api/points/leaderboard") {
    const pts = [412_300, 388_150, 301_900, 254_000, 199_420, 176_300, 150_050, 120_000, 98_400, 71_250, 64_000, 52_900];
    // fresh: day one of a season, a short board (the rest prints as blank rows)
    const rows = (name === "fresh" ? pts.slice(9) : pts).map((points, i) => ({ rank: i + 1, address: i === 6 ? ME_ADDR : addr(i + 3), points }));
    return { season, rows } as T;
  }
  if (path === "/api/points/me") {
    if (name === "error") throw new ApiError("something broke on our side — try again", 500);
    const earned = s.ledger.filter((e) => e.pool).reduce((a, e) => a + e.amount, 0);
    const category = s.holder ? "holder" : s.community ? "active_monad" : "none";
    const w = name === "finalpost" ? { start: Date.now() - 6 * HOUR, end: Date.now() + 42 * HOUR } : finalWindow(season);
    return {
      address: ME_ADDR,
      balance: s.balance,
      holder: s.holder,
      nfts: s.holder ? 2 : 0,
      monadCard: { enabled: false, holder: false },
      category,
      categoryLabel: { holder: "simp cult holder", active_monad: "active monad user", none: "not in this season" }[category],
      categories: { holder: s.holder, card: false, activeMonad: !!s.community },
      txCount: s.community ? 214 : s.holder ? 37 : 12,
      telegram: name === "punched" ? { bound: true, multiplier: 3, bonus: 3 } : { bound: false, multiplier: 1, bonus: 3 },
      welcome:
        name === "fresh"
          ? { status: "pending", amount: 1_000, eta: Date.now() + 41 * 60_000, reason: "holding_time" }
          : s.holder
            ? { status: "granted", amount: 1_000, at: Date.now() - 80 * HOUR }
            : s.community
              ? { status: "granted", amount: 100, at: Date.now() - 30 * HOUR }
              : { status: "not_eligible", reason: "not_in_season" },
      seasonPost: {
        season,
        windowStart: w.start,
        windowEnd: w.end,
        open: Date.now() >= w.start && Date.now() < w.end,
        state: "none",
      },
      holding: {
        nftDays: s.holder ? 6 : 0,
        totalNftDays: 1_264,
        missedSnapshot: false,
        txOk: true,
        snapshots: { taken: 1, total: 5 },
      },
      projected: s.holder
        ? { earned: { active: earned, holding: 6 }, share: { active: 2_310_400, holding: 498_420 }, total: 2_808_820, basis: name === "finalpost" ? "posters" : "if_all_post", posters: name === "finalpost" ? 38 : 0, includesUnspentDaily: false }
        : s.community
          ? { earned: { amu: 2_600 }, share: { amu: 28_330 }, total: 28_330, basis: "if_all_post", posters: 0, includesUnspentDaily: false }
          : { earned: {}, share: {}, total: 0, basis: "if_all_post", posters: 0 },
      today:
        s.holder || s.community
          ? {
              bucket: s.holder ? "active" : "amu",
              day: new Date().toISOString().slice(0, 10),
              allowance: s.holder ? 821_428 : 11_904,
              instantPaid: s.holder ? 61_220 : 410,
              left: s.holder ? 760_208 : 11_494,
              participants: s.holder ? 212 : 31,
              totalUnits: s.holder ? 2_140_000 : 98_000,
              closesAt: Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z") + 86_400_000,
              walletCap: s.holder ? 41_071 : 595,
              maxToday: s.holder ? 41_071 : 595,
              // finalpost: a busy day that already hit the 5% cap
              mine:
                name === "finalpost"
                  ? { units: 96_400, instant: 41_071, provisional: 0, roomLeft: 0 }
                  : s.checkedIn
                    ? { units: 11_200, instant: 1_230, provisional: 3_978, roomLeft: 39_841 }
                    : { units: 0, instant: 0, provisional: 0, roomLeft: s.holder ? 41_071 : 595 },
              checkinNow: s.checkedIn ? null : s.holder ? 41 : 3,
              postNow: s.holder ? 172 : 8,
              yesterdayShare: s.holder ? 1_912 : null,
            }
          : null,
      checkin: {
        checkedInToday: s.checkedIn,
        streak: s.streak,
        nextReward: checkinReward(season, s.streak + 1),
      },
      x: s.x,
      caps: { x_post: 2, simp_post: 3, alpha: 3, season_post: 3 },
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
          ? sub({ kind, status: "approved", auto: true, reward: kind === "season_post" ? 0 : POINTS_CONFIG.rewards.xPost.reward, url: String(body.url) }, 0)
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
        season_post: { default: 0, min: 0, max: 0 },
      },
    } as T;
  }
  if (path === "/api/admin/points/stats") {
    return {
      overview: {
        season,
        pools: POOLS.map((pool) => ({ pool, budget: poolBudget(pool, season), emitted: pool === "active" ? 4_000_000 : 0 })),
        house: { out: 120_400, in: 151_900 },
        simps: 212,
      },
      seasonBudget: POOLS.reduce((a, p) => a + poolBudget(p, season), 0),
      lastHoldingRun: { day: "today", owners: 163, tokensCounted: 421, snapshotsTaken: 0, errors: [] },
      snapshots: [{ index: 1, scheduledAt: Date.now() - 50 * HOUR, takenAt: Date.now() - 49 * HOUR, tokens: 421, missing: 3 }],
      persistent: false,
    } as T;
  }
  if (path === "/api/admin/points/settle") {
    // admin: a frozen past season, so the settle panel's pot lines render
    if (name !== "admin") return { settlement: null } as T;
    const drop = (pot: number, paid: number, instantLeftover: number, recipients: number, wallets: number) => ({
      pot,
      paid,
      burnt: pot - paid,
      recipients,
      wallets,
      instantLeftover,
    });
    return {
      settlement: {
        season,
        root: "0x9f2c41d8e07b5a63c1f4e28d90ab7c35e6d1f80a24b9c7e3510d6fa8b2c4e917",
        total: 312_400_000,
        count: 204,
        frozenAt: Date.now() - 2 * HOUR,
        entries: [],
        drops: {
          active: drop(310_500_000, 281_900_000, 4_120_000, 38, 196),
          holding: drop(105_000_000, 105_000_000, 0, 163, 163),
          amu: drop(4_500_000, 3_100_000, 210_000, 4, 27),
        },
        burnt: 29_400_000,
        posters: 42,
      },
      payout: { credited: 42, total: 42, done: true },
    } as T;
  }
  throw new ApiError(`fixture has no ${method} ${path}`, 404);
}
