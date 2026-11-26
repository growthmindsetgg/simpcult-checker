"use client";

import "@fontsource-variable/bodoni-moda";
import "@fontsource-variable/bodoni-moda/wght-italic.css";
import "@fontsource-variable/jetbrains-mono";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { BET_STEPS } from "../config";
import { CasinoLazy } from "@/casino/CasinoLazy";
import { useQuality } from "@/casino/quality";
import { DomMachine } from "./DomMachine";
import { Paytable } from "./Paytable";
import { Fairness } from "./Fairness";
import { fmt, useSlotGame, type ReelsDriver, type SlotGameApi } from "./useSlotGame";
import styles from "./slot.module.css";

/** how long the page waits for a 3D stage to register before falling back to the DOM machine */
const STAGE_GRACE_MS = 15000;
/** how long a registered stage may keep its intro running before spins unlock anyway */
const INTRO_GRACE_MS = 16000;

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
  const game = useSlotGame({ domDriver, stageExpected, introGraceOver: introGrace });
  const { controls, introDone } = game;

  // a stage that never shows up (or never finishes its intro) must not lock the machine
  useEffect(() => {
    if (!stageExpected || controls) return;
    const t = setTimeout(() => setForceDom(true), STAGE_GRACE_MS);
    return () => clearTimeout(t);
  }, [stageExpected, controls]);
  useEffect(() => {
    if (!controls || introDone) return;
    const t = setTimeout(() => setIntroGrace(true), INTRO_GRACE_MS);
    return () => clearTimeout(t);
  }, [controls, introDone]);

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

  const dom = <DomMachine game={game} driverRef={domDriver} />;

  return (
    <div className={styles.room} data-mode={stageExpected ? "stage" : "dom"}>
      <div className={styles.stage}>
        {stageExpected ? <CasinoLazy mode="play" fallback={dom} className={styles.canvas} /> : <div className={styles.domWrap}>{dom}</div>}
        {game.banner && (
          <div className={styles.banner} key={`banner-${game.banner.key}`} data-testid="slot-banner" data-tier={game.banner.tier}>
            <div className={styles.bannerInner}>
              <div className={styles.bannerTitle}>{game.banner.tier === "mega" ? "mega simp" : "the machine bows"}</div>
              <div className={styles.bannerAmount}>+{fmt(game.banner.amount)}</div>
            </div>
          </div>
        )}
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

function Hud({
  game,
  stage,
  onOpen,
}: {
  game: SlotGameApi;
  stage: boolean;
  onOpen: (d: Drawer) => void;
}) {
  const { status, spinning, bet, canSpin, canAfford, stageReady, controls } = game;
  const signedOut = status === "signedOut";
  const ready = status === "ready";
  const intro = stage && !stageReady;

  return (
    <div className={styles.hud} data-spinning={spinning}>
      {stage && (
        <p className={styles.hudVoice} role="status" aria-live="polite">
          {game.say}
        </p>
      )}

      <div className={styles.hudRow}>
        {/* the brass plaque: balance and this spin (nothing to show until you're seated) */}
        <div className={styles.plaque} data-hidden={signedOut || status === "error" || undefined}>
          <div className={styles.plaqueCell}>
            <span className={styles.engraved}>your points</span>
            <span className={styles.balance} data-testid="slot-balance">
              {ready ? fmt(game.balance) : "—"}
            </span>
          </div>
          <div className={styles.plaqueCell} data-zero={game.lastWin === 0}>
            <span className={styles.engraved}>this spin</span>
            <span className={styles.thisSpin}>
              <span id={game.winId} data-testid="slot-win">
                0
              </span>
            </span>
          </div>
        </div>

        {/* centre: bet + the one neon button, or the slip that explains why not */}
        <div className={styles.console}>
          {signedOut ? (
            <Slip stamp="members only" title="take a seat, simp.">
              <p>
                prove your wallet to play. spins use the SIMP Points you earn in the <Link href="/portal">portal</Link>.
              </p>
              <Link href="/join" className={styles.spin} data-size="slip">
                sign in
              </Link>
            </Slip>
          ) : status === "error" ? (
            <Slip stamp="back soon" title="the machine is warming up.">
              <p>the lights are on, the ledger isn&apos;t answering yet. give it a minute.</p>
              <button type="button" className={styles.brassBtn} onClick={game.retry}>
                try again
              </button>
            </Slip>
          ) : (
            <>
              <div className={styles.bet} role="group" aria-label="points per spin">
                <button
                  type="button"
                  className={styles.betBtn}
                  onClick={() => game.changeBet(-1)}
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
                  onClick={() => game.changeBet(1)}
                  disabled={spinning || bet === BET_STEPS[BET_STEPS.length - 1]}
                  aria-label="more points per spin"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                className={styles.spin}
                onClick={() => void game.spin()}
                disabled={!canSpin && !spinning}
                data-busy={spinning}
                aria-disabled={spinning || !canSpin}
                aria-keyshortcuts="Space"
              >
                spin
              </button>
            </>
          )}
        </div>

        <div className={styles.side}>
          <button type="button" className={styles.brassBtn} onClick={() => onOpen("paytable")}>
            pay card
          </button>
          <button type="button" className={styles.brassBtn} onClick={() => onOpen("fairness")}>
            fairness
          </button>
          <button
            type="button"
            className={styles.iconBtn}
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
          stage ? "pull the lever, or press space" : "spin when ready. space works too."
        ) : signedOut || status === "error" ? null : (
          "spins use SIMP Points only. every outcome is decided on the server, and you can check it."
        )}
      </p>
    </div>
  );
}

function Slip({ stamp, title, children }: { stamp: string; title: string; children: ReactNode }) {
  return (
    <div className={styles.slip}>
      <span className={styles.slipStamp}>{stamp}</span>
      <p className={styles.slipTitle}>{title}</p>
      <div className={styles.slipBody}>{children}</div>
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
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!mounted) return null;
  return createPortal(
    <div className={styles.portal}>
      <div className={styles.scrim} data-open={open} onClick={onClose} aria-hidden />
      <div ref={ref} className={styles.sheet} data-open={open} role="dialog" aria-modal="true" aria-label={title} inert={!open}>
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetTitle}>{title}</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="close">
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

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
