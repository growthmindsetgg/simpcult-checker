/**
 * Simp Machine engine: turns hash bytes into a grid and a payout.
 *
 * Pure and isomorphic (no server-only, no node:crypto, no `@/` imports), so the
 * spin route, the browser verifier and the RTP sim all run this exact code.
 */
import {
  LINE_RULES,
  LINES,
  PAYLINES,
  REELS,
  ROWS,
  SCATTER,
  SCATTER_PAYS,
  STRIP_LEN,
  STRIPS,
  WILD,
  type SymbolId,
} from "./config";

export type Stops = number[];
/** grid[reel][row], row 0 = top */
export type Grid = SymbolId[][];

export type LineWin = {
  line: number; // index into PAYLINES
  rule: string; // LineRule.id
  pays: number; // line-bet multiple
  win: number; // points
};

export type SpinOutcome = {
  stops: Stops;
  grid: Grid;
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  totalWin: number;
};

/** One byte per reel; the low 6 bits pick a stop (256 is a multiple of 64, so no bias). */
export function stopsFromBytes(bytes: Uint8Array): Stops {
  if (bytes.length < REELS) throw new Error("not enough entropy");
  const out: Stops = [];
  for (let r = 0; r < REELS; r++) out.push(bytes[r] & (STRIP_LEN - 1));
  return out;
}

export function gridFromStops(stops: Stops): Grid {
  return stops.map((s, r) => {
    const col: SymbolId[] = [];
    for (let row = 0; row < ROWS; row++) col.push(STRIPS[r][(s + row) % STRIP_LEN]);
    return col;
  });
}

/** Best rule for three symbols on a line, or null. Love letters never pay on a line. */
export function bestLineRule(cells: readonly SymbolId[]): { id: string; pays: number } | null {
  if (cells.includes(SCATTER)) return null;
  let best: { id: string; pays: number } | null = null;
  for (const rule of LINE_RULES) {
    if (best && rule.pays <= best.pays) continue;
    const ok = cells.every((c) => c === WILD || rule.members.includes(c));
    if (ok) best = { id: rule.id, pays: rule.pays };
  }
  return best;
}

export function evaluate(grid: Grid, bet: number): Omit<SpinOutcome, "stops" | "grid"> {
  const lineBet = bet / LINES; // whole number for every allowed bet
  const lineWins: LineWin[] = [];
  PAYLINES.forEach((rows, line) => {
    const cells = rows.map((row, reel) => grid[reel][row]);
    const best = bestLineRule(cells);
    if (best) lineWins.push({ line, rule: best.id, pays: best.pays, win: best.pays * lineBet });
  });
  let scatterCount = 0;
  for (const col of grid) for (const s of col) if (s === SCATTER) scatterCount++;
  const scatterWin = (SCATTER_PAYS[scatterCount] ?? 0) * bet;
  const totalWin = lineWins.reduce((a, w) => a + w.win, 0) + scatterWin;
  return { lineWins, scatterCount, scatterWin, totalWin };
}

export function resolveFromStops(stops: Stops, bet: number): SpinOutcome {
  const grid = gridFromStops(stops);
  return { stops, grid, ...evaluate(grid, bet) };
}

export function resolveFromBytes(bytes: Uint8Array, bet: number): SpinOutcome {
  return resolveFromStops(stopsFromBytes(bytes), bet);
}
