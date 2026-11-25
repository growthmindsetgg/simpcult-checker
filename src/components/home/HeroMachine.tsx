"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Decorative slot cabinet for the home hero. It is a toy: no points, no
 * server, no outcome that means anything. The real game lives at /games and
 * settles every spin server-side.
 */

type Sym = "heart" | "seven" | "diamond" | "star" | "dollar";
const SYMBOLS: Sym[] = ["heart", "seven", "diamond", "star", "dollar"];
const N = SYMBOLS.length;
const LOOPS = 12;
const STRIP = Array.from({ length: N * LOOPS }, (_, i) => SYMBOLS[i % N]);
const HEART = SYMBOLS.indexOf("heart");
const NAMES: Record<Sym, string> = { heart: "heart", seven: "seven", diamond: "diamond", star: "star", dollar: "dollar" };

function Glyph({ s }: { s: Sym }) {
  switch (s) {
    case "heart":
      return (
        <svg viewBox="0 0 24 24" className="reel-glyph reel-heart">
          <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.4 3.5 4.1 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" />
        </svg>
      );
    case "diamond":
      return (
        <svg viewBox="0 0 24 24" className="reel-glyph reel-line">
          <path d="M6.5 4h11l4 5.5L12 20.5 2.5 9.5 6.5 4Z M2.5 9.5h19 M9 4l3 16.5L15 4" />
        </svg>
      );
    case "star":
      return (
        <svg viewBox="0 0 24 24" className="reel-glyph reel-line">
          <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7L12 3Z" />
        </svg>
      );
    case "seven":
      return <span className="reel-glyph reel-text">7</span>;
    case "dollar":
      return <span className="reel-glyph reel-text reel-dollar">$</span>;
  }
}

function message(r: Sym[]): string {
  const [a, b, c] = r;
  if (a === b && b === c) {
    if (a === "heart") return "♥︎ ♥︎ ♥︎ jackpot. the real machine pays in SIMP Points.";
    if (a === "dollar") return "$ $ $ points that might mean something someday.";
    if (a === "seven") return "7 7 7 lucky. now try it with real points.";
    return "three of a kind. the machine likes you.";
  }
  if (a === b || b === c || a === c) return "two out of three. so close it's embarrassing.";
  return "no match. good thing the demo is free.";
}

function rollDemo(): number[] {
  // a demo should feel generous: one in six spins lands three of a kind
  if (Math.random() < 1 / 6) {
    const s = Math.floor(Math.random() * N);
    return [s, s, s];
  }
  return [0, 1, 2].map(() => Math.floor(Math.random() * N));
}

export function HeroMachine() {
  // start on a near miss, then the first spin lands three hearts
  const [pos, setPos] = useState<number[]>([1, 3, 2]);
  const [instant, setInstant] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spin = useCallback((targets: number[]) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setSpinning(true);
    setResult("");
    // snap to the first loop silently, then roll forward several loops
    setInstant(true);
    setPos((p) => p.map((x) => x % N));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        setInstant(false);
        setPos(targets.map((t, i) => N * (6 + i * 2) + t));
      }),
    );
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => {
        setSpinning(false);
        setResult(message(targets.map((t) => SYMBOLS[t])));
      },
      reduce ? 50 : 2050,
    );
  }, []);

  useEffect(() => {
    const t = setTimeout(() => spin([HEART, HEART, HEART]), 700);
    return () => {
      clearTimeout(t);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [spin]);

  const landed = pos.map((p) => STRIP[p]);

  return (
    <div className="machine" data-spinning={spinning}>
      <div className="machine-top">
        <span className="t-wide-sm">simp machine</span>
        <span className="bulbs" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 3) * 0.12}s` }} />
          ))}
        </span>
      </div>

      <div className="machine-window" aria-hidden>
        {pos.map((p, i) => (
          <div className="reel" key={i}>
            <div
              className="reel-strip"
              style={{
                transform: `translate3d(0, ${-(p / STRIP.length) * 100}%, 0)`,
                transition: instant ? "none" : `transform ${1.1 + i * 0.4}s cubic-bezier(0.12, 0.8, 0.22, 1)`,
              }}
            >
              {STRIP.map((s, k) => (
                <div className="reel-cell" key={k}>
                  <Glyph s={s} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <span className="payline" />
      </div>

      <div className="machine-foot">
        <p className="machine-result" aria-live="polite">
          <span className="sr-only">
            {!spinning && result ? `demo spin landed ${landed.map((s) => NAMES[s]).join(", ")}. ` : ""}
          </span>
          {spinning ? "rolling…" : result || " "}
        </p>
        <button type="button" className="spin-btn" onClick={() => spin(rollDemo())} disabled={spinning} aria-label="demo spin, uses no points">
          spin
        </button>
      </div>
      <p className="machine-note">demo reels. no points used.</p>
    </div>
  );
}
