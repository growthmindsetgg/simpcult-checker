/**
 * Simp Machine: the published maths.
 *
 * Everything that decides an outcome lives here, and it is deliberately
 * isomorphic: no `server-only`, no `node:crypto`, no `@/` imports. The spin
 * route, the in-browser verifier and the RTP sim all import this same file,
 * so what players can verify is exactly what the server runs.
 *
 * ── Layout ────────────────────────────────────────────────────────────────
 * 3 reels × 3 rows, 5 fixed paylines. Each reel is a fixed strip of 64 stops.
 * A spin picks one stop per reel; that stop and the next two are the visible
 * column (top, middle, bottom). 64 is a power of two, so a stop is taken from
 * the low 6 bits of a hash byte with zero modulo bias.
 *
 * ── Paying ────────────────────────────────────────────────────────────────
 * The bet is spread evenly across the 5 lines (line bet = bet / 5; every
 * allowed bet is a multiple of 5, so every payout is a whole number of points,
 * with no rounding anywhere). Each line pays its single best rule from
 * LINE_RULES, in line-bet multiples. SIMP (wild) stands in for every symbol
 * except the love letter (scatter). Love letters pay anywhere on the grid, in
 * multiples of the total bet, on top of line wins.
 *
 * ── Return to player / house edge ─────────────────────────────────────────
 * Because the reels are independent and each payline reads one cell per reel,
 * the exact RTP depends only on how many of each symbol sits on each strip.
 * `src/games/slot/sim/rtp.ts` enumerates every one of the 64³ = 262,144
 * outcomes for the exact figure, then plays 1,000,000 spins through the real
 * engine to confirm it. Result is saved in `src/games/slot/sim/rtp-result.txt`.
 *
 *   Exact RTP   = 96.095%   (published as TARGET_RTP = 0.961 below)
 *   House edge  = 3.905%    — the points sink that keeps the season economy
 *                             from inflating. Over many spins, players keep
 *                             ~96 of every 100 points they play.
 *
 * If you change STRIP_COUNTS or LINE_RULES, re-run the sim and update
 * TARGET_RTP: `node src/games/slot/sim/run.mjs`.
 */

// ── symbols ─────────────────────────────────────────────────────────────────

export const SYMBOL_IDS = [
  "heart",
  "rose",
  "chog",
  "molandak",
  "moyaki",
  "founder-1",
  "founder-2",
  "founder-3",
  "monad",
  "wild",
  "scatter",
] as const;

export type SymbolId = (typeof SYMBOL_IDS)[number];

export type SymbolTier = "low" | "mascot" | "founder" | "top" | "wild" | "scatter";

/** Default display names. The manifest in public/games/slot/symbols can override labels. */
export const SYMBOL_META: Record<SymbolId, { tier: SymbolTier; name: string }> = {
  heart: { tier: "low", name: "Heart" },
  rose: { tier: "low", name: "Rose" },
  chog: { tier: "mascot", name: "Chog" },
  molandak: { tier: "mascot", name: "Molandak" },
  moyaki: { tier: "mascot", name: "Moyaki" },
  "founder-1": { tier: "founder", name: "Founder I" },
  "founder-2": { tier: "founder", name: "Founder II" },
  "founder-3": { tier: "founder", name: "Founder III" },
  monad: { tier: "top", name: "Monad" },
  wild: { tier: "wild", name: "SIMP" },
  scatter: { tier: "scatter", name: "Love letter" },
};

export const WILD: SymbolId = "wild";
export const SCATTER: SymbolId = "scatter";

// ── grid and lines ──────────────────────────────────────────────────────────

export const REELS = 3;
export const ROWS = 3;
export const STRIP_LEN = 64; // power of two: stop = byte & (STRIP_LEN - 1)

/** Row index (0 = top) read on each reel, left to right. */
export const PAYLINES: readonly (readonly [number, number, number])[] = [
  [1, 1, 1], // middle
  [0, 0, 0], // top
  [2, 2, 2], // bottom
  [0, 1, 2], // diagonal down
  [2, 1, 0], // diagonal up
];
export const LINES = PAYLINES.length;

// ── pay rules ───────────────────────────────────────────────────────────────

export type LineRule = {
  id: string;
  label: string;
  /** a line matches when every cell is one of these, or SIMP (wild) */
  members: readonly SymbolId[];
  /** paid in multiples of the line bet (bet / LINES) */
  pays: number;
};

/** A line pays its single highest matching rule. Three SIMPs match every rule, and SIMP pays the most. */
export const LINE_RULES: readonly LineRule[] = [
  { id: "wild", label: "3 SIMP", members: ["wild"], pays: 250 },
  { id: "monad", label: "3 Monad", members: ["monad"], pays: 100 },
  { id: "founder-1", label: "3 Founder I", members: ["founder-1"], pays: 40 },
  { id: "founder-2", label: "3 Founder II", members: ["founder-2"], pays: 40 },
  { id: "founder-3", label: "3 Founder III", members: ["founder-3"], pays: 40 },
  { id: "chog", label: "3 Chog", members: ["chog"], pays: 15 },
  { id: "molandak", label: "3 Molandak", members: ["molandak"], pays: 15 },
  { id: "moyaki", label: "3 Moyaki", members: ["moyaki"], pays: 15 },
  { id: "any-founder", label: "Any 3 founders", members: ["founder-1", "founder-2", "founder-3"], pays: 10 },
  { id: "rose", label: "3 Roses", members: ["rose"], pays: 8 },
  { id: "heart", label: "3 Hearts", members: ["heart"], pays: 5 },
  { id: "any-mascot", label: "Any 3 mascots", members: ["chog", "molandak", "moyaki"], pays: 4 },
];

/** Love letters anywhere on the grid, paid in multiples of the TOTAL bet. Index = count. */
export const SCATTER_PAYS: readonly number[] = [0, 0, 1, 15];

// ── reel strips ─────────────────────────────────────────────────────────────

/** How many of each symbol sits on each 64-stop strip. This alone sets the RTP. */
export const STRIP_COUNTS: readonly Record<SymbolId, number>[] = [
  { heart: 13, rose: 10, chog: 6, molandak: 6, moyaki: 6, "founder-1": 4, "founder-2": 4, "founder-3": 4, monad: 3, wild: 4, scatter: 4 },
  { heart: 13, rose: 10, chog: 6, molandak: 6, moyaki: 6, "founder-1": 4, "founder-2": 4, "founder-3": 4, monad: 3, wild: 4, scatter: 4 },
  { heart: 14, rose: 11, chog: 6, molandak: 6, moyaki: 6, "founder-1": 4, "founder-2": 4, "founder-3": 4, monad: 3, wild: 2, scatter: 4 },
];

/** Deterministic PRNG used ONLY to lay symbols out on the strips (never for outcomes). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Circular distance check so a 3-row window can never show two love letters on one reel. */
function stripOk(strip: SymbolId[]): boolean {
  const n = strip.length;
  for (let i = 0; i < n; i++) {
    if (strip[i] !== SCATTER) continue;
    for (let d = 1; d < ROWS; d++) if (strip[(i + d) % n] === SCATTER) return false;
  }
  // no symbol stacked three high on a strip: keeps the reels looking varied
  // (layout only: RTP depends on the counts, not the order)
  for (let i = 0; i < n; i++) {
    const a = strip[i], b = strip[(i + 1) % n], c = strip[(i + 2) % n];
    if (a === b && b === c) return false;
  }
  return true;
}

function buildStrip(counts: Record<SymbolId, number>, seed: number): SymbolId[] {
  const bag: SymbolId[] = [];
  for (const id of SYMBOL_IDS) for (let k = 0; k < counts[id]; k++) bag.push(id);
  if (bag.length !== STRIP_LEN) throw new Error(`strip must have ${STRIP_LEN} stops, has ${bag.length}`);
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const rnd = mulberry32(seed * 7919 + attempt);
    const s = bag.slice();
    for (let i = s.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    if (stripOk(s)) return s;
  }
  throw new Error("could not lay out reel strip");
}

/** The published reel strips. Same input → same strips, everywhere. */
export const STRIPS: readonly (readonly SymbolId[])[] = STRIP_COUNTS.map((c, i) => buildStrip(c, i + 1));

// ── bets ────────────────────────────────────────────────────────────────────

/** Every step is a multiple of LINES, so line bets and payouts stay whole numbers. */
export const BET_STEPS: readonly number[] = [10, 25, 50, 100, 250, 500, 1000];
export const MIN_BET = BET_STEPS[0];
export const MAX_BET = BET_STEPS[BET_STEPS.length - 1];
export const DEFAULT_BET = 50;

export function isValidBet(bet: unknown): bet is number {
  return typeof bet === "number" && Number.isInteger(bet) && BET_STEPS.includes(bet);
}

/** Exact return to player from `sim/rtp.ts` (enumeration of all 262,144 outcomes). */
export const TARGET_RTP = 0.961;
export const HOUSE_EDGE = 1 - TARGET_RTP;

// ── provably fair ───────────────────────────────────────────────────────────

/** Domain-separation tag mixed into every HMAC, so these seeds can't be replayed elsewhere. */
export const FAIRNESS_VERSION = "simp-machine:v1";

/** Win tiers, as a multiple of the bet, used only for celebration intensity. */
export const WIN_TIERS = { nice: 1, big: 10, mega: 40 } as const;
