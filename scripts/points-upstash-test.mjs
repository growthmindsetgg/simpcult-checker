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
 * eslint). Only the chain reads (owners, Monad card, tx counts, historical
 * ownerOf), the Telegram link lookup and X's oEmbed are faked, and the clock
 * is pinned to fixed season times so results don't depend on today's date.
 * The Monad card is switched on (a fake contract address) so the 9% card
 * sub-pool is exercised; snapshot times come from a fixed test secret.
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

// card sub-pool on (fake contract), deterministic snapshot schedule
process.env.NEXT_PUBLIC_MONAD_CARD_ADDRESS = "0x00000000000000000000000000000000000c4d01";
process.env.POINTS_SNAPSHOT_SECRET = "harness-snapshot-secret-0123456789";

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
/** tokenId → owner at any historical block (the welcome bonus's 69-minute check) */
const pastOwners = new Map();
/** lowercase address → Monad tx count / Monad card balance */
const txCounts = new Map();
const cards = new Map();
/** lowercase addresses with a Telegram link */
const tgLinks = new Set();
const chainCalls = { tx: 0, historical: 0 };
const flaky = { tx: false, historical: false };
const SUPPLY = 40;
const HEAD = 1_000_000n;
const MS_PER_BLOCK = 300;
const fakeChain = {
  erc721Abi: [],
  publicClient: {
    async readContract({ functionName, args }) {
      if (functionName === "totalSupply") return BigInt(SUPPLY);
      if (functionName === "balanceOf") return BigInt(cards.get(String(args[0]).toLowerCase()) ?? 0);
      throw new Error(`fake chain: ${functionName} not faked`);
    },
    async multicall({ contracts, blockNumber }) {
      if (blockNumber !== undefined) {
        chainCalls.historical++;
        if (flaky.historical) throw new Error("fake chain: historical state unavailable");
      }
      const book = blockNumber !== undefined ? pastOwners : chainOwners;
      return contracts.map((c) => {
        const o = book.get(Number(c.args[0]));
        return o ? { status: "success", result: o } : { status: "failure", error: new Error("no token") };
      });
    },
    async getTransactionCount({ address }) {
      chainCalls.tx++;
      if (flaky.tx) throw new Error("fake chain: rpc down");
      return txCounts.get(address.toLowerCase()) ?? 0;
    },
    async getBlock(opts = {}) {
      const number = opts.blockNumber ?? HEAD;
      const ms = Date.now() - Number(HEAD - number) * MS_PER_BLOCK;
      return { number, timestamp: BigInt(Math.floor(ms / 1000)) };
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
    ...(MODE === "gate"
      ? {}
      : {
          "@/lib/server/chain": fakeChain,
          // the link store's read helper; keeps tg:* keys out of the real database
          "@/lib/server/telegram": {
            async telegramLink(a) {
              return tgLinks.has(String(a).toLowerCase()) ? { handle: "harness", method: "declared" } : null;
            },
          },
        }),
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
  const snaps = await load("lib/points/snapshots.ts");
  const elig = await load("lib/points/eligibility.ts");
  const welcome = await load("lib/points/welcome.ts");
  const pace = await load("lib/points/pace.ts");
  const activity = await load("lib/points/activity.ts");
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
  const tx = (a, n) => txCounts.set(a.toLowerCase(), n);
  const tag = () => randomBytes(4).toString("hex");
  /** give a wallet a verified X handle and return it */
  const verified = async (a, prefix = "h") => {
    const h = `${prefix}${tag()}`;
    await s.set(K.xHandle(a), { handle: h, verified: true, code: "simp-000000", at: Date.now() });
    await s.set(K.xOwner(h), a);
    return h;
  };
  /** a fresh post url from `h`, with what oEmbed will say about it */
  const postFrom = (h, text, agoMs = 60_000) => {
    const url = `https://x.com/${h}/status/${snowflake(Date.now() - agoMs)}`;
    oembed.set(url, { author_url: `https://twitter.com/${h}`, html: `<p>${text}</p>` });
    return url;
  };
  const M = 1_000_000;

  await scenario("season maths: 1B, 69/21/10, S1 = 500M, halving; 10/90 rule; community 9/1", async () => {
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
    // buckets: active, holding, card (9%), amu (1%)
    assert.deepEqual(config.BUCKETS, ["active", "holding", "card", "amu"]);
    assert.deepEqual(
      config.BUCKETS.map((b) => config.bucketBudget(b, 1)),
      [345 * M, 105 * M, 45 * M, 5 * M],
    );
    assert.deepEqual(
      config.BUCKETS.map((b) => config.instantCap(b, 1)),
      [34.5 * M, 0, 4.5 * M, 0.5 * M],
      "10% instant, holding none",
    );
    assert.deepEqual(
      config.BUCKETS.map((b) => config.endPot(b, 1)),
      [310.5 * M, 105 * M, 40.5 * M, 4.5 * M],
      "90% at season end, holding 100%",
    );
    assert.equal(config.endPot("holding", 1, 7000), 105 * M - 7000, "legacy daily holding payouts come off the drop");
    const w = config.finalWindow(1);
    assert.equal(w.end, S1 + 42 * DAY);
    assert.equal(w.end - w.start, 48 * 3600_000);
    assert.equal(config.MONAD_CARD_ENABLED, true, "harness runs with the card sub-pool on");
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
    assert.equal(grant.entry.bucket, "active");
    assert.equal(await L.getBalance(a), 227);
    assert.equal(await s.zscore(K.lbBucket(1, "active"), a), 77, "instant emissions count on the bucket board");
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
    assert.deepEqual((await s.smembers(k("set"))).sort(), ["1", "2"]);
    assert.equal(await s.sismember(k("set"), "2"), true);
    assert.equal(await s.sismember(k("set"), "9"), false);
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
    assert.equal(await s.zincrby(k("zi"), 2, "m"), 2);
    assert.equal(await s.zincrby(k("zi"), 3, "m"), 5);
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

  // shared cast for the check-in / submission scenarios (D: no NFT, no card, 0 txs)
  const A = addr(), B = addr(), C = addr(), D = addr();

  await scenario("check-in: once per wallet per UTC day, each tokenId powers one per day", async () => {
    await own({ 1: A, 2: A, 3: C });
    const r = await checkin.checkin(A);
    assert.equal(r.amount ?? r.entry.amount, 1000);
    assert.equal(r.streak, 1);
    assert.equal(r.entry.bucket, "active");
    await rejects(checkin.checkin(A), { status: 409, code: "already" });
    const st = await checkin.checkinStatus(A);
    assert.deepEqual(st, { checkedInToday: true, streak: 1, nextReward: 1100 });
    // token 1 moves to B — it already powered A's check-in today
    await own({ 1: B, 2: A, 3: C });
    await rejects(checkin.checkin(B), { status: 409, code: "tokens_used" });
    // C gets token 2 (used) next to 3 (fresh): fine
    await own({ 1: B, 2: C, 3: C });
    assert.equal((await checkin.checkin(C)).streak, 1);
    await rejects(checkin.checkin(D), { status: 403, code: "not_eligible" });
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

  await scenario("eligibility: no NFT/card/50 txs → 403 not_eligible; community wallets earn in their sub-pool", async () => {
    await own({ 1: B, 2: A, 3: C });
    const U = addr(), Cd = addr(), N = addr(), R = addr();
    tx(U, 60);
    tx(N, 49);
    cards.set(Cd, 1);
    await rejects(checkin.checkin(N), { status: 403, code: "not_eligible" });
    await rejects(subs.submit(N, { kind: "simp_post", url: "https://x.com/a/status/1" }), { status: 403, code: "not_eligible" });
    await rejects(subs.submit(D, { kind: "season_post", url: "https://x.com/a/status/1" }), { status: 403, code: "not_eligible" });
    assert.equal((await elig.walletProfile(N)).category, "none");
    assert.equal((await elig.walletProfile(U)).category, "active_monad");
    assert.equal((await elig.walletProfile(Cd)).category, "card");
    assert.equal((await elig.walletProfile(A)).category, "holder");

    const amu0 = await s.num(K.pool(1, "amu"));
    const ru = await checkin.checkin(U);
    assert.equal(ru.entry.bucket, "amu");
    assert.equal(ru.entry.pool, "monad", "the community pool keeps its stable id");
    // auto-paced: the 1% sub-pool's small allowance pays a slice now, the weight counts for the day close
    assert.equal(ru.entry.meta.units, config.checkinReward(1, 1));
    assert.ok(ru.entry.amount >= 1 && ru.entry.amount <= ru.entry.meta.units);
    assert.equal((await s.num(K.pool(1, "amu"))) - amu0, ru.entry.amount, "paid from the 1% sub-pool");
    assert.equal(await s.zscore(K.lbBucket(1, "amu"), U), ru.entry.amount);
    const rc = await checkin.checkin(Cd);
    assert.equal(rc.entry.bucket, "card", "card holders from the 9% sub-pool");

    // active Monad users post about simp: simp posts yes, alpha / cult x posts no
    const hu = await verified(U, "u");
    const sp = await subs.submit(U, { kind: "simp_post", url: postFrom(hu, "simping on monad all day") });
    assert.equal(sp.status, "approved");
    assert.equal(sp.bucket, "amu");
    assert.ok(sp.reward >= 1 && sp.reward <= 2500, "paced, never above the table");
    await rejects(subs.submit(U, { kind: "alpha", title: "some alpha", proof: ["https://example.com/a"] }), {
      status: 403,
      code: "not_holder",
    });
    await rejects(subs.submit(U, { kind: "x_post", url: postFrom(hu, "simp cult") }), { status: 403, code: "not_holder" });
    // card holders can bring alpha too (the "tasks" bonus), paid from the card sub-pool
    const ca = await subs.submit(Cd, { kind: "alpha", title: "card alpha", proof: ["https://example.com/c"] });
    assert.equal(ca.bucket, "card");
    // a holder without a card has no community path
    await rejects(subs.submit(A, { kind: "simp_post", url: "https://x.com/a/status/1" }), { status: 403, code: "not_community" });

    // tx counts: ≥50 is cached for good; an RPC failure is a 503, never "not eligible"
    const calls = chainCalls.tx;
    tx(U, 0);
    assert.equal((await elig.walletProfile(U)).category, "active_monad");
    assert.equal(chainCalls.tx, calls, "cached");
    flaky.tx = true;
    await rejects(checkin.checkin(R), { status: 503, code: "chain_unavailable" });
    flaky.tx = false;
  });

  await scenario("telegram 3x: every activity payout triples, base + multiplier on the entry", async () => {
    const T = addr();
    await own({ 1: B, 2: A, 3: C, 4: T });
    tgLinks.add(T);
    const r = await checkin.checkin(T);
    assert.equal(r.multiplier, 3);
    assert.equal(r.entry.amount, 3 * config.checkinReward(1, 1));
    assert.deepEqual([r.entry.meta.base, r.entry.meta.multiplier], [1000, 3]);
    const h = await verified(T, "g");
    const xp = await subs.submit(T, { kind: "x_post", url: postFrom(h, "simp cult forever") });
    assert.equal(xp.status, "approved");
    assert.equal(xp.reward, 15_000);
    const al = await subs.submit(T, { kind: "alpha", title: "tg alpha", proof: ["https://example.com/t"] });
    const ok = await subs.approve(al.id, { by: addr(), amount: 30_000 });
    const alEntry = (await L.ledger(T))[0];
    assert.deepEqual([alEntry.meta.base, alEntry.meta.units], [30_000, 90_000], "admin picks the base, the bonus triples its weight");
    // the instant slice stops at the wallet's 5% daily cap; the weight still counts at day close
    const cap = pace.walletCap((await pace.paceDay("active")).allowance);
    assert.equal(ok.reward, Math.max(1, Math.min(90_000, cap - 3000 - 15_000)));
    assert.equal(await L.getBalance(T), 3000 + 15_000 + ok.reward);
    // admin grants are not activities
    const g = await L.emit("active", T, 500, "admin:grant", "admin:tg");
    assert.equal(g.entry.amount, 500);
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
    await rejects(subs.submit(D, { kind: "alpha", title: "not a holder", proof }), { status: 403, code: "not_eligible" });
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

  await scenario("holding: NFT-days count once per token per UTC day; nothing pays daily", async () => {
    const dead = "0x000000000000000000000000000000000000dead";
    await own({ 1: B, 2: A, 3: C, 5: B2, 6: A3, 7: B3, 8: A4, 9: A4, 10: dead });
    const bal = await L.getBalance(A4);
    const before = await s.num(K.nftDaysTotal(1));
    const run = await holding.runHoldingAccrual();
    // 8 live tokens (1-3, 5-9); the dead address is skipped
    assert.equal(run.tokensCounted, 8);
    assert.deepEqual(run.errors, []);
    assert.equal(await L.getBalance(A4), bal, "no daily payout any more");
    assert.equal((await s.num(K.nftDaysTotal(1))) - before, 8);
    assert.equal((await holding.holdingStatus(A4, 1)).nftDays, 2, "two NFTs, two NFT-days");
    const again = await holding.runHoldingAccrual();
    assert.equal(again.tokensCounted, 0);
    assert.equal(again.skippedAlreadyCounted, 8);
    assert.equal((await holding.lastHoldingRun()).tokensCounted, 0);
    assert.equal(await s.num(K.pool(1, "holding")), 0, "the holding pool pays nothing instantly");
    await rejects(L.emit("holding", A4, 1, "admin:grant", "admin:hold"), { code: "pool_exhausted" });
  });

  const whale = addr();
  await scenario("instant cap: card sub-pool stops at 4.5M (10%); revokes hand back, per bucket", async () => {
    const other = addr();
    const cap = config.instantCap("card", 1);
    assert.equal(cap, 4.5 * M);
    await L.emit("card", whale, cap - (await s.num(K.pool(1, "card"))), "admin:grant", "admin:fill");
    await rejects(L.emit("card", other, 1, "admin:grant", "admin:over"), { code: "pool_exhausted" });
    assert.equal(await L.getBalance(other), 0);
    await L.revokeEmission("card", whale, 1000, "admin:revoke", "admin:back", undefined, 1);
    await L.emit("card", other, 1000, "admin:grant", "admin:refill");
    await rejects(L.emit("card", other, 1, "admin:grant", "admin:over2"), { code: "pool_exhausted" });
    await L.credit(other, 5000, "game:test:win", "house"); // spendable, but not earned from the pool
    await rejects(L.revokeEmission("card", other, 1001, "admin:revoke", "admin:toomuch", undefined, 1), {
      code: "not_earned",
    });
    // points earned in the active pool can't be revoked out of the card bucket
    await L.emit("active", other, 5000, "admin:grant", "admin:act");
    await rejects(L.revokeEmission("card", other, 2000, "admin:revoke", "admin:cross", undefined, 1), { code: "not_earned" });
    assert.equal(await s.num(K.pool(1, "card")), cap);
    // the amu sub-pool has its own, smaller cap
    assert.equal(config.instantCap("amu", 1), 0.5 * M);
  });

  await scenario("instant cap with 3x: the multiplied payout must fit; the check-in lock comes back", async () => {
    const sink = addr(), E = addr(), F = addr();
    await own({ 11: E, 12: F });
    tgLinks.add(E);
    const base = config.checkinReward(1, 1);
    const left = config.instantCap("active", 1) - (await s.num(K.pool(1, "active")));
    await L.emit("active", sink, left - 2 * base, "admin:grant", "admin:drain"); // room for 2× base
    await rejects(checkin.checkin(E), { code: "pool_exhausted" }); // 3× doesn't fit
    assert.equal((await checkin.checkin(F)).entry.amount, base, "1× still fits");
    await L.revokeEmission("active", sink, left - 2 * base, "admin:revoke", "admin:undrain", undefined, 1);
    const r = await checkin.checkin(E);
    assert.equal(r.entry.amount, 3 * base, "token 11 was not burned by the failed attempt");
  });

  await scenario("welcome bonus: 1,000 after 69 min holding (once per wallet and per NFT), 100 for community", async () => {
    setNow(s1Day2 + 5 * DAY);
    const W1 = addr(), W2 = addr(), W3 = addr(), W4 = addr(), W5 = addr(), WU = addr(), WC = addr(), WN = addr();
    tx(WU, 70);
    tx(W5, 80);
    cards.set(WC, 1);
    tgLinks.add(W1);
    const book = () => ({ 20: W1, 21: W3, 22: W4, 23: W5 });
    await own(book());
    pastOwners.clear();
    pastOwners.set(21, W3);
    const st = async (a) => welcome.welcomeStatus(await elig.walletProfile(a));

    // just bought: the on-chain check says no → pending with an ETA, chain asked once per 5 min
    const h0 = chainCalls.historical;
    const p1 = await st(W1);
    assert.equal(p1.status, "pending");
    assert.equal(p1.reason, "holding_time");
    assert.ok(Math.abs(p1.eta - (Date.now() + 69 * 60_000)) < 5000, "eta = first seen + 69 min");
    assert.equal(chainCalls.historical, h0 + 1);
    await st(W1);
    assert.equal(chainCalls.historical, h0 + 1, "on-chain check is rate-limited");
    // 70 minutes later, still holding the same NFT → granted, flat, no Telegram 3x
    setNow(Date.now() + 70 * 60_000);
    await own(book());
    const g1 = await st(W1);
    assert.equal(g1.status, "granted");
    assert.equal(g1.amount, 1000);
    assert.equal(await L.getBalance(W1), 1000);
    assert.equal((await st(W1)).status, "granted");
    assert.equal(await L.getBalance(W1), 1000, "one time only");
    assert.equal((await L.ledger(W1))[0].bucket, "active");
    // that NFT already brought a welcome: passing it on brings none
    await own({ ...book(), 20: W2 });
    assert.deepEqual(await st(W2), { status: "not_eligible", reason: "tokens_used" });
    // on-chain proof: owned at a block 69+ min old and still owns → right away
    const g3 = await st(W3);
    assert.equal(g3.status, "granted");
    // historical state unavailable → falls back to first-seen
    flaky.historical = true;
    assert.equal((await st(W4)).status, "pending");
    flaky.historical = false;
    // a holder with 50+ txs waits for its 1,000 and never takes the 100
    const p5 = await st(W5);
    assert.equal(p5.status, "pending");
    assert.equal(p5.amount, 1000);
    assert.equal(await L.getBalance(W5), 0);
    // community wallets: 100 at once, from their own sub-pool
    const amu0 = await s.num(K.pool(1, "amu"));
    assert.equal((await st(WU)).amount, 100);
    assert.equal((await s.num(K.pool(1, "amu"))) - amu0, 100);
    // an empty instant budget leaves the bonus pending (the card sub-pool is full from the cap test)
    assert.deepEqual(await st(WC), { status: "pending", amount: 100, eta: null, reason: "budget" });
    await L.revokeEmission("card", whale, 10_000, "admin:revoke", "admin:room", undefined, 1);
    assert.equal((await st(WC)).status, "granted");
    assert.equal((await L.ledger(WC))[0].bucket, "card");
    assert.equal(await L.getBalance(WC), 100);
    assert.deepEqual(await st(WN), { status: "not_eligible", reason: "not_in_season" });
  });

  await scenario("season rollover: S2 pays half, keeps its own pools and board", async () => {
    setNow(S1 + 42 * DAY + 3600_000);
    assert.equal(config.seasonAt(), 2);
    await own({ 2: A });
    const s1Active = await s.num(K.pool(1, "active"));
    const r = await checkin.checkin(A);
    assert.equal(r.entry.season, 2);
    assert.equal(r.entry.meta.units, 500, "S2 check-in weighs half the S1 rate");
    assert.ok(r.entry.amount >= 1 && r.entry.amount <= 500);
    assert.equal(await s.num(K.pool(2, "active")), r.entry.amount);
    assert.equal(await s.num(K.pool(1, "active")), s1Active, "S1 pool untouched");
    const o2 = await season.seasonOverview(2);
    assert.equal(o2.live, true);
    assert.deepEqual(
      o2.pools.map((p) => p.budget),
      [172_500_000, 52_500_000, 25_000_000],
    );
    assert.deepEqual(
      o2.buckets.map((b) => [b.bucket, b.instantCap, b.endPot]),
      [
        ["active", 17_250_000, 155_250_000],
        ["holding", 0, 52_500_000],
        ["card", 2_250_000, 20_250_000],
        ["amu", 250_000, 2_250_000],
      ],
    );
    assert.equal(o2.simps, 1);
    assert.equal((await season.seasonOverview(1)).live, false, "a past season is not live");
    assert.equal((await season.myRank(A, 2)).rank, 1);
  });

  await scenario("settlement S1: nobody posted in the final 48h → each pot burnt (no poster), proofs verify", async () => {
    const snap = await settlement.freezeSeason(1, "harness"); // closes every S1 day first (daily shares)
    const earners = await season.seasonEarners(1);
    const sum = earners.reduce((x, e) => x + e.points, 0);
    assert.equal(snap.shares.length, 0);
    assert.equal(snap.total, sum);
    assert.ok(snap.total <= config.seasonBudget(1));
    for (const b of ["active", "card", "amu", "holding"]) {
      assert.equal(snap.drops[b].paid, 0);
      assert.equal(snap.drops[b].burnt, snap.drops[b].pot, `${b}: nothing paid, all burnt`);
    }
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

  // ── a whole season, start to settlement (season 4: clean counters) ──
  const S4 = S1 + 126 * DAY;
  const end4 = S4 + 42 * DAY;
  const H1 = addr(), H2 = addr(), H3 = addr(), X = addr(), U1 = addr(), U2 = addr(), C1 = addr();
  let sched;

  await scenario("snapshots: 5 secret HMAC times per season; a counted holder missing at one loses the drop", async () => {
    sched = snaps.snapshotSchedule(4);
    assert.equal(sched.length, 5);
    assert.deepEqual(snaps.snapshotSchedule(4), sched, "every instance agrees without storing anything");
    assert.ok(sched.every((t, i) => i === 0 || t >= sched[i - 1]), "ascending");
    assert.ok(sched.every((t) => t >= S4 + 12 * 3600_000 && t <= end4 - 26 * 3600_000), "inside the window");
    assert.notDeepEqual(snaps.snapshotSchedule(5).map((t) => t - 42 * DAY), sched, "a different draw each season");
    tx(H1, 5);
    tx(H2, 3);
    tx(H3, 0);
    tx(X, 1);
    tx(U1, 80);
    tx(U2, 55);
    cards.set(C1, 1);

    setNow(S4 + 3600_000); // before any snapshot can be due
    await own({ 30: H1, 31: H1, 32: H2, 33: H3 });
    const r1 = await holding.runHoldingAccrual();
    assert.equal(r1.season, 4);
    assert.equal(r1.tokensCounted, 4);
    assert.equal(r1.snapshotsTaken, 0);
    // instant earnings in each share bucket
    await L.emit("active", H1, 1000, "admin:grant", "admin:s4h1");
    await L.emit("active", H2, 3000, "admin:grant", "admin:s4h2");
    await L.emit("amu", U1, 100, "admin:grant", "admin:s4u1");
    await L.emit("amu", U2, 300, "admin:grant", "admin:s4u2");
    await L.emit("card", C1, 500, "admin:grant", "admin:s4c1");

    // H2 sells to X before the first snapshot
    await own({ 30: H1, 31: H1, 32: X, 33: H3 });
    setNow(sched[0] + 60_000);
    const t1 = await snaps.maybeSnapshot({ force: true });
    assert.ok(t1.length >= 1);
    assert.equal(t1[0].scheduledAt, sched[0]);
    assert.ok(t1[0].missing.includes(H2) && !t1[0].missing.includes(H1));
    assert.equal(t1[0].owners[X].length, 1, "the snapshot logs every owner");
    assert.equal(await s.sismember(K.holdOut(4), H2), true);
    // buying back in doesn't undo it: H2 now earns as community (3 txs, no card → out of the season)
    await own({ 30: H1, 31: H1, 32: X, 33: H3, 34: H2 });
    const p2 = await elig.walletProfile(H2);
    assert.deepEqual([p2.category, p2.missedSnapshot, p2.tokens.length], ["none", true, 1]);
    await rejects(checkin.checkin(H2), { status: 403, code: "not_eligible" });
    assert.equal((await elig.walletProfile(H1)).category, "holder");
    await own({ 30: H1, 31: H1, 32: X, 33: H3 });
    assert.equal((await snaps.maybeSnapshot({ force: true })).length, 0, "a taken snapshot isn't retaken");

    // much later (another day): every snapshot taken; X is only checked from its first counted day
    setNow(sched[4] + 60_000);
    await own({ 30: H1, 31: H1, 32: X, 33: H3 });
    const r2 = await holding.runHoldingAccrual();
    assert.notEqual(r2.day, r1.day);
    assert.equal(r2.tokensCounted, 4);
    assert.deepEqual(await snaps.snapshotCount(4), { taken: 5, total: 5 });
    assert.equal((await snaps.takenSnapshots(4)).length, 5);
    assert.equal(await s.sismember(K.holdOut(4), X), false);
    const st = await holding.holdingStatus(H2, 4);
    assert.deepEqual(st, { nftDays: 1, totalNftDays: 8, missedSnapshot: true });
  });

  let pendingPost;
  await scenario("final-48h season post: window enforced, verified posts count at once, others wait", async () => {
    setNow(end4 - 49 * 3600_000);
    await own({ 30: H1, 31: H1, 32: X, 33: H3 });
    const hH1 = await verified(H1, "p");
    await rejects(subs.submit(H1, { kind: "season_post", url: postFrom(hH1, "simp cult season 5") }), {
      status: 409,
      code: "window_closed",
    });
    assert.equal((await subs.seasonPostStatus(H1, 4)).open, false);

    setNow(end4 - 24 * 3600_000);
    // a post from before the window doesn't count
    await rejects(subs.submit(H1, { kind: "season_post", url: postFrom(hH1, "simp cult season 5", 30 * 3600_000) }), {
      code: "too_old",
    });
    const p1 = await subs.submit(H1, { kind: "season_post", url: postFrom(hH1, "season 5 of simp cult, see you there") });
    assert.equal(p1.status, "approved");
    assert.equal(p1.reward, 0, "the post itself pays nothing");
    assert.equal((await subs.seasonPostStatus(H1, 4)).state, "approved");
    await rejects(subs.submit(H1, { kind: "season_post", url: postFrom(hH1, "simp season again") }), { code: "already" });
    // an active Monad user and a card holder post too; U2 and H2 don't
    const hU1 = await verified(U1, "q");
    assert.equal((await subs.submit(U1, { kind: "season_post", url: postFrom(hU1, "simp szn: next season loading") })).status, "approved");
    const hC1 = await verified(C1, "r");
    assert.equal((await subs.submit(C1, { kind: "season_post", url: postFrom(hC1, "simp cult season five") })).status, "approved");
    // no season mention → waits for a human
    const hH3 = await verified(H3, "s");
    pendingPost = await subs.submit(H3, { kind: "season_post", url: postFrom(hH3, "gm simp cult") });
    assert.equal(pendingPost.status, "pending");
    const ps = await subs.seasonPostStatus(H3, 4);
    assert.deepEqual([ps.open, ps.state], [true, "pending"]);
  });

  await scenario("season close: posters split the whole 90% pot; holding drop by NFT-days + tx; merkle + payout", async () => {
    setNow(end4 + 3600_000);
    await rejects(settlement.freezeSeason(4, "harness"), { status: 409, code: "pending_season_posts" });
    await subs.reject(pendingPost.id, { by: addr(), note: "no season in it" });
    const snap = await settlement.freezeSeason(4, "harness");
    const pick = (d) => [d.pot, d.basis, d.recipients, d.paid, d.burntIneligible, d.burnt];
    // active: pot 38,812,500 shared among posters only → H1 (posted) takes it all, H2 (didn't) nothing, nothing burnt
    // + the unspent instant budget: 4,312,500 − 4,000 paid = 4,308,500
    assert.equal(snap.drops.active.instantLeftover, 4_308_500);
    assert.deepEqual(pick(snap.drops.active), [43_121_000, 1000, 1, 43_121_000, 0, 0]);
    // community 1%: U1 posted, U2 didn't → U1 takes the whole 562,500
    assert.deepEqual(pick(snap.drops.amu), [562_500 + 62_100, 100, 1, 624_600, 0, 0]);
    // community 9%: C1 alone
    assert.deepEqual(pick(snap.drops.card), [5_062_500 + 562_000, 500, 1, 5_624_500, 0, 0]);
    assert.equal(snap.drops.holding.instantLeftover, 0);
    // holding: 13,125,000 over 8 NFT-days → H1 4, X 1 paid; H2 1 (missed a snapshot) and H3 2 (0 txs) burnt
    assert.deepEqual(pick(snap.drops.holding), [13_125_000, 8, 2, 8_203_125, 4_921_875, 4_921_875]);
    assert.equal(snap.burnt, 4_921_875, "only the holding rules burn when every share pool has a poster");
    assert.equal(snap.posters, 3);
    assert.deepEqual(snap.snapshots, { taken: 5, total: 5 });
    const xp = Object.fromEntries(snap.entries);
    assert.equal(xp[H1], 1000 + 43_121_000 + 6_562_500);
    assert.equal(xp[X], 1_640_625);
    assert.equal(xp[H2], 3000, "a non-poster keeps what it earned instantly");
    assert.equal(xp[H3], undefined);
    assert.ok(snap.total <= config.seasonBudget(4));
    const p = await settlement.proofFor(H1, 4);
    assert.equal(p.amount, xp[H1]);
    assert.equal(merkle.verifyProof(p.proof, snap.root, merkle.leafHash(H1, 4n, BigInt(p.amount))), true);
    assert.deepEqual(p.shares.map((x) => x.bucket).sort(), ["active", "holding"]);

    // payout: credits the frozen shares to balances, once
    const bal = await L.getBalance(H1);
    const pay = await settlement.payoutSeason(4);
    assert.deepEqual([pay.done, pay.total], [true, 5]);
    assert.equal((await L.getBalance(H1)) - bal, 43_121_000 + 6_562_500);
    await settlement.payoutSeason(4);
    await s.del(K.payoutCursor(4)); // even with the cursor lost, nothing pays twice
    await settlement.payoutSeason(4);
    assert.equal((await L.getBalance(H1)) - bal, 43_121_000 + 6_562_500);
    assert.equal(await s.num(K.poolEnd(4, "holding")), 8_203_125);
    const drop = (await L.ledger(X))[0];
    assert.deepEqual([drop.reason, drop.season, drop.bucket, drop.amount], ["holding_drop", 4, "holding", 1_640_625]);
    assert.equal(await L.getBalance(U2), 300, "a non-poster gets no season share");
    assert.equal(await L.getBalance(U1), 100 + 624_600);
    // the frozen season takes no late season posts
    const late = await subs.submit(H3, { kind: "season_post", url: "https://x.com/a/status/1" }).catch((e) => e);
    assert.ok(late instanceof Error);
  });
  // ── auto-pace: the daily split (season 5: clean counters in both modes) ──
  const S5 = S1 + 168 * DAY;
  const Q = addr(), P1 = addr(), P2 = addr(), P3 = addr();
  let day0Allowance = 0;
  let day1Plan;

  await scenario("daily split: a quiet day's lone poster gets the 5% wallet cap; the rest rolls forward", async () => {
    setNow(S5 + 3600_000);
    const d0 = await pace.paceDay("active");
    day0Allowance = d0.allowance;
    assert.equal(d0.allowance, Math.floor(config.instantCap("active", 5) / 42), "allowance = remaining ÷ days left");
    const r = await activity.payActivity("active", Q, config.scaledReward(5000, 5), "x_post", "sub:quiet");
    assert.ok(r.entry.amount >= 1 && r.entry.amount <= r.units, "small instant slice, never above the table");
    const t = await pace.todayPool("active", Q);
    assert.deepEqual([t.participants, t.mine.units], [1, r.units]);
    assert.equal(t.walletCap, pace.walletCap(d0.allowance));
    assert.equal(t.mine.provisional, t.walletCap - r.entry.amount, "provisional share stops at the wallet cap");
    setNow(S5 + DAY + 3600_000);
    assert.equal((await pace.closeDueDays()).closed >= 1, true);
    assert.equal(await L.getBalance(Q), pace.walletCap(d0.allowance), "instant + day share = 5% of the day");
    const plan0 = await s.get(K.paceClose(5, "active", d0.day));
    assert.equal(plan0.rolled, plan0.leftover - plan0.sharesTotal);
    assert.ok(plan0.rolled > d0.allowance * 0.9, "the other ~95% isn't paid that day");
    assert.ok((await pace.paceDay("active")).allowance > d0.allowance, "…and lifts the next allowances");
    const share = (await L.ledger(Q))[0];
    assert.deepEqual([share.reason, share.season, share.bucket], ["dayshare", 5, "active"]);
  });

  await scenario("daily split: a busy day splits by weight, Telegram 3x weighs 3x; shares feed the 90% basis", async () => {
    tgLinks.add(P3);
    const base = config.scaledReward(5000, 5);
    for (const [w, ref] of [[P1, "b1"], [P2, "b2"], [P3, "b3"]]) await activity.payActivity("active", w, base, "x_post", `sub:${ref}`);
    // 100 more posters, so nobody here reaches the 5% cap
    for (let i = 0; i < 100; i++) await activity.payActivity("active", addr(), base, "x_post", `sub:fill${i}`);
    const d1 = await pace.paceDay("active");
    setNow(S5 + 2 * DAY + 3600_000);
    // a close stops at its 25s deadline and resumes on the next call; a slow link
    // (local → Upstash) can need several calls
    for (let i = 0; i < 20 && !(await pace.closeDay(5, "active", d1.day)); i++);
    await pace.closeDueDays();
    day1Plan = await s.get(K.paceClose(5, "active", d1.day));
    assert.equal(day1Plan.done, true);
    assert.equal(day1Plan.participants, 103);
    assert.equal(day1Plan.capped, 0);
    assert.ok(day1Plan.instantPaid + day1Plan.sharesTotal <= d1.allowance, "never more than the day's allowance");
    const sh = Object.fromEntries(day1Plan.shares);
    assert.equal(sh[P1], sh[P2]);
    assert.ok(Math.abs(sh[P3] - 3 * sh[P1]) <= 3, "3x weight, 3x share");
    const p1Total = await L.getBalance(P1);
    assert.ok(pace.walletCap(day0Allowance) > 2 * p1Total, "the quiet day paid its poster far more than a busy day pays each");
    assert.equal(await s.zscore(K.lbBucket(5, "active"), P1), p1Total, "daily shares count toward the season-end basis");
  });

  await scenario("daily split: an empty day rolls into later allowances; close is idempotent", async () => {
    const d2 = await pace.paceDay("active"); // touched, nobody acts
    setNow(S5 + 3 * DAY + 3600_000);
    const before = await L.getBalance(P3);
    await pace.closeDueDays();
    const d3 = await pace.paceDay("active");
    assert.ok(d3.allowance > d2.allowance, "unspent budget lifts the next allowance");
    assert.equal((await s.get(K.paceClose(5, "active", d2.day))).shares.length, 0);
    // replay the busy day's close with its cursor lost: refIds make it a no-op
    await s.del(K.paceCursor(5, "active", day1Plan.day));
    await s.set(K.paceClose(5, "active", day1Plan.day), { ...day1Plan, done: false });
    let closedAgain = false;
    for (let i = 0; i < 20 && !closedAgain; i++) closedAgain = await pace.closeDay(5, "active", day1Plan.day);
    assert.equal(closedAgain, true);
    await pace.closeDueDays();
    assert.equal(await L.getBalance(P3), before, "no share paid twice");
  });

  await scenario("water-filling: capped wallets get their room, the excess re-splits, the rest rolls", async () => {
    assert.deepEqual(pace.waterFill(100, [{ units: 1, room: 50 }, { units: 1, room: 50 }, { units: 8, room: 10 }]), [45, 45, 10]);
    assert.deepEqual(pace.waterFill(100, [{ units: 1, room: 20 }, { units: 1, room: 20 }, { units: 1, room: 20 }]), [20, 20, 20], "everyone capped: 40 rolls");
    // cascade: 7 caps first, then 2, then 1 → all capped, 10 rolls
    assert.deepEqual(pace.waterFill(100, [{ units: 1, room: 30 }, { units: 2, room: 30 }, { units: 7, room: 30 }]), [30, 30, 30]);
    assert.deepEqual(pace.waterFill(90, [{ units: 1, room: 100 }, { units: 2, room: 100 }]), [30, 60], "no cap binding: plain pro-rata");
    assert.deepEqual(pace.waterFill(50, [{ units: 5, room: 0 }, { units: 1, room: 100 }]), [0, 50], "no room left: no share");
    const big = pace.waterFill(1_000_000, Array.from({ length: 50 }, (_, i) => ({ units: i + 1, room: 30_000 })));
    assert.ok(big.every((v) => v <= 30_000) && big.reduce((a, v) => a + v, 0) <= 1_000_000);
    assert.ok(big[0] < big[10] && big[48] === 30_000, "pro-rata below the cap, capped at the top");
  });

  await scenario("daily split: one whale alpha counts, but the 5% cap bounds it; the rest share its excess", async () => {
    setNow(S5 + 5 * DAY + 3600_000);
    const d = await pace.paceDay("active");
    const whale = addr();
    tgLinks.add(whale);
    await activity.payActivity("active", whale, config.scaledReward(250_000, 5), "alpha", "sub:whale"); // max alpha × 3
    const small = Array.from({ length: 30 }, () => addr());
    for (const [i, w] of small.entries()) await activity.payActivity("active", w, config.scaledReward(5000, 5), "x_post", `sub:sm${i}`);
    setNow(S5 + 6 * DAY + 3600_000);
    await pace.closeDueDays();
    const plan = await s.get(K.paceClose(5, "active", d.day));
    const sh = Object.fromEntries(plan.shares);
    const whaleTotal = (await L.ledger(whale)).reduce((a, e) => a + e.amount, 0);
    assert.ok(whaleTotal <= plan.walletCap, `whale ${whaleTotal} ≤ cap ${plan.walletCap}`);
    assert.ok(whaleTotal >= plan.walletCap - 1, "…and gets the full cap");
    const others = small.map((w) => sh[w]);
    assert.ok(Math.max(...others) - Math.min(...others) <= 1, "the small posters split the rest evenly");
    // without the cap the whale's weight (3 × 15,625 vs 30 × 312) would have taken ~83% of the pool
    assert.ok(others[0] > (plan.leftover * config.scaledReward(5000, 5)) / plan.totalUnits, "they get more than plain pro-rata");
    assert.ok(plan.sharesTotal + plan.instantPaid <= d.allowance);
  });

  await scenario("daily split: a surge can't spend more than a quarter of the day instantly", async () => {
    const d = await pace.paceDay("active");
    const big = config.scaledReward(30_000, 5);
    let ones = 0;
    for (let i = 0; i < 400; i++) {
      const r = await activity.payActivity("active", addr(), big, "alpha", `sub:surge${i}`);
      if (r.entry.amount === 1) ones++;
    }
    const spent = await s.num(K.paceSpent(5, "active", d.day));
    assert.ok(ones > 0, "past the instant quarter, actions pay 1 point now");
    assert.ok(spent <= d.allowance * 0.25 + big + 400, `instant spend ${spent} vs allowance ${d.allowance}`);
    setNow(S5 + 7 * DAY + 3600_000);
    await pace.closeDueDays();
    const plan = await s.get(K.paceClose(5, "active", d.day));
    assert.ok(plan.instantPaid + plan.sharesTotal <= d.allowance);
    assert.ok(plan.sharesTotal >= d.allowance * 0.7, "the rest still reaches the day's participants at close");
  });

  await scenario("daily split: last day of a season — a welcome paid that day can't make the close drop shares", async () => {
    setNow(S5 + 41 * DAY + 3600_000);
    const last = await pace.paceDay("active");
    assert.equal(last.remainingDays, 1);
    const L1 = addr(), L2 = addr(), W = addr();
    await activity.payActivity("active", L1, config.scaledReward(5000, 5), "x_post", "sub:last1");
    await activity.payActivity("active", L2, config.scaledReward(5000, 5), "x_post", "sub:last2");
    await L.emit("active", W, 1000, "welcome", `welcome:${W}`); // draws on the same instant budget, after the allowance was fixed
    setNow(S5 + 42 * DAY + 3600_000); // season 6
    await pace.closeDueDays();
    const plan = await s.get(K.paceClose(5, "active", last.day));
    assert.equal(plan.done, true);
    assert.equal(plan.shares.length, 2, "both posters get their share");
    assert.ok(Math.abs(plan.shares[0][1] - plan.shares[1][1]) <= 1, "pro-rata");
    for (const [a, v] of plan.shares) assert.equal((await L.ledger(a))[0].amount, v, "every planned share was credited");
    assert.ok((await s.num(K.pool(5, "active"))) <= config.instantCap("active", 5), "the cap holds");
  });

  await scenario("unspent daily budget joins the season pot: a small community's posters get it at close", async () => {
    const S7 = S1 + 6 * 42 * DAY;
    const end7 = S7 + 42 * DAY;
    setNow(S7 + 3600_000);
    const us = [addr(), addr(), addr()];
    for (const u of us) tx(u, 60);
    const base = config.scaledReward(2500, 7);
    for (const [i, u] of us.entries()) await activity.payActivity("amu", u, base, "simp_post", `sub:s7-${i}`);
    // only U1 and U2 post in the final 48h
    await s.saddEach(K.seasonPosters(7), [us[0], us[1]]);
    setNow(end7 + 3600_000);
    const snap = await settlement.freezeSeason(7, "harness"); // closes all 42 days first
    const cap = config.instantCap("amu", 7);
    const paid = await s.num(K.pool(7, "amu"));
    const d = snap.drops.amu;
    assert.ok(paid < cap * 0.1, `the 3-wallet community used little of its daily budget (${paid} of ${cap})`);
    assert.equal(d.instantLeftover, cap - paid);
    assert.equal(d.pot, config.endPot("amu", 7) + d.instantLeftover);
    assert.equal(d.recipients, 2);
    assert.ok(d.burnt <= 2, "posters take it all (only rounding dust)");
    const sh = Object.fromEntries(snap.shares.filter(([, b]) => b === "amu").map(([a, , v]) => [a, v]));
    assert.equal(sh[us[2]], undefined, "the non-poster gets no season share");
    assert.ok(Math.abs(sh[us[0]] - sh[us[1]]) <= 1);
    assert.equal(paid + d.paid + d.burnt, config.bucketBudget("amu", 7), "the sub-pool's whole season budget is accounted for");
    // a sub-pool with no posters burns pot + leftover
    assert.equal(snap.drops.active.burnt, snap.drops.active.pot);
    assert.equal(snap.drops.active.instantLeftover, config.instantCap("active", 7));
  });

  // ── 42-day simulations on a fresh in-memory store (memory mode only: ~100k payouts) ──
  async function simulate(n, label, { surgeDay = -1 } = {}) {
    const { MemoryStore } = await load("lib/points/store.ts");
    const saved = globalThis.__simpPointsStore;
    globalThis.__simpPointsStore = new MemoryStore();
    const st = store();
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const wallets = Array.from({ length: n }, () => addr());
    wallets.forEach((w, i) => (i % 2 === 0 ? tgLinks.add(w) : tgLinks.delete(w)));
    const cap = config.instantCap("active", 1);
    const days = [];
    let exhausted = 0;
    try {
      for (let d = 0; d < 42; d++) {
        setNow(S1 + d * DAY + 3600_000);
        await pace.closeDueDays({ deadline: Date.now() + 600_000 });
        const pd = await pace.paceDay("active");
        const ck = config.checkinReward(1, Math.min(d + 1, 11));
        const post = config.scaledReward(5000, 1);
        let sample = 0;
        for (let i = 0; i < n; i++) {
          const w = wallets[i];
          const surge = d === surgeDay;
          const acts = [];
          if (surge || rnd() < 0.8) acts.push(["checkin", ck]);
          const posts = surge ? 3 : Math.floor(rnd() * 3); // 0–2 a day, everyone ×3 on a surge
          for (let k = 0; k < posts; k++) acts.push(["x_post", post]);
          if (rnd() < 1 / 30) acts.push(["alpha", 30_000]);
          for (let j = 0; j < acts.length; j++) {
            const [reason, base] = acts[j];
            try {
              const r = await activity.payActivity("active", w, base, reason, `sim:${d}:${i}:${j}`);
              if (i === 1) sample += r.entry.amount;
            } catch (e) {
              if (e.code === "pool_exhausted") exhausted++;
              else throw e;
            }
          }
        }
        days.push({ d: d + 1, day: pd.day, allowance: pd.allowance, rate: pd.rate, sampleInstant: sample, sampleWallet: wallets[1] });
      }
      setNow(S1 + 42 * DAY + 3600_000);
      await pace.closeDueDays({ deadline: Date.now() + 600_000 });
      for (const x of days) {
        const plan = await st.get(K.paceClose(1, "active", x.day));
        x.participants = plan.participants;
        x.paid = plan.instantPaid + plan.sharesTotal;
        x.capped = plan.capped;
        x.walletCap = plan.walletCap;
        assert.ok(plan.shares.every(([, v]) => v <= plan.walletCap), `day ${x.d}: no share above the 5% cap`);
        const shareRow = plan.shares.find(([a]) => a === x.sampleWallet);
        x.sampleTotal = x.sampleInstant + (shareRow ? shareRow[1] : 0);
      }
      const paid = await st.num(K.pool(1, "active"));
      return { label, n, cap, paid, exhausted, days };
    } finally {
      globalThis.__simpPointsStore = saved;
    }
  }

  const fmt = (v) => Math.round(v).toLocaleString("en-US");
  const sims = {};
  for (const [n, opts] of [[100, {}], [421, { surgeDay: 20 }], [1000, {}]]) {
    await scenario(`42-day pace sim, ${n} wallets (half Telegram 3x${opts.surgeDay ? ", a surge on day 21" : ""}): budget lasts, cap holds`, async () => {
      if (MODE !== "memory") return console.log("        (skipped on Upstash: ~100k payouts)");
      const r = await simulate(n, `${n}`, opts);
      sims[n] = r;
      assert.equal(r.exhausted, 0, "never pool_exhausted");
      assert.ok(r.paid <= r.cap, `paid ${r.paid} ≤ cap ${r.cap}`);
      assert.ok(r.paid >= r.cap * 0.97, `uses the budget: ${r.paid} of ${r.cap}`);
      for (const x of r.days) {
        assert.ok(x.paid <= x.allowance, `day ${x.d}: paid ${x.paid} ≤ allowance ${x.allowance}`);
        assert.ok(x.allowance > 0 && x.paid > 0, `day ${x.d} still pays`);
      }
      const spread = Math.max(...r.days.map((x) => x.allowance)) / Math.min(...r.days.map((x) => x.allowance));
      assert.ok(spread < 1.2, `allowance stays level across the season (max/min ${spread.toFixed(2)})`);
      if (opts.surgeDay >= 0) {
        const s0 = r.days[opts.surgeDay - 1], s1 = r.days[opts.surgeDay];
        assert.ok(s1.participants >= s0.participants && s1.paid <= s1.allowance, "the surge day still pays only its allowance");
        assert.ok(r.days[opts.surgeDay + 1].rate < s1.rate, "the day after a surge pays a smaller instant slice");
      }
    });
  }
  for (const n of [100, 1000]) {
    if (sims[n]) {
      const c = sims[n].days.reduce((a, x) => a + x.capped, 0);
      console.log(`        ${n} wallets: used ${((sims[n].paid / sims[n].cap) * 100).toFixed(2)}% of the instant budget, ${c} wallet-days capped`);
    }
  }
  if (sims[421]) {
    console.log("\n        421 wallets, active pool, season 1 (sample wallet = one Telegram-free holder):");
    for (const x of sims[421].days.filter((d) => [1, 2, 7, 21, 22, 35, 42].includes(d.d))) {
      console.log(
        `        day ${String(x.d).padStart(2)}: allowance ${fmt(x.allowance)} · max/wallet ${fmt(x.walletCap)} · ${x.participants} simps (${x.capped} capped) · paid ${fmt(x.paid)} · rate ${x.rate.toFixed(4)} · sample ${fmt(x.sampleInstant)} now + share = ${fmt(x.sampleTotal)}`,
      );
    }
  }

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
