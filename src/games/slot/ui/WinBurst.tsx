"use client";

import { useEffect, useRef } from "react";
import styles from "./slot.module.css";

/**
 * One-shot burst of hearts for big wins. Each particle gets a single WAAPI
 * animation on transform + opacity (compositor-only), then the whole layer
 * unmounts with the banner. Not rendered at all under reduced motion.
 */
export function WinBurst({ count }: { count: number }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const w = el.offsetWidth;
    const anims: Animation[] = [];
    Array.from(el.children).forEach((node, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const dist = w * (0.32 + Math.random() * 0.38);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist * 0.8;
      const rot = (Math.random() - 0.5) * 220;
      const s = 0.7 + Math.random() * 0.8;
      anims.push(
        (node as HTMLElement).animate(
          [
            { transform: `translate3d(0,0,0) scale(${s * 0.6}) rotate(0deg)`, opacity: 0 },
            { transform: `translate3d(${dx * 0.55}px, ${dy * 0.55}px, 0) scale(${s}) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.3 },
            { transform: `translate3d(${dx}px, ${dy + w * 0.18}px, 0) scale(${s * 0.9}) rotate(${rot}deg)`, opacity: 0 },
          ],
          { duration: 1300 + Math.random() * 600, delay: Math.random() * 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" },
        ),
      );
    });
    return () => anims.forEach((a) => a.cancel());
  }, [count]);

  return (
    <div ref={root} className={styles.particles} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <svg key={i} className={styles.particle} viewBox="0 0 24 24" style={{ opacity: 0 }}>
          <path
            d="M12 21C6 16.5 3 13.2 3 9.6 3 7 5 5 7.5 5c1.8 0 3.3 1 4.5 2.6C13.2 6 14.7 5 16.5 5 19 5 21 7 21 9.6c0 3.6-3 6.9-9 11.4z"
            fill={i % 3 === 0 ? "#f6dc95" : i % 3 === 1 ? "#ff3fae" : "#d9a845"}
          />
        </svg>
      ))}
    </div>
  );
}
