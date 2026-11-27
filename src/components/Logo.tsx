import s from "./chrome.module.css";

/**
 * `Heart` is the house glyph (Sections.tsx imports it). Keep the path.
 */
const HEART_D =
  "M8 13.2S1 9 1 4.6C1 2.4 2.7.8 4.7.8c1.4 0 2.6.8 3.3 2 .7-1.2 1.9-2 3.3-2 2 0 3.7 1.6 3.7 3.8C15 9 8 13.2 8 13.2Z";

export function Heart({ className = "h-2.5 w-2.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 14" className={className} aria-hidden>
      <path d={HEART_D} fill="currentColor" />
    </svg>
  );
}

/*
 * The wordmark, lettered like the room sign: italic "sımp" (dotless ı, which
 * the Bodoni latin file carries) whose tittle is the one lit heart, a tapered
 * brass swash drawn out of the p's tail, and MACHINE beside it (inline, nav)
 * or beneath it (stacked, footer).
 *
 * The word, heart and swash are drawn once at 27 units with the baseline at
 * y=0 and scaled per lockup. Optical size is pinned so the glyphs keep the
 * same shapes (and the heart stays over the stem) at every rendered size.
 * Positions were measured on the loaded Bodoni italic; dx is hand kerning.
 */
const FACE = "var(--font-bodoni), Didot, Georgia, serif";
const WORD_DX = "0 -0.2 0 0";
const HEART = { x: 14.25, y: -20.1, w: 6.5 };
const SWASH =
  "M42.6 5.9C34 6.9 22 7 12 5.8 6 5.1 1.2 4.6-1.6 2.9-2.4 2.4-2.8 1.7-2.6 1L-3.6 1.6C-3.8 2.8-2.6 3.9-1.2 4.6 1.6 5.8 6.4 6.5 12 7 22 8.2 34 8.1 42.8 6.7Z";
const BALL = { cx: -2.75, cy: 0.75, r: 1.4 };

const LOCKUPS = {
  inline: {
    viewBox: "0 3 139 30",
    word: { x: 4.5, y: 24, scale: 1 },
    sub: { x: 66, y: 24, size: 10.5, track: 0.24 },
  },
  stacked: {
    viewBox: "0 0 104 66",
    word: { x: 8.6, y: 36, scale: 46 / 27 },
    sub: { x: 9, y: 63, size: 11, track: 0.44 },
  },
};

export function Logo({ className = "", variant = "inline" }: { className?: string; variant?: "inline" | "stacked" }) {
  const L = LOCKUPS[variant];
  const hs = HEART.w / 16;
  const glow = `logo-glow-${variant}`;
  return (
    <span className={`${s.logo} ${className}`} data-variant={variant}>
      <svg viewBox={L.viewBox} className={s.logoSvg} aria-hidden focusable="false">
        <defs>
          <filter id={glow} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>
        <g transform={`translate(${L.word.x} ${L.word.y}) scale(${L.word.scale})`}>
          <path d={SWASH} className={s.logoSwash} />
          <circle {...BALL} className={s.logoSwash} />
          <text x="0" y="0" dx={WORD_DX} className={s.logoWord} style={{ fontFamily: FACE, fontSize: 27 }}>
            sımp
          </text>
          <g transform={`translate(${HEART.x} ${HEART.y}) scale(${hs})`}>
            <path d={HEART_D} className={s.logoGlow} filter={`url(#${glow})`} />
            <path d={HEART_D} className={s.logoHeart} />
          </g>
        </g>
        <text
          x={L.sub.x}
          y={L.sub.y}
          className={s.logoSub}
          style={{ fontFamily: FACE, fontSize: L.sub.size, letterSpacing: `${L.sub.track}em` }}
        >
          MACHINE
        </text>
      </svg>
      <span className="sr-only">simp machine</span>
    </span>
  );
}
