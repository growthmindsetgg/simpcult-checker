"use client";

import { useSyncExternalStore } from "react";
import type { Quality } from "./contract";

/**
 * Pick a render tier once per page load. Cheap heuristics only; the scene can
 * still step down at runtime (drei PerformanceMonitor) by calling setQuality.
 */
function forcedFromUrl(): Quality | null {
  if (typeof window === "undefined") return null;
  try {
    const forced = new URLSearchParams(window.location.search).get("quality");
    if (forced === "high" || forced === "mid" || forced === "low") return forced;
  } catch {}
  return null;
}

/** true when `?quality=` pins the tier: the runtime PerformanceMonitor must not step it down */
export function isQualityForced(): boolean {
  return forcedFromUrl() !== null;
}

function detect(): Quality {
  if (typeof window === "undefined") return "low";
  const forced = forcedFromUrl();
  if (forced) return forced;

  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  if (nav.connection?.saveData) return "low";

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const c = document.createElement("canvas");
    gl = c.getContext("webgl2") ?? c.getContext("webgl");
  } catch {}
  if (!gl) return "low";

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 8;
  if (coarse || small || cores <= 4 || mem <= 4) return "mid";
  return "high";
}

let current: Quality | null = null;
const subs = new Set<() => void>();

export function setQuality(q: Quality) {
  if (q === current) return;
  current = q;
  subs.forEach((s) => s());
}

export function useQuality(): Quality | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    () => {
      if (current === null) current = detect();
      return current;
    },
    () => null, // server: unknown until mounted
  );
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia("(prefers-reduced-motion: reduce)");
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}
