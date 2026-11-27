"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { BET_STEPS } from "../config";
import { CasinoLazy } from "@/casino/CasinoLazy";
import { useQuality } from "@/casino/quality";
import { DomMachine } from "./DomMachine";
import { Paytable } from "./Paytable";
import { Fairness } from "./Fairness";
import { useCabinetClock } from "./three/live";
import { fmt, useCasino, useSlotGame, type ReelsDriver, type SlotGameApi } from "./useSlotGame";
import styles from "./slot.module.css";

/** how long the page waits for a 3D stage to register before falling back to the DOM machine */
const STAGE_GRACE_MS = 15000;
/**
 * Intro grace. The main one is 16 s of the stage's own clock (three/live.ts), so a slow device whose
 * intro runs long in wall time still finishes it. These wall-clock caps only catch a stuck stage:
 * one that registered but never drew, or one that draws so rarely its clock barely moves.
 */
const NO_FRAME_GRACE_MS = 30000;
const SLOW_STAGE_GRACE_MS = 60000;

type Drawer = "paytable" | "fairness" | null;

/**
 * The slot page's client surface: the full-bleed stage (3D cabinet when the
 * device can take it, the DOM machine otherwise) with the HUD over it.
 */
export function SlotGame() {
  const quality = useQuality();
  const [forceDom, setForceDom] = useState(false);
  const [introGrace, setIntroGrace] = useState(false);
  const stageExpected = (quality === "high" || quality === "mid") && !forceDom;

  const domDriver = useRef<ReelsDriver | null>(null);
  const { controls, introDone } = useCasino();
  const clock = useCabinetClock();

  // a stage that never shows up must not lock the machine: fall back to the DOM reels
  useEffect(() => {
    if (!stageExpected || controls) return;
    const t = setTimeout(() => setForceDom(true), STAGE_GRACE_MS);
    return () => clearTimeout(t);
  }, [stageExpected, controls]);
  // nor may a stage whose intro never finishes: 16 s of its own clock, or the wall-clock caps for a stuck one
  useEffect(() => {
    if (!controls || introDone) return;
    const t = setTimeout(() => setIntroGrace(true), clock.live ? SLOW_STAGE_GRACE_MS : NO_FRAME_GRACE_MS);
    return () => clearTimeout(t);
  }, [controls, introDone, clock.live]);
  const graceOver = introGrace || (!!controls && clock.graceOver);
  const game = useSlotGame({ domDriver, stageExpected, introGraceOver: graceOver });

  const [drawer, setDrawer] = useState<Drawer>(null);

  // Space spins (not while typing, not on key repeat, not when a control has focus)
  const spinRef = useRef(game.spin);
  useEffect(() => {
    spinRef.current = game.spin;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, button, a, summary, [contenteditable], [role=dialog]")) return;
      e.preventDefault();
      void spinRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // large wins: a zoom punch on the whole view at the moment of impact (game-feel, large tier).
  // A view-level transform, so the camera stays the director's.
  const stageEl = useRef<HTMLDivElement>(null);
  const bannerKey = game.banner?.key;
  const bannerTier = game.banner?.tier;
  useEffect(() => {
    if (!bannerKey || game.reduceMotion || !stageEl.current?.animate) return;
    const peak = bannerTier === "mega" ? 1.028 : 1.018;
    const a = stageEl.current.animate([{ transform: "scale(1)" }, { transform: `scale(${peak})`, offset: 0.22 }, { transform: "scale(1)" }], {
      duration: 420,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
    return () => a.cancel();
  }, [bannerKey, bannerTier, game.reduceMotion]);

  const dom = <DomMachine game={game} driverRef={domDriver} />;

  return (
    <div className={styles.room} data-mode={stageExpected ? "stage" : "dom"}>
      <div className={styles.stage} ref={stageEl}>
        {stageExpected ? <CasinoLazy mode="play" fallback={dom} className={styles.canvas} /> : <div className={styles.domWrap}>{dom}</div>}
      </div>

      <Hud game={game} stage={stageExpected} onOpen={setDrawer} />

      <Sheet open={drawer === "paytable"} title="the pay card" onClose={() => setDrawer(null)}>
        <Paytable art={game.art} bet={game.bet} />
      </Sheet>
      <Sheet open={drawer === "fairness"} title="check every spin" onClose={() => setDrawer(null)}>
        <Fairness
          hash={game.hash}
          clientSeed={game.clientSeed}
          seedValid={game.seedValid}
          onSeedChange={game.setClientSeed}
          onNewSeed={game.newClientSeed}
          lastSpin={game.lastSpin}
          verification={game.verification}
          recent={game.recent}
          disabled={game.spinning}
        />
      </Sheet>

      <p className={styles.credits}>
        {game.credits.length > 0 && <>art: {game.credits.join(". ")}. </>}
        fan-made. not affiliated with Monad or the Monad Foundation.
      </p>
    </div>
  );
}

// ── HUD ─────────────────────────────────────────────────────────────────────

function Hud({ game, stage, onOpen }: { game: SlotGameApi; stage: boolean; onOpen: (d: Drawer) => void }) {
  const { status, spinning, bet, canSpin, canAfford, stageReady, controls } = game;
  const signedOut = status === "signedOut";
  const ready = status === "ready";
  const intro = stage && !stageReady;
  // which gate opened the machine: the stage's intro finishing, or the grace timer (a stage that stalled)
  const unlock = !stage ? "dom" : !stageReady ? "locked" : game.introDone ? "intro" : "grace";

  return (
    <div className={styles.hud} data-spinning={spinning} data-status={status} data-unlock={unlock}>
      {/* the machine's voice; on a big win the amount takes this line (it never sits over the reels) */}
      <div className={styles.voiceSlot} data-stage={stage || undefined}>
        {stage && (
          <p className={styles.hudVoice} role="status" aria-live="polite" data-quiet={!!game.banner || undefined}>
            {game.say}
          </p>
        )}
        {game.banner && (
          <div className={styles.banner} key={`banner-${game.banner.key}`} data-testid="slot-banner" data-tier={game.banner.tier}>
            <span className={styles.bannerTitle}>{game.banner.tier === "mega" ? "mega simp" : "the machine bows"}</span>
            <span className={styles.bannerAmount}>+{fmt(game.banner.amount)}</span>
          </div>
        )}
      </div>

      <div className={styles.hudRow} data-seated={!(signedOut || status === "error") || undefined}>
        {/* left: the brass plaque once you're seated; until then the ticket that says why not stands in its place */}
        {signedOut ? (
          <Slip
            stamp="members only"
            title="take a seat, simp."
            action={
              <Link href="/join" className="btn btn-primary btn-lg">
                sign in
              </Link>
            }
          >
            prove your wallet to play. spins use the SIMP Points you earn in the <Link href="/portal">portal</Link>.
          </Slip>
        ) : status === "error" ? (
          <Slip
            stamp="back soon"
            title="the machine is warming up."
            action={
              <button type="button" className="btn btn-ghost btn-on-paper btn-sm" onClick={game.retry}>
                try again
              </button>
            }
          >
            the lights are on, the ledger isn&apos;t answering yet. give it a minute.
          </Slip>
        ) : (
          <div className={styles.plaque}>
            <div className={styles.plaqueCell}>
              <span className={`plate ${styles.engraved}`}>your points</span>
              <span className={styles.balance} data-testid="slot-balance">
                {ready ? fmt(game.balance) : "—"}
              </span>
            </div>
            <div className={styles.plaqueCell} data-zero={game.lastWin === 0}>
              <span className={`plate ${styles.engraved}`}>this spin</span>
              <span className={styles.thisSpin}>
                <span id={game.winId} data-testid="slot-win">
                  0
                </span>
              </span>
            </div>
          </div>
        )}

        {/* centre: bet + the one neon button (only once you're seated) */}
        <div className={styles.console}>
          {signedOut || status === "error" ? null : (
            <>
              <div className={styles.bet} role="group" aria-label="points per spin">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => game.changeBet(-1)}
                  disabled={spinning || bet === BET_STEPS[0]}
                  aria-label="fewer points per spin"
                >
                  <BetGlyph />
                </button>
                <div className={styles.betValue}>
                  <strong>{fmt(bet)}</strong>
                  <span>per spin</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  onClick={() => game.changeBet(1)}
                  disabled={spinning || bet === BET_STEPS[BET_STEPS.length - 1]}
                  aria-label="more points per spin"
                >
                  <BetGlyph plus />
                </button>
              </div>
              <button
                type="button"
                className={`btn btn-primary btn-xl ${styles.spin}`}
                onClick={() => void game.spin()}
                disabled={!canSpin && !spinning}
                aria-busy={spinning}
                aria-disabled={spinning || !canSpin}
                aria-keyshortcuts="Space"
              >
                spin
              </button>
            </>
          )}
        </div>

        <div className={styles.side}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen("paytable")}>
            pay card
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpen("fairness")}>
            fairness
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={game.toggleMute}
            aria-pressed={game.muted}
            aria-label={game.muted ? "turn sound on" : "mute sound"}
          >
            <SpeakerIcon muted={game.muted} />
          </button>
        </div>
      </div>

      <p className={styles.hint}>
        {intro ? (
          <>
            the lights are coming up.{" "}
            {controls && (
              <button type="button" className={styles.textBtn} onClick={() => controls.skipIntro()}>
                skip
              </button>
            )}
          </>
        ) : status === "loading" ? (
          "opening the room…"
        ) : ready && !canAfford ? (
          <>
            not enough points for this spin. lower it, or earn more in the <Link href="/portal">portal</Link>.
          </>
        ) : ready ? (
          <span data-howto>{stage ? "pull the lever, or press space" : "spin when ready. space works too."}</span>
        ) : signedOut || status === "error" ? null : (
          "spins use SIMP Points only. every outcome is decided on the server, and you can check it."
        )}
      </p>
    </div>
  );
}

/** a cream pit slip: title and one short line on the left, the single action on the right */
function Slip({ stamp, title, action, children }: { stamp: string; title: string; action: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.slip}>
      <span className={styles.slipStamp}>{stamp}</span>
      <div className={styles.slipText}>
        <p className={styles.slipTitle}>{title}</p>
        <p className={styles.slipBody}>{children}</p>
      </div>
      <div className={styles.slipAction}>{action}</div>
    </div>
  );
}

const noopSubscribe = () => () => {};

// ── drawers ─────────────────────────────────────────────────────────────────

function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);
  // portalled to <body>: the page template animates a transform, which would trap position: fixed
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <div className={styles.portal}>
      <div className={styles.scrim} data-open={open} onClick={onClose} aria-hidden />
      <div ref={ref} className={styles.sheet} data-open={open} role="dialog" aria-modal="true" aria-label={title} inert={!open}>
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetTitle}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** − / + drawn, not typed: the display face's italic minus and plus sit off-centre in a square key */
function BetGlyph({ plus = false }: { plus?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d={plus ? "M6 12h12M12 6v12" : "M6 12h12"} />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
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
