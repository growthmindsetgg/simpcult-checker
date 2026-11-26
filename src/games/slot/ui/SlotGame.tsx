"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BET_STEPS, DEFAULT_BET, LINE_RULES, PAYLINES, SCATTER, WILD, WIN_TIERS, type SymbolId } from "../config";
import { gridFromStops } from "../engine";
import { randomHex, verifySpin, CLIENT_SEED_RE } from "../fair";
import type { RecentSpin, SlotError, SlotState, SpinResponse } from "../types";
import { Reels, type ReelsHandle } from "./Reels";
import { artCredits, useSymbolArt } from "./symbols";
import { loadMuted, setMuted as persistMuted, sfx, unlockAudio } from "./sound";
import { Paytable } from "./Paytable";
import { Fairness, type Verification } from "./Fairness";
import { WinBurst } from "./WinBurst";
import { toast } from "@/components/Toast";
import styles from "./slot.module.css";

const MIN_SPIN_MS = 650; // reels always spin at least this long
const STAGGER_MS = 230; // gap between reel stops
const ANTICIPATION_MS = 1150; // extra hunting time on the last reel
const RETRY_DELAY_MS = 700;
const BREAK_NUDGE_EVERY = 8; // straight losses before the machine suggests a break
const ATTRACT_GRID = gridFromStops([6, 30, 52]);

type Tier = "small" | "nice" | "big" | "mega";
type Status = "loading" | "signedOut" | "ready" | "error";
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

const fmt = (n: number) => n.toLocaleString("en-US");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newSeed = () => randomHex(8);

function tierFor(win: number, bet: number): Tier | null {
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
function anticipationReel(grid: SymbolId[][]): number | null {
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

export function SlotGame() {
  const { art, ready: artReady } = useSymbolArt();
  const reels = useRef<ReelsHandle>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const winEl = useRef<HTMLSpanElement>(null);
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
  const [anticipate, setAnticipate] = useState<number | null>(null);
  const [lastWin, setLastWin] = useState(0);
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
    } else if (r.status === 401) setStatus("signedOut");
    else setStatus("error");
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void loadState();
  }, [loadState]);

  // no commitment yet means a spin is still settling on the server: ask again shortly
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    if (status !== "ready" || hash !== null || spinning) return;
    const t = setTimeout(() => void loadState().then(() => alive.current && setPoll((p) => p + 1)), 1500);
    return () => clearTimeout(t);
  }, [status, hash, spinning, poll, loadState]);

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
    const el = winEl.current;
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
  const canSpin = status === "ready" && !!hash && canAfford && seedValid && artReady;

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
    setSay(pick(LINES.spinning));
    if (winEl.current) winEl.current.textContent = "0";
    const before = serverBalance;
    const startGrid = grid;
    setBalance(before - bet); // show the bet leaving right away

    const t0 = performance.now();
    reels.current?.start();
    sfx.spinStart();

    // Each spin uses a seed the server has never seen: the one shown (auto or
    // typed) for this spin, then a fresh one for the next. Reusing a seed would
    // let the server pick its next committed seed after already knowing yours.
    const seedNow = clientSeed;
    setClientSeed(newSeed());
    const r = await postSpin(bet, seedNow, hash);

    const elapsed = performance.now() - t0;
    if (elapsed < MIN_SPIN_MS) await sleep(MIN_SPIN_MS - elapsed);
    if (!alive.current) return;

    if (!r.ok) {
      // land back on what was showing, then ask the server what is true
      await Promise.all(startGrid.map((col, i) => sleep(i * 120).then(() => reels.current?.stop(i, col))));
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
    const landed: Promise<void>[] = [];
    for (let i = 0; i < res.grid.length; i++) {
      if (i === antic) {
        setAnticipate(i);
        sfx.anticipation(ANTICIPATION_MS / 1000);
        await sleep(ANTICIPATION_MS);
        if (!alive.current) return;
      }
      landed.push(reels.current?.stop(i, res.grid[i], () => sfx.reelStop(i)) ?? Promise.resolve());
      if (i < res.grid.length - 1) await sleep(reduceMotion ? 120 : STAGGER_MS);
    }
    await Promise.all(landed);
    if (!alive.current) return;
    sfx.stopWhir();
    setAnticipate(null);
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

    const tier = tierFor(res.totalWin, res.bet);
    if (res.creditPending) toast.warn("win logged", "your points are queued and will land shortly.");
    busy.current = false;
    setSpinning(false);

    if (!tier) {
      lossStreak.current += 1;
      const nudge = lossStreak.current % BREAK_NUDGE_EVERY === 0;
      setSay(pick(nudge ? LINES.breather : LINES.loss));
      if (res.balance !== null) setBalance(res.balance);
      return;
    }
    lossStreak.current = 0;
    setSay(pick(LINES[tier]));
    const cells = new Set<string>();
    for (const w of res.lineWins) PAYLINES[w.line].forEach((row, reel) => cells.add(`${reel}:${row}`));
    if (res.scatterWin > 0) res.grid.forEach((col, reel) => col.forEach((s, row) => s === SCATTER && cells.add(`${reel}:${row}`)));
    setWinCells(cells);
    setWinLines(res.lineWins.map((w) => w.line));
    setLastWin(res.totalWin);
    const showBanner = tier === "big" || tier === "mega";
    if (tier === "small") sfx.smallWin();
    else sfx.win(tier);
    if (showBanner) setBanner({ tier, amount: res.totalWin, key: Date.now() });
    const ms = reduceMotion ? 0 : tier === "mega" ? 2600 : tier === "big" ? 1700 : tier === "nice" ? 650 : 300;
    countUp(res.totalWin, ms, () => {
      if (alive.current && res.balance !== null) setBalance(res.balance);
    });
    if (showBanner) setTimeout(() => alive.current && setBanner((b) => (b && b.amount === res.totalWin ? null : b)), ms + 1400);
  };

  const linePaths = useMemo(() => {
    const xs = [15.833, 50, 84.167];
    const ys = [16.667, 50, 83.333];
    return winLines.map((l) => {
      const pts = PAYLINES[l].map((row, reel) => `${xs[reel]} ${ys[row]}`);
      return { l, d: `M${pts.join(" L")}` };
    });
  }, [winLines]);

  const credits = useMemo(() => artCredits(art), [art]);
  const signedOut = status === "signedOut";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:items-start lg:gap-10">
      <div className={styles.machine} data-spinning={spinning}>
        <div className={styles.marquee}>
          <div className={styles.marqueeLeft}>
            <span className={styles.title}>simp machine</span>
            <span className={styles.bulbs} aria-hidden>
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "turn sound on" : "mute sound"}
          >
            <SpeakerIcon muted={muted} />
          </button>
        </div>

        <div className={styles.readouts}>
          <div className={styles.readout}>
            <div className={styles.readoutLabel}>your points</div>
            <div className={styles.readoutValue} data-testid="slot-balance">
              {status === "ready" ? fmt(balance) : "—"}
            </div>
          </div>
          <div className={styles.readout}>
            <div className={styles.readoutLabel}>this spin</div>
            <div className={`${styles.readoutValue} ${styles.winValue}`} data-zero={lastWin === 0}>
              <span ref={winEl} data-testid="slot-win">
                0
              </span>
            </div>
          </div>
        </div>

        <div className={styles.window}>
          <div className={styles.reelsArea} data-ready={artReady}>
            <Reels
              ref={reels}
              grid={grid}
              art={art}
              winCells={winCells}
              dimLosers={winCells.size > 0}
              anticipate={anticipate}
              reduceMotion={reduceMotion}
            />
            {linePaths.length > 0 && (
              <svg className={styles.lines} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                {linePaths.map((p, i) => (
                  <path key={`${p.l}-${lastSpin?.spinId}`} d={p.d} pathLength={1} style={{ animationDelay: `${i * 90}ms` }} />
                ))}
              </svg>
            )}
            {banner && !reduceMotion && <WinBurst key={`burst-${banner.key}`} count={banner.tier === "mega" ? 36 : 22} />}
            {banner && (
              <div className={styles.banner} key={`banner-${banner.key}`} data-testid="slot-banner">
                <div className={styles.bannerInner}>
                  <div className={styles.bannerTitle}>{banner.tier === "mega" ? "mega simp" : "the machine bows"}</div>
                  <div className={styles.bannerAmount}>+{fmt(banner.amount)}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className={styles.status} role="status" aria-live="polite">
          {say}
        </p>

        <div className={styles.controls}>
          <div className={styles.bet} role="group" aria-label="points per spin">
            <button
              type="button"
              className={styles.betBtn}
              onClick={() => changeBet(-1)}
              disabled={spinning || bet === BET_STEPS[0]}
              aria-label="fewer points per spin"
            >
              −
            </button>
            <div className={styles.betValue}>
              <strong>{fmt(bet)}</strong>
              <span>per spin</span>
            </div>
            <button
              type="button"
              className={styles.betBtn}
              onClick={() => changeBet(1)}
              disabled={spinning || bet === BET_STEPS[BET_STEPS.length - 1]}
              aria-label="more points per spin"
            >
              +
            </button>
          </div>
          {signedOut ? (
            <Link href="/join" className={styles.spin} style={{ fontSize: 12 }}>
              sign in
            </Link>
          ) : (
            <button
              type="button"
              className={styles.spin}
              onClick={() => void spin()}
              disabled={!canSpin && !spinning}
              data-busy={spinning}
              aria-disabled={spinning || !canSpin}
            >
              spin
            </button>
          )}
        </div>

        <p className={styles.note}>
          {signedOut ? (
            <>
              prove your wallet on the <Link href="/join">join page</Link> to play. spins use the SIMP Points you earn in
              the <Link href="/portal">portal</Link>.
            </>
          ) : status === "error" ? (
            <>couldn&apos;t reach the machine. refresh to try again.</>
          ) : status === "ready" && !canAfford ? (
            <>
              not enough points for this spin. lower it, or earn more in the <Link href="/portal">portal</Link>.
            </>
          ) : (
            <>spins use SIMP Points only. every outcome is decided on the server, and you can check it yourself below.</>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Paytable art={art} bet={bet} />
        <Fairness
          hash={hash}
          clientSeed={clientSeed}
          seedValid={seedValid}
          onSeedChange={setClientSeed}
          onNewSeed={() => setClientSeed(newSeed())}
          lastSpin={lastSpin}
          verification={verification}
          recent={recent}
          disabled={spinning}
        />
        {credits.length > 0 && <p className={styles.credits}>art: {credits.join(". ")}. not affiliated with or endorsed by Monad Foundation.</p>}
      </div>
    </div>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      {muted ? (
        <path d="M16 9.5l5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}
