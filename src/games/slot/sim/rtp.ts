/**
 * RTP proof for the Simp Machine.
 *
 *  1. Exact: enumerates all 64³ = 262,144 equally likely stop combinations
 *     through the real engine → exact RTP, hit rate and per-spin variance.
 *  2. Simulated: plays N (default 1,000,000) spins through the real fairness
 *     path (fresh random server seed + client seed → HMAC-SHA256 → engine) and
 *     checks the result lands inside the 99.9% confidence band around (1).
 *
 * Run: node src/games/slot/sim/run.mjs [spins]
 * Output is printed and saved to src/games/slot/sim/rtp-result.txt
 */
import { createHmac, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LINE_RULES, REELS, SCATTER_PAYS, STRIP_COUNTS, STRIP_LEN, TARGET_RTP, BET_STEPS, MIN_BET, MAX_BET } from "../config";
import { resolveFromBytes, resolveFromStops } from "../engine";
import { fairMessage, outcomeBytes } from "../fair";

const BET = 100;
const spins = Number(process.argv[2] ?? 1_000_000);
const lines: string[] = [];
const log = (s = "") => {
  lines.push(s);
  console.log(s);
};
const pct = (x: number, d = 3) => `${(x * 100).toFixed(d)}%`;

// ── 1. exact enumeration ──────────────────────────────────────────────────
const t0 = Date.now();
const total = STRIP_LEN ** REELS;
let sum = 0;
let sumSq = 0;
let hits = 0;
let maxMult = 0;
const byRule = new Map<string, number>();
let scatterSum = 0;
const tiers = { "<1x": 0, "1x-10x": 0, "10x-40x": 0, ">=40x": 0 };

const stops = [0, 0, 0];
for (let a = 0; a < STRIP_LEN; a++)
  for (let b = 0; b < STRIP_LEN; b++)
    for (let c = 0; c < STRIP_LEN; c++) {
      stops[0] = a;
      stops[1] = b;
      stops[2] = c;
      const o = resolveFromStops(stops, BET);
      const m = o.totalWin / BET;
      sum += m;
      sumSq += m * m;
      if (o.totalWin > 0) {
        hits++;
        if (m < 1) tiers["<1x"]++;
        else if (m < 10) tiers["1x-10x"]++;
        else if (m < 40) tiers["10x-40x"]++;
        else tiers[">=40x"]++;
      }
      if (m > maxMult) maxMult = m;
      for (const w of o.lineWins) byRule.set(w.rule, (byRule.get(w.rule) ?? 0) + w.win / BET);
      scatterSum += o.scatterWin / BET;
    }

const exactRtp = sum / total;
const variance = sumSq / total - exactRtp * exactRtp;
const sd = Math.sqrt(variance);

log("SIMP MACHINE · RTP report");
log(`generated ${new Date().toISOString()}`);
log("");
log("layout     3 reels x 3 rows, 5 paylines, 64-stop strips");
log(`bets       ${BET_STEPS.join(" / ")} points (min ${MIN_BET}, max ${MAX_BET})`);
log(`strips     ${STRIP_COUNTS.map((c, i) => `reel ${i + 1}: ${Object.entries(c).map(([k, v]) => `${k} ${v}`).join(", ")}`).join("\n           ")}`);
log("");
log(`── exact (all ${total.toLocaleString("en-US")} outcomes, ${Date.now() - t0} ms) ──`);
log(`RTP                ${pct(exactRtp, 4)}`);
log(`house edge         ${pct(1 - exactRtp, 4)}`);
log(`published RTP      ${pct(TARGET_RTP, 1)} (config.TARGET_RTP)`);
log(`hit rate           ${pct(hits / total, 2)} of spins return something`);
log(`std dev per spin   ${sd.toFixed(3)}x bet`);
log(`max win            ${maxMult}x bet`);
log(`win size mix       ${Object.entries(tiers).map(([k, v]) => `${k}: ${pct(v / total, 3)}`).join("  ")}`);
log("");
log("RTP contribution by rule");
for (const r of LINE_RULES) log(`  ${r.label.padEnd(18)} ${String(r.pays).padStart(4)}x line   ${pct((byRule.get(r.id) ?? 0) / total, 3)}`);
log(`  ${"Love letters".padEnd(18)} ${SCATTER_PAYS.map((p, i) => (p ? `${i}:${p}x` : "")).filter(Boolean).join(" ")} bet   ${pct(scatterSum / total, 3)}`);

if (Math.abs(exactRtp - TARGET_RTP) > 0.0005) {
  log("");
  log(`WARNING: config.TARGET_RTP (${TARGET_RTP}) differs from the exact RTP; update it.`);
}

// ── sanity: node HMAC path === WebCrypto path used in the browser ─────────
for (let i = 0; i < 25; i++) {
  const ss = randomBytes(32).toString("hex");
  const cs = randomBytes(12).toString("base64url");
  const nodeBytes = createHmac("sha256", ss).update(fairMessage(cs)).digest();
  const webBytes = await outcomeBytes(ss, cs);
  if (Buffer.compare(nodeBytes, Buffer.from(webBytes)) !== 0) throw new Error("HMAC mismatch between node and WebCrypto");
}

// ── 2. Monte Carlo through the fairness path ─────────────────────────────
const t1 = Date.now();
let won = 0;
let played = 0;
let simHits = 0;
for (let i = 0; i < spins; i++) {
  const serverSeed = randomBytes(32).toString("hex");
  const clientSeed = randomBytes(12).toString("base64url");
  const bytes = createHmac("sha256", serverSeed).update(fairMessage(clientSeed)).digest();
  const o = resolveFromBytes(bytes, BET);
  played += BET;
  won += o.totalWin;
  if (o.totalWin > 0) simHits++;
}
const simRtp = won / played;
const band = (3.29 * sd) / Math.sqrt(spins); // 99.9% two-sided
const inBand = Math.abs(simRtp - exactRtp) <= band;
log("");
log(`── simulated (${spins.toLocaleString("en-US")} spins via HMAC-SHA256, ${((Date.now() - t1) / 1000).toFixed(1)} s) ──`);
log(`points played      ${played.toLocaleString("en-US")}`);
log(`points returned    ${won.toLocaleString("en-US")}`);
log(`RTP                ${pct(simRtp, 4)}`);
log(`hit rate           ${pct(simHits / spins, 2)}`);
log(`99.9% band         ${pct(exactRtp - band, 3)} .. ${pct(exactRtp + band, 3)}`);
log(`verdict            ${inBand ? "PASS: simulation agrees with the exact RTP" : "FAIL: outside the expected band"}`);

const out = join(dirname(fileURLToPath(import.meta.url)), "rtp-result.txt");
writeFileSync(out, lines.join("\n") + "\n");
console.log(`\nsaved ${out}`);
if (!inBand) process.exitCode = 1;
