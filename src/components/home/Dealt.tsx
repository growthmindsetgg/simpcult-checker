"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The slips get dealt onto the table once, the first time they scroll into view.
 * Server HTML is fully visible; the "undealt" state only applies after mount
 * (data-armed), so no JS = no hidden content. The motion itself is CSS
 * (`translate` + opacity, staggered) in home.module.css.
 */
export function Dealt({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "armed" | "dealt">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.9) return; // already on screen: leave it be
    setState("armed");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setState("dealt");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -18% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} data-deal={state}>
      {children}
    </div>
  );
}
