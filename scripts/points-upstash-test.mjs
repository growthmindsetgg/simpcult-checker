#!/usr/bin/env node
/**
 * SIMP Points: real-store test harness.
 *
 *   node scripts/points-upstash-test.mjs            run every scenario against a real Upstash
 *                                                   database (UPSTASH_REDIS_REST_URL / _TOKEN
 *                                                   must be in the environment)
 *   node scripts/points-upstash-test.mjs --memory   the same scenarios against the in-memory twin
 *   node scripts/points-upstash-test.mjs --gate     production gate: the API answers a JSON 503
 *                                                   when storage / SESSION_SECRET are missing
 *
 * It loads the real TypeScript modules (src/lib/points/*, so the real Lua in
 * store.ts) through jiti, which is already in node_modules (via tailwind and
 * eslint). Only the chain reads and X's oEmbed are faked, and the clock is
 * pinned to season 1 so results don't depend on today's date.
 *
 * Safety:
 *   - credentials are read from the environment only, never written, never
 *     printed (error text is scrubbed of them);
 *   - every key lives under a fresh `test:<random>:` prefix (POINTS_KEY_PREFIX)
 *     and is deleted at the end, pass or fail.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const args = new Set(process.argv.slice(2));
const MODE = args.has("--gate") ? "gate" : args.has("--memory") ? "memory" : "upstash";

const URL_ENV = process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN_ENV = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

/** strip the credentials out of anything we print */
function redact(v) {
  let s = typeof v === "string" ? v : v instanceof Error ? (v.stack ?? v.message) : String(v);
  for (const secret of [URL_ENV, TOKEN_ENV]) if (secret) s = s.split(secret).join("[redacted]");
  return s;
}

if (MODE === "upstash" && (!URL_ENV || !TOKEN_ENV)) {
  console.log(
    [
      "points-upstash-test: no Upstash credentials in the environment.",
      "",
      "  set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to run against a real database, e.g.",
      "    UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/points-upstash-test.mjs",
      "  (or `vercel env pull` into your shell first; nothing is written or printed by this script)",
      "",
      "  without a database:",
      "    node scripts/points-upstash-test.mjs --memory   same scenarios on the in-memory twin",
      "    node scripts/points-upstash-test.mjs --gate     check the API's 503 'warming up' gate",
    ].join("\n"),
  );
  process.exit(2);
}

const require = createRequire(path.join(ROOT, "package.json"));
let createJiti;
try {
  ({ createJiti } = require("jiti"));
} catch {
  console.error("points-upstash-test: needs `jiti` (normally installed with tailwind / eslint). run npm install.");
  process.exit(2);
}

// ─────────────────────────── env + clock ───────────────────────────

const PREFIX = `test:${randomBytes(6).toString("hex")}:`;
process.env.POINTS_KEY_PREFIX = PREFIX;

if (MODE === "memory") {
  // this process only — the twin is chosen when the Upstash vars are absent
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  process.env.NODE_ENV = "test";
}

const realNow = Date.now.bind(Date);
let shift = 0;
Date.now = () => realNow() + shift;
const setNow = (ms) => {
  shift = ms - realNow();
};
const DAY = 86_400_000;

// ─────────────────────────── fakes ───────────────────────────

/** tokenId → owner, read by the fake chain module */
const chainOwners = new Map();
const SUPPLY = 12;
const fakeChain = {
  erc721Abi: [],
  publicClient: {
    async readContract({ functionName }) {
      if (functionName === "totalSupply") return BigInt(SUPPLY);
      throw new Error(`fake chain: ${functionName} not faked`);
    },
    async multicall({ contracts }) {
      return contracts.map((c) => {
        const o = chainOwners.get(Number(c.args[0]));
        return o ? { status: "success", result: o } : { status: "failure", error: new Error("no token") };
      });
    },
  },
  async nftBalance(owner) {
    let n = 0;
    for (const o of chainOwners.values()) if (o === owner.toLowerCase()) n++;
    return n;
  },
};

/** status url → oEmbed reply; anything else answers 404 (X unreachable) */
const oembed = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (u.hostname === "publish.x.com") {
    const hit = oembed.get(u.searchParams.get("url"));
    return hit
      ? new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("not found", { status: 404 });
  }
  return realFetch(input, init);
};

const jiti = createJiti(path.join(ROOT, "scripts", "points-upstash-test.mjs"), {
  fsCache: false,
  alias: { "@": SRC },
  virtualModules: {
    "server-only": {},
    ...(MODE === "gate" ? {} : { "@/lib/server/chain": fakeChain }),
  },
});
const load = (rel) => jiti.import(path.join(SRC, rel));

// ─────────────────────────── tiny runner ───────────────────────────

const results = [];
async function scenario(name, fn) {
  const t0 = realNow();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  pass  ${name}  (${realNow() - t0}ms)`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${redact(e).split("\n").slice(0, 6).join("\n        ")}`);
  }
}

/** awaits a promise that must reject with the given status / code */
async function rejects(p, want) {
  try {
    await p;
  } catch (e) {
    if (want.code !== undefined) assert.equal(e.code, want.code, `expected code ${want.code}, got ${e.code} (${e.message})`);
    if (want.status !== undefined) assert.equal(e.status, want.status, `expected status ${want.status}, got ${e.status}`);
    return e;
  }
  throw new assert.AssertionError({ message: `expected a rejection ${JSON.stringify(want)}` });
}

const addr = () => `0x${randomBytes(20).toString("hex")}`;

// ─────────────────────────── gate mode ───────────────────────────

async function runGate() {
  process.env.NODE_ENV = "production";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.SESSION_SECRET;
  console.log("production gate (NODE_ENV=production, no Upstash, no SESSION_SECRET)\n");
  const call = async (route, method = "GET") => {
    const m = await load(`app/api/${route}/route.ts`);
    const res = await m[method](new Request(`http://localhost/api/${route}`, { method }));
    return { status: res.status, body: await res.json() };
  };
  const expect503 = (code) => (r) => {
    assert.equal(r.status, 503);
    assert.equal(r.body.code, code);
  };
  for (const [route, method, code] of [
    ["points/season", "GET", "storage-unconfigured"],
    ["points/leaderboard", "GET", "storage-unconfigured"],
    ["points/me", "GET", "session-unconfigured"],
    ["points/ledger", "GET", "session-unconfigured"],
    ["points/checkin", "POST", "session-unconfigured"],
    ["points/submit", "POST", "session-unconfigured"],
    ["admin/points/queue", "GET", "session-unconfigured"],
  ]) {
    await scenario(`${method} /api/${route} → 503 ${code}`, async () => expect503(code)(await call(route, method)));
  }
  await scenario("shared kv() throws code storage-unconfigured", async () => {
    const { kv } = await load("lib/server/store.ts");
    const e = await rejects((async () => kv())(), { code: "storage-unconfigured" });
    assert.equal(e.name, "StorageUnconfiguredError");
  });
}

// ─────────────────────────── store scenarios ───────────────────────────

async function runStore() {
  const config = await load("lib/points/config.ts");
  const { store, isStorageUnconfigured } = await load("lib/points/store.ts");
  const { K } = await load("lib/points/keys.ts");
  const L = await load("lib/points/ledger.ts");
  const chain = await load("lib/points/chain.ts");
  const checkin = await load("lib/points/checkin.ts");
  const subs = await load("lib/points/submissions.ts");
  const xh = await load("lib/points/xhandle.ts");
  const season = await load("lib/points/season.ts");
  const holding = await load("lib/points/holding.ts");
  const settlement = await load("lib/points/settlement.ts");
  const merkle = await load("lib/points/merkle.ts");

  const s = store();
  assert.equal(s.persistent, MODE === "upstash", "picked the wrong store");
  assert.ok(K.bal("0xabc").startsWith(PREFIX), "keys are not under the test prefix");
  assert.equal(isStorageUnconfigured({ code: "storage-unconfigured" }), true);
  console.log(`${MODE === "upstash" ? "Upstash" : "in-memory twin"} · key prefix ${PREFIX}\n`);

  const S1 = config.SEASON1_START_MS;
  const s1Day2 = S1 + 2 * DAY + 12 * 3600_000; // noon on day 3 of season 1
  setNow(s1Day2);

  /** point the fake chain at a new owner map and refresh the 60s owner cache */
  const own = async (map) => {
    chainOwners.clear();
    for (const [id, o] of Object.entries(map)) chainOwners.set(Number(id), o.toLowerCase());
    await chain.ownerMap({ fresh: true });
  };
  const snowflake = (ts) => ((BigInt(ts) - 1288834974657n) << 22n).toString();

  await scenario("season maths: 1B supply, 69/21/10, S1 = 500M, every pool halves", async () => {
    const M = 1_000_000;
    assert.equal(config.POINTS_CONFIG.supply, 1000 * M);
    assert.deepEqual(
      config.POOLS.map((p) => config.poolBudget(p, 1)),
      [345 * M, 105 * M, 50 * M],
    );
    assert.equal(config.seasonBudget(1), 500 * M);
    assert.deepEqual(
      config.POOLS.map((p) => config.poolBudget(p, 2)),
      [172.5 * M, 52.5 * M, 25 * M],
    );
    assert.equal(config.seasonBudget(2), 250 * M);
    assert.equal(config.seasonBudget(3), 125 * M);
    let total = 0;
    for (let n = 1; n <= 80; n++) total += config.seasonBudget(n);
    assert.ok(total <= 1000 * M && total > 999 * M, `geometric sum ${total}`);
    assert.equal(config.seasonAt(S1 - 1), 0);
    assert.equal(config.seasonAt(S1), 1);
    assert.equal(config.seasonAt(S1 + 42 * DAY - 1), 1);
    assert.equal(config.seasonAt(S1 + 42 * DAY), 2);
    assert.equal(config.checkinReward(1, 1), 1000);
    assert.equal(config.checkinReward(1, 2), 1100);
    assert.equal(config.checkinReward(1, 11), 2000);
    assert.equal(config.checkinReward(1, 40), 2000);
    assert.equal(config.checkinReward(2, 1), 500);
    const rate = config.holdingRatePerNftPerDay(1);
    assert.equal(rate, 5938);
    assert.ok(rate * config.POINTS_CONFIG.holding.nftSupply * 42 <= 105 * M);
  });

  await scenario("credit / debit: atomic, insufficient refused, inputs validated", async () => {
    const a = addr();
    assert.equal((await L.credit(a, 1000, "game:test:win", "c1")).balance, 1000);
    assert.equal((await L.debit(a, 400, "game:test:bet", "d1")).balance, 600);
    const e = await rejects(L.debit(a, 601, "game:test:bet", "d2"), { code: "insufficient_balance" });
    assert.equal(e.balance, 600);
    assert.equal(await L.getBalance(a), 600);
    await rejects(L.credit(a, 0, "x", "r0"), { code: "invalid_amount" });
    await rejects(L.credit(a, 1.5, "x", "r1"), { code: "invalid_amount" });
    await rejects(L.debit(a, -3, "x", "r2"), { code: "invalid_amount" });
    await rejects(L.credit("0xnope", 1, "x", "r3"), { code: "invalid_address" });
    await rejects(L.credit(a, 1, "x", ""), { code: "invalid_ref" });
    const rows = await L.ledger(a);
    assert.deepEqual(
      rows.map((r) => r.amount),
      [-400, 1000],
      "ledger is newest-first and a refused debit leaves no row",
    );
    assert.equal(await L.getBalance(a.toUpperCase().replace("0X", "0x")), 600, "addresses are case-insensitive");
  });

  await scenario("idempotent refIds: replays are no-ops, credit/debit namespaces apart", async () => {
    const a = addr();
    const first = await L.credit(a, 250, "game:test:win", "spin-1");
    const again = await L.credit(a, 250, "game:test:win", "spin-1");
    assert.equal(again.duplicate, true);
    assert.equal(again.balance, 250);
    assert.equal(again.entry.ts, first.entry.ts);
    const bet = await L.debit(a, 100, "game:test:bet", "spin-1");
    assert.equal(bet.duplicate, false);
    assert.equal((await L.debit(a, 100, "game:test:bet", "spin-1")).duplicate, true);
    assert.equal(await L.getBalance(a), 150);
    assert.equal((await L.ledger(a)).length, 2);
    const grant = await L.emit("active", a, 77, "admin:grant", "admin:once");
    assert.equal((await L.emit("active", a, 77, "admin:grant", "admin:once")).duplicate, true);
    assert.equal(grant.balance, 227);
    assert.equal(await L.getBalance(a), 227);
  });

  await scenario("store wrappers: get JSON, set nx, incrby, sets, zsets, hashes", async () => {
    const k = (x) => `${PREFIX}{pts}:wrap:${x}`;
    assert.equal(await s.set(k("obj"), { a: 1, b: "two" }), true);
    assert.deepEqual(await s.get(k("obj")), { a: 1, b: "two" });
    assert.equal(await s.set(k("obj"), { a: 2 }, { nx: true }), false);
    assert.equal(await s.set(k("addr"), "0xabc"), true);
    assert.equal(await s.get(k("addr")), "0xabc");
    assert.equal(await s.get(k("missing")), null);
    assert.equal(await s.incrby(k("n"), 1, 60), 1);
    assert.equal(await s.incrby(k("n"), 4), 5);
    assert.equal(await s.num(k("n")), 5);
    assert.deepEqual(await s.saddEach(k("set"), ["1", "2", "1"], 60), [true, true, false]);
    await s.sremEach(k("set"), ["1"]);
    assert.deepEqual(await s.saddEach(k("set"), ["1", "2"]), [true, false]);
    await s.zadd(k("z"), 5, "b");
    await s.zadd(k("z"), 9, "a");
    await s.zadd(k("z"), 1, "c");
    assert.deepEqual(await s.zrevrange(k("z"), 0, -1), [
      { member: "a", score: 9 },
      { member: "b", score: 5 },
      { member: "c", score: 1 },
    ]);
    assert.deepEqual(await s.zrange(k("z"), 0, 1), ["c", "b"]);
    assert.equal(await s.zrevrank(k("z"), "c"), 2);
    assert.equal(await s.zscore(k("z"), "b"), 5);
    assert.equal(await s.zcard(k("z")), 3);
    await s.zrem(k("z"), "b");
    assert.equal(await s.zcard(k("z")), 2);
    await s.lpush(k("l"), { i: 1 }, 2);
    await s.lpush(k("l"), { i: 2 }, 2);
    await s.lpush(k("l"), { i: 3 }, 2);
    assert.deepEqual(await s.lrange(k("l"), 0, -1), [{ i: 3 }, { i: 2 }]);
    const stats = await s.hgetall(K.stats(1));
    assert.ok(typeof stats.house_out === "number" && stats.house_out > 0, "stats hash holds numbers");
    assert.ok(typeof stats.house_in === "number" && stats.house_in < 0);
  });

  await scenario("concurrent debits: 10 racing bets of 100 on 300 → exactly 3 win", async () => {
    const a = addr();
    await L.credit(a, 300, "game:test:win", "seed");
    const out = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => L.debit(a, 100, "game:test:bet", `race-${i}`)),
    );
    const won = out.filter((o) => o.status === "fulfilled").length;
    const refused = out.filter((o) => o.status === "rejected" && o.reason.code === "insufficient_balance").length;
    assert.equal(won, 3);
    assert.equal(refused, 7);
    assert.equal(await L.getBalance(a), 0);
    const dup = await Promise.all(Array.from({ length: 5 }, () => L.credit(a, 40, "game:test:win", "same-ref")));
    assert.equal(dup.filter((r) => !r.duplicate).length, 1, "one of 5 racing identical refIds applies");
    assert.equal(await L.getBalance(a), 40);
  });

  // shared cast for the check-in / submission scenarios
  const A = addr(), B = addr(), C = addr(), D = addr();

  await scenario("check-in: once per wallet per UTC day, each tokenId powers one per day", async () => {
    await own({ 1: A, 2: A, 3: C });
    const r = await checkin.checkin(A);
    assert.equal(r.amount ?? r.entry.amount, 1000);
    assert.equal(r.streak, 1);
    await rejects(checkin.checkin(A), { status: 409, code: "already" });
    const st = await checkin.checkinStatus(A);
    assert.deepEqual(st, { checkedInToday: true, streak: 1, nextReward: 1100 });
    // token 1 moves to B — it already powered A's check-in today
    await own({ 1: B, 2: A, 3: C });
    await rejects(checkin.checkin(B), { status: 409, code: "tokens_used" });
    // C gets token 2 (used) next to 3 (fresh): fine
    await own({ 1: B, 2: C, 3: C });
    assert.equal((await checkin.checkin(C)).streak, 1);
    await rejects(checkin.checkin(D), { status: 403, code: "not_holder" });
    assert.equal((await checkin.checkinStatus(B)).checkedInToday, false);
  });

  await scenario("check-in streaks: next day +10%, a missed day resets", async () => {
    await own({ 1: B, 2: A, 3: C });
    setNow(s1Day2 + DAY);
    await own({ 1: B, 2: A, 3: C });
    const a2 = await checkin.checkin(A);
    assert.equal(a2.streak, 2);
    assert.equal(a2.entry.amount, 1100);
    assert.equal((await checkin.checkin(B)).streak, 1, "token 1 is free again on a new day");
    setNow(s1Day2 + 3 * DAY); // skipped a day
    await own({ 1: B, 2: A, 3: C });
    const a3 = await checkin.checkin(A);
    assert.equal(a3.streak, 1);
    assert.equal(a3.entry.amount, 1000);
    const pool = await s.num(K.pool(1, "active"));
    assert.ok(pool >= 1000 + 1000 + 1100 + 1000 + 1000, "check-ins come out of the active pool");
  });

  const A2 = addr(), B2 = addr();
  let alphaIds = [];

  await scenario("submission caps: 3 alpha per wallet per day, and per NFT across wallets", async () => {
    await own({ 1: B, 2: A, 3: C, 5: A2 });
    const proof = ["https://example.com/thread"];
    await rejects(subs.submit(A2, { kind: "alpha", title: "no", proof }), { status: 400 });
    for (let i = 0; i < 3; i++) {
      const sub = await subs.submit(A2, { kind: "alpha", title: `alpha drop ${i}`, note: "gm", proof });
      assert.equal(sub.status, "pending");
      alphaIds.push(sub.id);
    }
    await rejects(subs.submit(A2, { kind: "alpha", title: "alpha drop 4", proof }), { status: 429, code: "cap" });
    assert.equal((await subs.capsLeft(A2)).alpha, 0);
    // the NFT walks to B2: its 3 slots are spent today, whoever holds it
    await own({ 1: B, 2: A, 3: C, 5: B2 });
    await rejects(subs.submit(B2, { kind: "alpha", title: "alpha drop 5", proof }), { status: 429, code: "tokens_used" });
    assert.equal((await subs.capsLeft(B2)).alpha, 3, "a refused slot hands the wallet counter back");
    await rejects(subs.submit(D, { kind: "alpha", title: "not a holder", proof }), { status: 403, code: "not_holder" });
  });

  const A3 = addr(), A4 = addr(), B3 = addr();
  const h3 = `t${randomBytes(4).toString("hex")}`;
  const h4 = `v${randomBytes(4).toString("hex")}`;
  let unverifiedA, unverifiedB;

  await scenario("x post from an unverified handle → admin queue, never instant", async () => {
    await own({ 1: B, 2: A, 3: C, 5: B2, 6: A3, 7: B3 });
    const claim = await xh.claimHandle(A3, `@${h3}`);
    assert.equal(claim.verified, false);
    assert.match(claim.code, /^simp-[0-9a-f]{6}$/);
    const id = snowflake(Date.now() - 3600_000);
    const url = `https://x.com/${h3}/status/${id}`;
    oembed.set(url, { author_url: `https://twitter.com/${h3}`, html: "<p>simp cult forever</p>" });
    unverifiedA = await subs.submit(A3, { kind: "x_post", url: `${url}?s=20` });
    assert.equal(unverifiedA.status, "pending");
    assert.equal(unverifiedA.handleVerified, false);
    assert.deepEqual(unverifiedA.check, { reachable: true, author: h3, keyword: true });
    await rejects(subs.submit(A3, { kind: "x_post", url: `https://x.com/someoneelse/status/${id}` }), {
      code: "wrong_handle",
    });
    const old = snowflake(S1 - DAY);
    await rejects(subs.submit(A3, { kind: "x_post", url: `https://x.com/${h3}/status/${old}` }), { code: "too_old" });
    // a second wallet claiming the same unproven handle can queue the same post
    await xh.claimHandle(B3, h3);
    unverifiedB = await subs.submit(B3, { kind: "x_post", url });
    assert.equal(unverifiedB.status, "pending");
    const queue = (await subs.pendingQueue()).map((q) => q.id);
    assert.ok(queue.includes(unverifiedA.id) && queue.includes(unverifiedB.id));
  });

  await scenario("x post from a verified handle + oEmbed match → instant credit", async () => {
    await own({ 1: B, 2: A, 3: C, 5: B2, 6: A3, 7: B3, 8: A4 });
    await s.set(K.xHandle(A4), { handle: h4, verified: true, code: "simp-000000", at: Date.now() });
    await s.set(K.xOwner(h4), A4);
    const url = `https://x.com/${h4}/status/${snowflake(Date.now() - 60_000)}`;
    oembed.set(url, { author_url: `https://twitter.com/${h4}`, html: "<p>gm <a href='#'>@monadsimpcult</a></p>" });
    const before = await L.getBalance(A4);
    const sub = await subs.submit(A4, { kind: "x_post", url });
    assert.equal(sub.status, "approved");
    assert.equal(sub.auto, true);
    assert.equal(sub.reward, 5000);
    assert.equal(await L.getBalance(A4), before + 5000);
    await rejects(subs.submit(A4, { kind: "x_post", url }), { status: 409, code: "dupe" });
    // no keyword → stays in the queue
    const url2 = `https://x.com/${h4}/status/${snowflake(Date.now() - 30_000)}`;
    oembed.set(url2, { author_url: `https://twitter.com/${h4}`, html: "<p>just a simple post</p>" });
    const sub2 = await subs.submit(A4, { kind: "x_post", url: url2 });
    assert.equal(sub2.status, "pending");
    assert.equal(sub2.check.keyword, false);
  });

  await scenario("admin review: approve within bounds, reject, one payout per post", async () => {
    const admin = addr();
    await rejects(subs.approve(alphaIds[2], { by: admin, amount: 10 }), { status: 400 });
    const ok = await subs.approve(alphaIds[0], { by: admin, amount: 30_000, note: "nice find" });
    assert.equal(ok.status, "approved");
    assert.equal(ok.reward, 30_000);
    await rejects(subs.approve(alphaIds[0], { by: admin }), { status: 409 });
    assert.equal((await subs.reject(alphaIds[1], { by: admin, note: "dupe alpha" })).status, "rejected");
    assert.equal(await L.getBalance(A2), 30_000);
    // two wallets queued the same unverified post: only one can be paid
    assert.equal((await subs.approve(unverifiedA.id, { by: admin })).status, "approved");
    await rejects(subs.approve(unverifiedB.id, { by: admin }), { status: 409, code: "dupe" });
    const done = (await subs.recentlyReviewed()).map((r) => r.id);
    assert.ok(done.includes(alphaIds[0]) && done.includes(alphaIds[1]));
    assert.ok(!(await subs.pendingQueue()).some((q) => q.id === alphaIds[0]));
  });

  await scenario("holding accrual: every NFT pays once per UTC day, re-runs pay nothing", async () => {
    const dead = "0x000000000000000000000000000000000000dead";
    await own({ 1: B, 2: A, 3: C, 5: B2, 6: A3, 7: B3, 8: A4, 9: A4, 10: dead });
    const rate = config.holdingRatePerNftPerDay(1);
    const run = await holding.runHoldingAccrual();
    // 8 live tokens (1-3, 5-9); the dead address is skipped
    assert.equal(run.tokensPaid, 8);
    assert.equal(run.pointsPaid, 8 * rate);
    assert.deepEqual(run.errors, []);
    assert.equal(await L.getBalance(A4) >= 2 * rate, true, "two NFTs, two payouts");
    const again = await holding.runHoldingAccrual();
    assert.equal(again.tokensPaid, 0);
    assert.equal(again.skippedAlreadyPaid, 8);
    assert.equal(await s.num(K.pool(1, "holding")), 8 * rate);
    assert.equal((await holding.lastHoldingRun()).tokensPaid, 0);
  });

  await scenario("pool budget: the monad pool caps at 50M, revokes hand points back", async () => {
    const whale = addr(), other = addr();
    const budget = config.poolBudget("monad", 1);
    await L.emit("monad", whale, budget, "admin:grant", "admin:fill");
    await rejects(L.emit("monad", other, 1, "admin:grant", "admin:over"), { code: "pool_exhausted" });
    assert.equal(await L.getBalance(other), 0);
    await L.revokeEmission("monad", whale, 1000, "admin:revoke", "admin:back", undefined, 1);
    await L.emit("monad", other, 1000, "admin:grant", "admin:refill");
    await rejects(L.emit("monad", other, 1, "admin:grant", "admin:over2"), { code: "pool_exhausted" });
    await L.credit(other, 5000, "game:test:win", "house"); // spendable, but not earned from the pool
    await rejects(L.revokeEmission("monad", other, 1001, "admin:revoke", "admin:toomuch", undefined, 1), {
      code: "not_earned",
    });
    assert.equal(await s.num(K.pool(1, "monad")), budget);
  });

  await scenario("check-in lock is handed back when the payout fails", async () => {
    const sink = addr(), E = addr();
    await own({ 11: E });
    const left = config.poolBudget("active", 1) - (await s.num(K.pool(1, "active")));
    await L.emit("active", sink, left, "admin:grant", "admin:drain");
    await rejects(checkin.checkin(E), { code: "pool_exhausted" });
    await L.revokeEmission("active", sink, left, "admin:revoke", "admin:undrain", undefined, 1);
    const r = await checkin.checkin(E);
    assert.equal(r.streak, 1, "token 11 was not burned by the failed attempt");
  });

  await scenario("season rollover: S2 pays half, keeps its own pools and board", async () => {
    setNow(S1 + 42 * DAY + 3600_000);
    assert.equal(config.seasonAt(), 2);
    await own({ 2: A });
    const s1Active = await s.num(K.pool(1, "active"));
    const r = await checkin.checkin(A);
    assert.equal(r.entry.season, 2);
    assert.equal(r.entry.amount, 500, "S2 check-in is half the S1 rate");
    assert.equal(await s.num(K.pool(2, "active")), 500);
    assert.equal(await s.num(K.pool(1, "active")), s1Active, "S1 pool untouched");
    const o2 = await season.seasonOverview(2);
    assert.equal(o2.live, true);
    assert.deepEqual(
      o2.pools.map((p) => p.budget),
      [172_500_000, 52_500_000, 25_000_000],
    );
    assert.equal(o2.simps, 1);
    assert.equal((await season.seasonOverview(1)).live, false, "a past season is not live");
    assert.equal((await season.myRank(A, 2)).rank, 1);
  });

  await scenario("settlement: freeze S1 once, proofs verify against the root", async () => {
    const earners = await season.seasonEarners(1);
    const sum = earners.reduce((x, e) => x + e.points, 0);
    const snap = await settlement.freezeSeason(1, "harness");
    assert.equal(snap.total, sum);
    assert.ok(snap.total <= config.seasonBudget(1));
    assert.equal((await settlement.freezeSeason(1, "someone else")).frozenAt, snap.frozenAt, "frozen once, forever");
    const p = await settlement.proofFor(A, 1);
    const leaf = merkle.leafHash(A, 1n, BigInt(p.amount));
    assert.ok(p.amount > 0);
    assert.equal(merkle.verifyProof(p.proof, snap.root, leaf), true);
    const nobody = await settlement.proofFor(addr(), 1);
    assert.equal(nobody.amount, 0);
    await rejects(settlement.freezeSeason(2, "harness"), { code: "season_live" });
  });

  await scenario("leaderboard: season-earned order, ranks, house moves don't count", async () => {
    setNow(S1 + 84 * DAY + 3600_000); // season 3: a clean board
    assert.equal(config.seasonAt(), 3);
    const w = [addr(), addr(), addr(), addr()];
    const pts = [300, 100, 400, 200];
    for (let i = 0; i < 4; i++) await L.emit("active", w[i], pts[i], "admin:grant", `admin:lb${i}`);
    await L.credit(w[1], 10_000, "game:test:win", "big-win"); // spendable, not season-earned
    const rows = await season.leaderboard(3);
    assert.deepEqual(
      rows.map((r) => [r.rank, r.address, r.points]),
      [
        [1, w[2], 400],
        [2, w[0], 300],
        [3, w[3], 200],
        [4, w[1], 100],
      ],
    );
    assert.deepEqual(await season.myRank(w[3], 3), { rank: 3, points: 200 });
    assert.deepEqual(await season.myRank(addr(), 3), { rank: null, points: 0 });
    await L.revokeEmission("active", w[0], 300, "admin:revoke", "admin:lbrevoke", undefined, 3);
    assert.equal((await season.leaderboard(3)).length, 3, "zeroed simps drop off the board");
  });
}

// ─────────────────────────── cleanup ───────────────────────────

async function cleanupUpstash() {
  assert.ok(/^test:[0-9a-f]{12}:$/.test(PREFIX), "refusing to clean up without a test prefix");
  const { Redis } = require("@upstash/redis");
  const r = new Redis({ url: URL_ENV, token: TOKEN_ENV });
  let cursor = "0";
  let deleted = 0;
  do {
    const [next, keys] = await r.scan(cursor, { match: `${PREFIX}*`, count: 500 });
    const mine = keys.filter((k) => k.startsWith(PREFIX));
    if (mine.length) deleted += await r.del(...mine);
    cursor = String(next);
  } while (cursor !== "0");
  const [, left] = await r.scan("0", { match: `${PREFIX}*`, count: 500 });
  console.log(`\ncleanup: deleted ${deleted} test keys under ${PREFIX}${left.length ? ` (${left.length} still listed)` : ""}`);
}

// ─────────────────────────── main ───────────────────────────

let crashed = false;
try {
  if (MODE === "gate") await runGate();
  else await runStore();
} catch (e) {
  crashed = true;
  console.error(`\nharness crashed: ${redact(e)}`);
} finally {
  if (MODE === "upstash") {
    try {
      await cleanupUpstash();
    } catch (e) {
      console.error(`cleanup failed: ${redact(e)} — delete keys matching ${PREFIX}* by hand`);
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} failed` : ""} (${MODE})`);
process.exit(crashed || failed ? 1 : 0);
