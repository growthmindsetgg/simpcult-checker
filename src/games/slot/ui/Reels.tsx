"use client";

import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from "react";
import { REELS, ROWS, STRIPS, type SymbolId } from "../config";
import type { SymbolArtMap } from "./symbols";
import { isFace } from "./faces";
import styles from "./slot.module.css";

/**
 * The reels. Motion is driven imperatively with the Web Animations API on one
 * `transform` per strip (compositor-only, no React renders per frame).
 *
 * Each strip is a column of cells. Rows 0..M-1 repeat a fixed P-symbol cycle
 * taken from that reel's real strip; rows M..M+2 are the settled symbols; row
 * M+3 lets the spin-up "kick" peek below. Because the cycle repeats, the strip
 * can loop between two identical positions forever while the server answers.
 *
 * Stopping: read where the strip is, write the result into three rows a fixed
 * distance above the window (always offscreen), and decelerate onto them with
 * an ease-out whose starting speed matches the loop speed, then a small settle.
 */

const P = 8; // cycle length (rows)
const M = 24; // first settled row (multiple of P)
const N = M + ROWS + 1; // total rows per strip
const LOOP_TOP = 13; // loop runs between showing row LOOP_TOP+P and LOOP_TOP
const K = 4; // rows travelled while decelerating
const SPEED = 20; // rows per second at full spin
const KICK = 0.16; // rows the strip pulls back before spinning
const OVERSHOOT = 0.12; // rows it overshoots on landing

const EASE_IN = "cubic-bezier(0.45, 0, 0.75, 0.25)"; // end slope 3 → hands off to the loop at SPEED
const EASE_OUT = "cubic-bezier(0.33, 1, 0.68, 1)"; // start slope ≈ 3 → picks up from the loop at SPEED
const EASE_SETTLE = "cubic-bezier(0.45, 0, 0.55, 1)";

const cycleFor = (reel: number): SymbolId[] =>
  Array.from({ length: P }, (_, j) => STRIPS[reel][(reel * 11 + j) % STRIPS[reel].length]);
const CYCLES = Array.from({ length: REELS }, (_, r) => cycleFor(r));
const rowSymbol = (reel: number, row: number, col: SymbolId[]) => (row >= M && row < M + ROWS ? col[row - M] : CYCLES[reel][row % P]);

/** face symbols render as cameos; the flag follows imperative src rewrites too */
const markFace = (img: HTMLImageElement, id: SymbolId) => {
  const cell = img.parentElement;
  if (cell) cell.toggleAttribute("data-face", isFace(id));
};

const settledTransform = `translate3d(0, ${(-M / N) * 100}%, 0)`;
const px = (rows: number, h: number) => `translate3d(0, ${-rows * h}px, 0)`;

export type ReelsHandle = {
  /** begin spinning every reel (call on click, before the server answers) */
  start(): void;
  /** decelerate one reel onto `col`; resolves once it has landed. `onLand` fires at the thunk. */
  stop(reel: number, col: SymbolId[], onLand?: () => void): Promise<void>;
};

type Props = {
  grid: SymbolId[][];
  art: SymbolArtMap;
  winCells: ReadonlySet<string>;
  dimLosers: boolean;
  anticipate: number | null;
  reduceMotion: boolean;
  ref?: Ref<ReelsHandle>;
};

export function Reels({ grid, art, winCells, dimLosers, anticipate, reduceMotion, ref }: Props) {
  const strips = useRef<(HTMLDivElement | null)[]>([]);
  const cellH = useRef<number[]>([]);
  /** rows whose <img> we rewrote during a stop, restored once React has the new grid */
  const touched = useRef<{ reel: number; row: number }[]>([]);
  const artRef = useRef(art);
  useLayoutEffect(() => {
    artRef.current = art;
  }, [art]);

  // whenever React commits a new settled grid, snap strips to their resting
  // place (same symbols, so nothing visibly moves) and undo our rewrites
  useLayoutEffect(() => {
    for (const { reel, row } of touched.current) {
      const img = strips.current[reel]?.children[row]?.firstElementChild as HTMLImageElement | null;
      const id = rowSymbol(reel, row, grid[reel]);
      if (img) {
        img.src = artRef.current[id].src;
        img.alt = "";
        markFace(img, id);
      }
    }
    touched.current = [];
    for (const el of strips.current) {
      if (!el) continue;
      el.style.transform = settledTransform;
      el.style.opacity = "";
      for (const a of el.getAnimations()) a.cancel();
    }
  }, [grid]);

  useImperativeHandle(
    ref,
    () => ({
      start() {
        strips.current.forEach((el, r) => {
          if (!el) return;
          for (const a of el.getAnimations()) a.cancel();
          if (reduceMotion) {
            el.animate([{ opacity: 1 }, { opacity: 0.25 }], { duration: 160, easing: "ease-out", fill: "forwards" });
            return;
          }
          const h = (el.firstElementChild as HTMLElement).offsetHeight;
          cellH.current[r] = h;
          const from = M;
          const to = LOOP_TOP + P;
          const travel = from + KICK - to;
          const kickT = 0.14;
          // duration chosen so the ease-in ends exactly at SPEED (slope 3 curve)
          const dur = ((3 * travel) / SPEED / (1 - kickT)) * 1000;
          const delay = r * 45;
          el.animate(
            [
              { transform: px(from, h), easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
              { transform: px(from + KICK, h), offset: kickT, easing: EASE_IN },
              { transform: px(to, h) },
            ],
            { duration: dur, delay, fill: "forwards" },
          );
          el.animate([{ transform: px(LOOP_TOP + P, h) }, { transform: px(LOOP_TOP, h) }], {
            duration: (P / SPEED) * 1000,
            delay: delay + dur,
            iterations: Infinity,
            easing: "linear",
          });
        });
      },

      stop(reel, col, onLand) {
        const el = strips.current[reel];
        if (!el) return Promise.resolve();
        const imgs = (row: number) => el.children[row]?.firstElementChild as HTMLImageElement | null;

        if (reduceMotion) {
          col.forEach((id, i) => {
            const img = imgs(M + i);
            if (img) {
              img.src = artRef.current[id].src;
              img.alt = artRef.current[id].label;
              markFace(img, id);
            }
          });
          for (const a of el.getAnimations()) a.cancel();
          onLand?.();
          return el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 220, easing: "ease-out", fill: "forwards" })
            .finished.then(() => undefined, () => undefined);
        }

        const h = cellH.current[reel] || (el.firstElementChild as HTMLElement).offsetHeight;
        const ty = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
        const x = -ty / h; // row currently at the top of the window
        el.style.transform = px(x, h);
        for (const a of el.getAnimations()) a.cancel();

        const target = Math.floor(x) - K;
        col.forEach((id, i) => {
          const img = imgs(target + i);
          if (img) {
            img.src = artRef.current[id].src;
            markFace(img, id);
            touched.current.push({ reel, row: target + i });
          }
        });

        const travel = x - target + OVERSHOOT;
        const landAt = 0.82;
        const dur = ((3 * travel) / SPEED / landAt) * 1000;
        const t = window.setTimeout(() => onLand?.(), dur * landAt);
        const anim = el.animate(
          [
            { transform: px(x, h), easing: EASE_OUT },
            { transform: px(target - OVERSHOOT, h), offset: landAt, easing: EASE_SETTLE },
            { transform: px(target, h) },
          ],
          { duration: dur, fill: "forwards" },
        );
        return anim.finished.then(
          () => undefined,
          () => window.clearTimeout(t),
        );
      },
    }),
    [reduceMotion],
  );

  // art that fails: try its fallback source once, then show the symbol's name set on the cell
  const onArtError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const u = new URL(img.src, window.location.href);
    const path = u.pathname + u.search;
    const a = Object.values(artRef.current).find((v) => v.src === path || v.fallback === path);
    if (a?.fallback && path !== a.fallback) {
      img.src = a.fallback;
      return;
    }
    if (a && img.parentElement) img.parentElement.dataset.label = a.label;
    img.dataset.broken = "1";
  };

  return (
    <div className={styles.reels}>
      {grid.map((col, r) => (
        <div key={r} className={styles.reel} data-anticipate={anticipate === r || undefined}>
          <div
            className={styles.strip}
            ref={(node) => {
              strips.current[r] = node;
            }}
            style={{ transform: settledTransform }}
          >
            {Array.from({ length: N }, (_, row) => {
              const id = rowSymbol(r, row, col);
              const settled = row >= M && row < M + ROWS;
              const key = `${r}:${row - M}`;
              const win = settled && winCells.has(key);
              return (
                <div
                  key={row}
                  className={styles.cell}
                  data-win={win || undefined}
                  data-dim={(settled && dimLosers && !win) || undefined}
                  data-face={isFace(id) || undefined}
                  aria-hidden={!settled}
                  data-label={art[id].label}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- manifest art can be any format/aspect */}
                  <img src={art[id].src} alt={settled ? art[id].label : ""} draggable={false} decoding="async" onError={onArtError} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
