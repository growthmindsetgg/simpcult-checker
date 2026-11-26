"use client";

import { useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { PAYLINES } from "../config";
import { Reels, type ReelsHandle } from "./Reels";
import { WinBurst } from "./WinBurst";
import { sfx } from "./sound";
import { ANTICIPATION_MS, type ReelsDriver, type SlotGameApi } from "./useSlotGame";
import styles from "./slot.module.css";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The DOM machine: the low-tier / no-WebGL / reduced-motion cabinet. It owns
 * the WAAPI reels and exposes them to the game as a ReelsDriver.
 */
export function DomMachine({ game, driverRef }: { game: SlotGameApi; driverRef: Ref<ReelsDriver | null> }) {
  const reels = useRef<ReelsHandle>(null);
  const [anticipate, setAnticipate] = useState<number | null>(null);

  useImperativeHandle(
    driverRef,
    (): ReelsDriver => ({
      startSpin: () => reels.current?.start(),
      async stop(grid, { staggerMs, anticipationReel }) {
        const landed: Promise<void>[] = [];
        for (let i = 0; i < grid.length; i++) {
          if (i === anticipationReel) {
            setAnticipate(i);
            sfx.anticipation(ANTICIPATION_MS / 1000);
            await sleep(ANTICIPATION_MS);
          }
          landed.push(reels.current?.stop(i, grid[i], () => sfx.reelStop(i)) ?? Promise.resolve());
          if (i < grid.length - 1) await sleep(staggerMs);
        }
        await Promise.all(landed);
        setAnticipate(null);
      },
      show() {}, // the settled grid is React state
      highlight() {}, // so are the winning cells
    }),
    [],
  );

  const { grid, art, artReady, winCells, winLines, lastSpin, banner, reduceMotion, spinning, say } = game;

  const linePaths = useMemo(() => {
    const xs = [15.833, 50, 84.167];
    const ys = [16.667, 50, 83.333];
    return winLines.map((l) => {
      const pts = PAYLINES[l].map((row, reel) => `${xs[reel]} ${ys[row]}`);
      return { l, d: `M${pts.join(" L")}` };
    });
  }, [winLines]);

  return (
    <div className={styles.machine} data-spinning={spinning} data-win={game.tier ?? undefined}>
      <div className={styles.topper}>
        <span className={styles.bulbs} aria-hidden>
          {Array.from({ length: 11 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className={styles.sign}>Simp Machine</span>
      </div>

      <div className={styles.bezel}>
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
        </div>
      </div>

      <p className={styles.voice} role="status" aria-live="polite">
        {say}
      </p>
      <div className={styles.tray} aria-hidden />
    </div>
  );
}
