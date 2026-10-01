"use client";

import { useEffect } from "react";

/** delegates a press ripple on .pillbtn and .btn-primary — no per-button wiring */
export function GlobalRipple() {
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    function onDown(e: PointerEvent) {
      const el = (e.target as Element | null)?.closest(
        ".pillbtn, .btn-primary",
      ) as HTMLElement | null;
      if (!el) return;
      if (!el.classList.contains("ripple")) el.classList.add("ripple");
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.1;
      const dot = document.createElement("span");
      dot.className = "ripple-dot";
      dot.style.width = dot.style.height = `${size}px`;
      dot.style.left = `${e.clientX - r.left}px`;
      dot.style.top = `${e.clientY - r.top}px`;
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 700);
    }

    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
