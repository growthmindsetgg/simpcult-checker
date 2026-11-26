import s from "./home.module.css";

/**
 * The static hero for the "low" tier (no WebGL, Save-Data, ?quality=low) and the
 * first paint before the 3D stage mounts. Pure CSS + inline SVG: velvet
 * curtains, a lacquer floor, the neon sign and one lit machine.
 */

/* bulbs around the marquee arch, on an ellipse centred at (200,128) */
const BULBS = Array.from({ length: 11 }, (_, i) => {
  const a = Math.PI + (Math.PI * (i + 1)) / 12;
  return { x: +(200 + 122 * Math.cos(a)).toFixed(1), y: +(128 + 78 * Math.sin(a)).toFixed(1) };
});

const HEART = "M8 13.2S1 9 1 4.6C1 2.4 2.7.8 4.7.8c1.4 0 2.6.8 3.3 2 .7-1.2 1.9-2 3.3-2 2 0 3.7 1.6 3.7 3.8C15 9 8 13.2 8 13.2Z";

function Cabinet() {
  return (
    <g id="cab">
      {/* plinth */}
      <rect x="44" y="600" width="312" height="30" rx="3" fill="url(#brassDark)" />
      <rect x="44" y="600" width="312" height="1.5" fill="#f6dc95" opacity=".5" />

      {/* body */}
      <rect x="58" y="172" width="284" height="430" rx="12" fill="url(#velvetBody)" stroke="url(#brass)" strokeWidth="3" />
      <rect x="66" y="180" width="268" height="414" rx="8" fill="none" stroke="#f6dc95" strokeOpacity=".14" />

      {/* marquee */}
      <path d="M64 182 V128 A136 92 0 0 1 336 128 V182 Z" fill="url(#velvetTop)" stroke="url(#brass)" strokeWidth="3" />
      {BULBS.map((b, i) => (
        <g key={i}>
          <circle cx={b.x} cy={b.y} r="5" fill="#f6dc95" opacity=".25" filter="url(#soft)" />
          <circle cx={b.x} cy={b.y} r="2.6" fill="#fff3d1" />
        </g>
      ))}
      <path d={HEART} transform="translate(176 110) scale(3)" fill="#ff8fd6" filter="url(#neonGlow)" />

      {/* reel window: brass bezel, black glass, three cream reels */}
      <rect x="84" y="214" width="232" height="150" rx="10" fill="url(#brass)" />
      <rect x="94" y="224" width="212" height="130" rx="5" fill="#07030a" />
      <rect x="94" y="224" width="212" height="130" rx="5" fill="#ff3fae" opacity=".22" filter="url(#bloom)" />
      {[102, 170, 238].map((x) => (
        <rect key={x} x={x} y="230" width="60" height="118" rx="3" fill="url(#reel)" />
      ))}
      <path d={HEART} transform="translate(114 272) scale(2.25)" fill="#ff3fae" />
      <text x="200" y="306" textAnchor="middle" className={s.posterSeven}>7</text>
      <path d={HEART} transform="translate(250 272) scale(2.25)" fill="#ff3fae" />
      <rect x="94" y="288.5" width="212" height="1.2" fill="#ff8fd6" opacity=".85" />

      {/* engraved plaque */}
      <rect x="128" y="384" width="144" height="26" rx="2" fill="url(#brass)" />
      <text x="200" y="402" textAnchor="middle" className={s.posterPlaque}>insert devotion</text>

      {/* button deck */}
      <path d="M58 432 H342 L360 470 H40 Z" fill="url(#deck)" stroke="url(#brass)" strokeWidth="2" />
      <ellipse cx="120" cy="452" rx="15" ry="5.5" fill="#2a0b1f" stroke="#7a5418" />
      <ellipse cx="170" cy="452" rx="15" ry="5.5" fill="#2a0b1f" stroke="#7a5418" />
      <ellipse cx="270" cy="452" rx="24" ry="7" fill="#ff3fae" />
      <ellipse cx="270" cy="450" rx="16" ry="3" fill="#ffd6ee" opacity=".7" />

      {/* lower door + coin tray */}
      <rect x="76" y="486" width="248" height="98" rx="4" fill="none" stroke="#d9a845" strokeOpacity=".45" />
      <rect x="150" y="548" width="100" height="22" rx="3" fill="#07030a" stroke="url(#brass)" strokeWidth="2" />

      {/* lever */}
      <rect x="340" y="318" width="14" height="30" rx="3" fill="url(#brass)" />
      <path d="M352 333 L384 206" stroke="url(#brassRod)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="386" cy="196" r="15" fill="url(#ball)" />
      <circle cx="381" cy="190" r="4" fill="#fff" opacity=".5" />
    </g>
  );
}

export function HeroPoster() {
  return (
    <div className={s.poster} aria-hidden>
      <div className={s.curtain} />
      <div className={s.cone} />
      <div className={s.floor} />

      {/* the neon sign */}
      <svg className={s.sign} viewBox="0 0 620 170" role="presentation">
        <defs>
          <filter id="signGlow" x="-20%" y="-60%" width="140%" height="220%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="b1" />
            <feGaussianBlur in="SourceAlpha" stdDeviation="11" result="b2" />
            <feFlood floodColor="#ff3fae" />
            <feComposite in2="b2" operator="in" result="g2" />
            <feFlood floodColor="#ff5cbc" />
            <feComposite in2="b1" operator="in" result="g1" />
            <feMerge>
              <feMergeNode in="g2" />
              <feMergeNode in="g2" />
              <feMergeNode in="g1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#signGlow)" className={s.signLit}>
          <rect x="14" y="14" width="592" height="142" rx="71" fill="none" stroke="#ffc6e8" strokeWidth="3" />
          <text x="310" y="112" textAnchor="middle" className={s.signText}>simp machine</text>
        </g>
      </svg>

      {/* the one lit machine, with its reflection in the lacquer */}
      <svg className={s.machine} viewBox="0 0 420 820" role="presentation">
        <defs>
          <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6dc95" />
            <stop offset=".35" stopColor="#d9a845" />
            <stop offset=".7" stopColor="#7a5418" />
            <stop offset="1" stopColor="#d9a845" />
          </linearGradient>
          <linearGradient id="brassRod" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#7a5418" />
            <stop offset=".5" stopColor="#f6dc95" />
            <stop offset="1" stopColor="#d9a845" />
          </linearGradient>
          <linearGradient id="brassDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8a6322" />
            <stop offset="1" stopColor="#2b1a08" />
          </linearGradient>
          <linearGradient id="velvetBody" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#14050e" />
            <stop offset=".3" stopColor="#3a0f2a" />
            <stop offset=".55" stopColor="#4a1236" />
            <stop offset="1" stopColor="#14050e" />
          </linearGradient>
          <linearGradient id="velvetTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a1236" />
            <stop offset="1" stopColor="#1d0716" />
          </linearGradient>
          <linearGradient id="deck" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a1842" />
            <stop offset="1" stopColor="#1d0716" />
          </linearGradient>
          <linearGradient id="reel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6d5a48" />
            <stop offset=".22" stopColor="#e9d9bb" />
            <stop offset=".5" stopColor="#fbf2df" />
            <stop offset=".78" stopColor="#e9d9bb" />
            <stop offset="1" stopColor="#6d5a48" />
          </linearGradient>
          <radialGradient id="ball" cx=".35" cy=".3" r=".75">
            <stop offset="0" stopColor="#ff9fd8" />
            <stop offset=".55" stopColor="#c21a7c" />
            <stop offset="1" stopColor="#4a0a2c" />
          </radialGradient>
          <filter id="neonGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="bloom" x="-30%" y="-40%" width="160%" height="180%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="soft">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".32" />
            <stop offset=".6" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="reflect" maskUnits="userSpaceOnUse" x="0" y="630" width="420" height="190">
            <rect x="0" y="630" width="420" height="190" fill="url(#fade)" />
          </mask>
        </defs>

        <ellipse cx="200" cy="632" rx="190" ry="16" fill="#000" opacity=".6" />
        <Cabinet />
        <g mask="url(#reflect)">
          <use href="#cab" transform="translate(0 1260) scale(1 -1)" />
        </g>
      </svg>

      <div className={s.vignette} />
    </div>
  );
}
