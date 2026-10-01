"use client";

/**
 * "the muse" — simp cult's neon sign.
 * A woman's profile drawn as glowing neon tube lines (original line art),
 * draws itself on mount (CSS dashoffset), then idles with a soft tube flicker.
 */
const STROKES = [
  // face profile (facing right)
  "M 296 118 C 344 116, 378 152, 376 202 C 375 226, 368 242, 364 254 C 362 262, 370 270, 378 280 C 392 296, 404 312, 404 326 C 404 336, 396 340, 386 342 C 383 343, 383 347, 386 351 C 392 358, 393 366, 388 372 C 386 378, 388 384, 390 392 C 393 406, 386 424, 372 434 C 356 445, 336 450, 322 450 C 310 450, 302 456, 298 468 C 293 486, 294 506, 298 522",
  // brow, eye, lashes
  "M 322 214 C 340 204, 360 206, 372 216",
  "M 318 236 C 332 226, 350 228, 360 240",
  "M 360 240 l 9 -5 M 352 234 l 6 -8 M 343 230 l 2 -9",
  // ear
  "M 252 266 C 238 258, 228 276, 236 294 C 240 304, 250 306, 256 300",
  // hair outer + inner strand
  "M 296 118 C 244 106, 190 130, 174 190 C 160 242, 178 292, 192 338 C 204 376, 186 414, 160 450 C 138 482, 150 524, 182 542 C 214 560, 258 546, 270 508",
  "M 226 146 C 204 190, 212 250, 228 300 C 242 344, 232 392, 214 430 C 200 460, 212 494, 240 500",
  // neck + shoulders
  "M 298 522 C 276 552, 240 574, 198 588",
  "M 358 470 C 380 500, 412 530, 452 550",
  // heart at the hair tip
  "M 182 542 C 172 530, 152 536, 156 552 C 160 566, 182 576, 182 576 C 182 576, 204 566, 208 552 C 212 536, 192 530, 182 542 Z",
];

function Layer({ delay, ...g }: { delay: number } & React.SVGProps<SVGGElement>) {
  return (
    <g {...g}>
      {STROKES.map((d, i) => (
        <path key={i} d={d} pathLength={1} className="neon-draw" style={{ animationDelay: `${delay + i * 0.12}s` }} />
      ))}
    </g>
  );
}

export function NeonMuse({ className = "", size = 560, delay = 0.6 }: { className?: string; size?: number; delay?: number }) {
  return (
    <div className={`neon ${className}`} style={{ width: size, height: size * 1.2 }} aria-hidden>
      <svg viewBox="140 90 340 520" width="100%" height="100%" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <defs>
          <linearGradient id="neon-grad" gradientUnits="userSpaceOnUse" x1="150" y1="100" x2="470" y2="600">
            <stop offset="0%" stopColor="#b56bff" />
            <stop offset="55%" stopColor="#ff4fd8" />
            <stop offset="100%" stopColor="#ff7fe4" />
          </linearGradient>
        </defs>
        {/* wide glow */}
        <Layer delay={delay} stroke="url(#neon-grad)" strokeWidth={18} opacity={0.6} style={{ filter: "blur(12px)" }} />
        {/* tube */}
        <Layer delay={delay} stroke="url(#neon-grad)" strokeWidth={4} />
        {/* hot core */}
        <Layer delay={delay} stroke="#fff" strokeWidth={1.3} opacity={0.7} />
      </svg>
    </div>
  );
}
