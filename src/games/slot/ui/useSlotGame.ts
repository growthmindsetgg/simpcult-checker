"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { BET_STEPS, DEFAULT_BET, LINE_RULES, PAYLINES, SCATTER, WILD, WIN_TIERS, type SymbolId } from "../config";
import { gridFromStops } from "../engine";
import { randomHex, verifySpin, CLIENT_SEED_RE } from "../fair";
import type { RecentSpin, SlotError, SlotState, SpinResponse } from "../types";
import { artCredits, useSymbolArt, type SymbolArtMap } from "./symbols";
import { applyFaces, setFaceOwner, useFaces } from "./faces";
import { loadMuted, setMuted as persistMuted, sfx, unlockAudio } from "./sound";
import type { Verification } from "./Fairness";
import { toast } from "@/components/Toast";
import { casino, type CasinoControls } from "@/casino/contract";

/**
 * All of the slot's game logic, with no opinion about how reels are drawn.
 *
 * The money path (state fetch, the spin request and its retries, seeds,
 * browser-side verification, balance bookkeeping) is unchanged from the
 * original SlotGame; only the reel calls go through a `ReelsDriver`, which is
 * either the DOM reels or the 3D cabinet (`casino.controls.cabinet`).
 */

export type Tier = "small" | "nice" | "big" | "mega";
export type WinCell = readonly [reel: number, row: number];
export type Status = "loading" | "signedOut" | "ready" | "error";

export interface ReelsDriver {
  /** start every reel spinning, open-ended */
  startSpin(): void;
  /** land on grid[reel][row]; resolves when the last reel has settled */
  stop(grid: SymbolId[][], opts: { staggerMs: number; anticipationReel: number | null }): Promise<void>;
  /** show a grid with no spin */
  show(grid: SymbolId[][]): void;
  /** light winning cells; empty clears */
  highlight(cells: readonly WinCell[], tier: Tier | null): void;
}

export const MIN_SPIN_MS = 650; // reels always spin at least this long
export const STAGGER_MS = 230; // gap between reel stops
export const ANTICIPATION_MS = 1150; // extra hunting time on the last reel
const RETRY_DELAY_MS = 700;
const BREAK_NUDGE_EVERY = 8; // straight losses before the machine suggests a break
const STOP_TIMEOUT_MS = 9000; // a driver that never resolves (stage torn down mid-spin) can't hold a spin hostage
const LEVER_TIMEOUT_MS = 1800;
export const ATTRACT_GRID = gridFromStops([6, 30, 52]);

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; err: SlotError };

// the machine's voice (research/lore/COPY-IDEAS.md): "aw dangit", never "keep going"
const LINES = {
  idle: "let's go simping.",
  spinning: ["devotion in progress…", "the reels are simping…"],
  loss: ["aw dangit.", "aw dangit. the reels didn't simp back.", "not this time. devotion is a long game.", "the machine is a tourist. you're not."],
  small: ["a little devotion, returned."],
  nice: ["the reels simped back.", "points for the faithful."],
  big: ["the machine bows to you."],
  mega: ["the cult is pleased."],
  breather: ["aw dangit, again. maybe say gsimp and come back tomorrow?", "the machine will be here tomorrow. so will we."],
} as const;

export const fmt = (n: number) => n.toLocaleString("en-US");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newSeed = () => randomHex(8);
/** resolve when `p` settles or after `ms`, whichever comes first; never rejects */
const settle = (p: Promise<unknown> | undefined, ms: number) =>
  Promise.race([Promise.resolve(p).then(() => undefined, () => undefined), sleep(ms)]);

export function tierFor(win: number, bet: number): Tier | null {
  if (win <= 0) return null;
  const m = win / bet;
  if (m >= WIN_TIERS.mega) return "mega";
  if (m >= WIN_TIERS.big) return "big";
  if (m >= WIN_TIERS.nice) return "nice";
  return "small"; // got something back, but less than the bet: no fanfare
}

/**
 * Should the last reel hunt? Only when something rare is one symbol away: two
 * love letters showing, or a 100x+ line (Monad or SIMP) on the first two reels.
 * That is roughly 1 spin in 11, so the moment stays special.
 */
export function anticipationReel(grid: SymbolId[][]): number | null {
  const last = grid.length - 1;
  let letters = 0;
  for (let r = 0; r < last; r++) for (const s of grid[r]) if (s === SCATTER) letters++;
  if (letters >= last) return last;
  const big = LINE_RULES.filter((r) => r.pays >= 100);
  for (const rows of PAYLINES) {
    const cells = rows.slice(0, last).map((row, reel) => grid[reel][row]);
    if (cells.includes(SCATTER)) continue;
    if (big.some((rule) => cells.every((c) => c === WILD || rule.members.includes(c)))) return last;
  }
  return null;
}

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const data = await r.json().catch(() => ({}));
    if (r.ok) return { ok: true, data: data as T };
    return { ok: false, status: r.status, err: { code: "server", error: "something went wrong", ...(data as object) } as SlotError };
  } catch {
    return { ok: false, status: 0, err: { code: "server", error: "you look offline. check your connection." } };
  }
}

/**
 * Send one spin. The server treats (seed commitment, your seed, bet) as one
 * spin no matter how often it arrives, so when a request fails without an
 * answer (offline, timeout, 5xx, "busy") we send the IDENTICAL body once more:
 * if the first attempt did land, the retry returns that same spin.
 * Only a rotated commitment ("stale-commit") starts over, with a brand-new seed.
 */
async function postSpin(bet: number, seed: string, hash: string): Promise<ApiResult<SpinResponse>> {
  const send = (clientSeed: string, serverSeedHash: string) =>
    api<SpinResponse>("/api/games/slot/spin", { method: "POST", body: JSON.stringify({ bet, clientSeed, serverSeedHash }) });

  let r = await send(seed, hash);
  if (!r.ok && (r.status === 0 || r.status >= 500 || r.err.code === "busy")) {
    await sleep(RETRY_DELAY_MS);
    r = await send(seed, hash);
  }
  if (!r.ok && r.err.code === "stale-commit" && r.err.serverSeedHash) r = await send(newSeed(), r.err.serverSeedHash);
  return r;
}

function readPref<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const v = JSON.parse(raw) as unknown;
      if (ok(v)) return v;
    }
  } catch {}
  return fallback;
}
function writePref(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const NOOP_DRIVER: ReelsDriver = { startSpin() {}, stop: async () => {}, show() {}, highlight() {} };

/** the stage's controls and intro flag, as React state */
export function useCasino(): { controls: CasinoControls | null; introDone: boolean } {
  const controls = useSyncExternalStore(casino.subscribe, () => casino.controls, () => null);
  const introDone = useSyncExternalStore(casino.subscribe, () => casino.introDone, () => false);
  return { controls, introDone };
}

export type SlotGameApi = ReturnType<typeof useSlotGame>;

/**
 * @param domDriver  the DOM reels' driver (null while they aren't mounted)
 * @param stageExpected  true when a 3D stage is (or will be) on screen: spins wait for its intro
 * @param introGraceOver  the stage's intro has run long enough: unlock spins even without `introDone`
 */
export function useSlotGame({
  domDriver,
  stageExpected,
  introGraceOver = false,
}: {
  domDriver: RefObject<ReelsDriver | null>;
  stageExpected: boolean;
  introGraceOver?: boolean;
}) {
  const { art: baseArt, ready: artReady } = useSymbolArt();
  const faces = useFaces();
  const art: SymbolArtMap = useMemo(() => applyFaces(baseArt, faces), [baseArt, faces]);
  const { controls, introDone } = useCasino();

  const busy = useRef(false);
  const alive = useRef(true);
  // the "this spin" readout: the win count-up writes straight into the element with this id
  const winId = `slot-win-${useId().replace(/[^\w-]/g, "")}`;
  const winNode = () => document.getElementById(winId);
  const countCancel = useRef<(() => void) | null>(null);
  const lossStreak = useRef(0);
  const lineTurn = useRef(0);

  const [status, setStatus] = useState<Status>("loading");
  const [balance, setBalance] = useState(0); // what the readout shows (lags during win count-up)
  const [serverBalance, setServerBalance] = useState(0); // last balance the server confirmed
  const [hash, setHash] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSpin[]>([]);
  const [bet, setBet] = useState(DEFAULT_BET);
  const [clientSeed, setClientSeed] = useState("");
  const [muted, setMutedState] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const [spinning, setSpinning] = useState(false);
  const [grid, setGrid] = useState<SymbolId[][]>(ATTRACT_GRID);
  const [winCells, setWinCells] = useState<ReadonlySet<string>>(() => new Set());
  const [winLines, setWinLines] = useState<number[]>([]);
  const [lastWin, setLastWin] = useState(0);
  const [tier, setTier] = useState<Tier | null>(null);
  const [say, setSay] = useState<string>(LINES.idle);
  const [banner, setBanner] = useState<{ tier: Tier; amount: number; key: number } | null>(null);
  const [lastSpin, setLastSpin] = useState<SpinResponse | null>(null);
  const [verification, setVerification] = useState<Verification>("none");

  /** next line from a set, in rotation (no repeats back to back) */
  const pick = (set: readonly string[]) => set[lineTurn.current++ % set.length];

  // ── boot: prefs, motion preference, server state ─────────────────────────
  useEffect(() => {
    alive.current = true;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration of browser-only prefs */
    setMutedState(loadMuted());
    setBet(readPref("simp-slot-bet", (v): v is number => typeof v === "number" && BET_STEPS.includes(v), DEFAULT_BET));
    setClientSeed(newSeed());
    /* eslint-enable react-hooks/set-state-in-effect */
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduceMotion(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => {
      alive.current = false;
      mq.removeEventListener("change", onMq);
      countCancel.current?.();
      sfx.stopWhir();
    };
  }, []);

  const loadState = useCallback(async () => {
    const r = await api<SlotState>("/api/games/slot/state");
    if (!alive.current) return;
    if (r.ok) {
      setBalance(r.data.balance);
      setServerBalance(r.data.balance);
      setHash(r.data.serverSeedHash);
      setRecent(r.data.recent);
      setStatus("ready");
      setFaceOwner(r.data.address);
    } else if (r.status === 401) {
      setStatus("signedOut");
      setFaceOwner(null);
    } else setStatus("error");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void loadState();
  }, [loadState]);

  // any 5xx (storage not configured yet, a cold store) is "warming up": look again quietly now and then
  useEffect(() => {
    if (status !== "error") return;
    const t = setInterval(() => void loadState(), 20000);
    return () => clearInterval(t);
  }, [status, loadState]);

  // no commitment yet means a spin is still settling on the server: ask again shortly
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    if (status !== "ready" || hash !== null || spinning) return;
    const t = setTimeout(() => void loadState().then(() => alive.current && setPoll((p) => p + 1)), 1500);
    return () => clearTimeout(t);
  }, [status, hash, spinning, poll, loadState]);

  // a cabinet that registers (or re-registers after a quality change) shows what's true now
  const gridRef = useRef(grid);
  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);
  useEffect(() => {
    // a stage may register before its cabinet has mounted, so the handle can still be missing
    if (controls && !busy.current) (controls.cabinet as ReelsDriver | null)?.show(gridRef.current);
  }, [controls]);

  const changeBet = (dir: 1 | -1) => {
    const i = BET_STEPS.indexOf(bet);
    const next = BET_STEPS[Math.min(BET_STEPS.length - 1, Math.max(0, i + dir))];
    if (next !== bet) {
      setBet(next);
      writePref("simp-slot-bet", next);
      unlockAudio();
      sfx.press();
    }
  };

  const toggleMute = () => {
    const m = !muted;
    setMutedState(m);
    persistMuted(m);
    if (!m) unlockAudio();
  };

  // ── win count-up: writes text directly, no React renders per frame ───────
  const countUp = (to: number, ms: number, onDone: () => void) => {
    countCancel.current?.();
    const el = winNode();
    if (!el || ms <= 0) {
      if (el) el.textContent = fmt(to);
      onDone();
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    let lastTick = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(to * eased));
      if (t - lastTick > 70 && k < 1) {
        lastTick = t;
        sfx.countTick();
      }
      if (k < 1) raf = requestAnimationFrame(step);
      else {
        countCancel.current = null;
        onDone();
      }
    };
    raf = requestAnimationFrame(step);
    countCancel.current = () => {
      cancelAnimationFrame(raf);
      el.textContent = fmt(to);
      countCancel.current = null;
      onDone();
    };
  };

  const canAfford = serverBalance >= bet;
  const seedValid = CLIENT_SEED_RE.test(clientSeed);
  /** with a stage on screen, spins wait for its intro and its controls */
  const stageReady = !stageExpected || (!!controls && (introDone || introGraceOver));
  const canSpin = status === "ready" && !!hash && canAfford && seedValid && artReady && stageReady;

  // ── the spin ──────────────────────────────────────────────────────────────
  const spin = async () => {
    if (busy.current || !canSpin || !hash) return;
    busy.current = true;
    unlockAudio();
    countCancel.current?.();
    setSpinning(true);
    setWinCells(new Set());
    setWinLines([]);
    setBanner(null);
    setLastWin(0);
    setTier(null);
    setSay(pick(LINES.spinning));
    const w = winNode();
    if (w) w.textContent = "0";
    const before = serverBalance;
    const startGrid = grid;
    setBalance(before - bet); // show the bet leaving right away

    // one driver for the whole spin, even if the stage comes or goes meanwhile
    const stage = casino.controls;
    const reels: ReelsDriver = stage?.cabinet ?? domDriver.current ?? NOOP_DRIVER;
    reels.highlight([], null);

    // the minimum spin time counts from when the reels actually start moving
    let t0 = performance.now();
    sfx.spinStart();
    // the lever is pulled while the request is in flight; reels start once it lands
    let pulled: Promise<void> = Promise.resolve();
    if (stage) {
      sfx.lever();
      pulled = settle(stage.pullLever(), LEVER_TIMEOUT_MS).then(() => {
        t0 = performance.now();
        reels.startSpin();
      });
    } else reels.startSpin();

    // Each spin uses a seed the server has never seen: the one shown (auto or
    // typed) for this spin, then a fresh one for the next. Reusing a seed would
    // let the server pick its next committed seed after already knowing yours.
    const seedNow = clientSeed;
    setClientSeed(newSeed());
    const r = await postSpin(bet, seedNow, hash);
    await pulled;

    const elapsed = performance.now() - t0;
    if (elapsed < MIN_SPIN_MS) await sleep(MIN_SPIN_MS - elapsed);
    if (!alive.current) return;

    if (!r.ok) {
      // land back on what was showing, then ask the server what is true
      await settle(reels.stop(startGrid, { staggerMs: 120, anticipationReel: null }), STOP_TIMEOUT_MS);
      if (!alive.current) return;
      sfx.stopWhir();
      sfx.error();
      setGrid(startGrid.map((c) => [...c]));
      setBalance(before);
      if (r.status === 401) setStatus("signedOut");
      else void loadState();
      if (r.err.code === "insufficient") {
        setSay("out of points. the machine will wait. so will we.");
      } else {
        setSay(LINES.idle);
        toast.bad("that spin didn't go through", r.err.error);
      }
      busy.current = false;
      setSpinning(false);
      return;
    }

    const res = r.data;
    if (res.balance !== null) setServerBalance(res.balance);
    const antic = reduceMotion ? null : anticipationReel(res.grid);
    await settle(reels.stop(res.grid, { staggerMs: reduceMotion ? 120 : STAGGER_MS, anticipationReel: antic }), STOP_TIMEOUT_MS);
    if (!alive.current) return;
    sfx.stopWhir();
    setGrid(res.grid);
    setHash(res.nextServerSeedHash);
    if (!res.nextServerSeedHash || res.balance === null) void loadState();
    setLastSpin(res);
    setRecent((prev) =>
      [
        {
          spinId: res.spinId,
          at: Date.now(),
          bet: res.bet,
          totalWin: res.totalWin,
          stops: res.stops,
          clientSeed: res.clientSeed,
          serverSeed: res.serverSeed,
          serverSeedHash: res.serverSeedHash,
        },
        ...prev.filter((p) => p.spinId !== res.spinId),
      ].slice(0, 20),
    );

    // verify in the browser, independently of the server
    setVerification("checking");
    verifySpin({
      serverSeed: res.serverSeed,
      serverSeedHash: res.serverSeedHash,
      clientSeed: res.clientSeed,
      bet: res.bet,
      stops: res.stops,
      totalWin: res.totalWin,
    })
      .then((v) => alive.current && setVerification(v.hashOk && v.outcomeOk ? "ok" : "fail"))
      .catch(() => alive.current && setVerification("fail"));

    const won = tierFor(res.totalWin, res.bet);
    if (res.creditPending) toast.warn("win logged", "your points are queued and will land shortly.");
    busy.current = false;
    setSpinning(false);
    casino.controls?.react(won ?? "loss");

    if (!won) {
      lossStreak.current += 1;
      const nudge = lossStreak.current % BREAK_NUDGE_EVERY === 0;
      setSay(pick(nudge ? LINES.breather : LINES.loss));
      if (res.balance !== null) setBalance(res.balance);
      return;
    }
    lossStreak.current = 0;
    setSay(pick(LINES[won]));
    const cells = new Set<string>();
    for (const w of res.lineWins) PAYLINES[w.line].forEach((row, reel) => cells.add(`${reel}:${row}`));
    if (res.scatterWin > 0) res.grid.forEach((col, reel) => col.forEach((s, row) => s === SCATTER && cells.add(`${reel}:${row}`)));
    setWinCells(cells);
    setWinLines(res.lineWins.map((w) => w.line));
    setLastWin(res.totalWin);
    setTier(won);
    reels.highlight(
      [...cells].map((k) => k.split(":").map(Number) as unknown as WinCell),
      won,
    );
    const showBanner = won === "big" || won === "mega";
    if (won === "small") sfx.smallWin();
    else sfx.win(won);
    if (showBanner) setBanner({ tier: won, amount: res.totalWin, key: Date.now() });
    const ms = reduceMotion ? 0 : won === "mega" ? 2600 : won === "big" ? 1700 : won === "nice" ? 650 : 300;
    countUp(res.totalWin, ms, () => {
      if (alive.current && res.balance !== null) setBalance(res.balance);
    });
    if (showBanner) setTimeout(() => alive.current && setBanner((b) => (b && b.amount === res.totalWin ? null : b)), ms + 1400);
  };

  // the 3D lever (and anything else outside React) asks for a spin with a window event
  const spinRef = useRef(spin);
  useEffect(() => {
    spinRef.current = spin;
  });
  useEffect(() => {
    const onLever = () => void spinRef.current();
    window.addEventListener("simp:lever", onLever);
    return () => window.removeEventListener("simp:lever", onLever);
  }, []);

  const credits = useMemo(() => artCredits(art), [art]);

  return {
    // state
    status,
    balance,
    serverBalance,
    bet,
    hash,
    recent,
    clientSeed,
    seedValid,
    muted,
    reduceMotion,
    spinning,
    grid,
    winCells,
    winLines,
    lastWin,
    tier,
    say,
    banner,
    lastSpin,
    verification,
    art,
    artReady,
    credits,
    canAfford,
    canSpin,
    stageReady,
    introDone,
    controls,
    winId,
    // actions
    spin,
    changeBet,
    toggleMute,
    setClientSeed,
    newClientSeed: () => setClientSeed(newSeed()),
    retry: () => {
      setStatus("loading");
      void loadState();
    },
  };
}
