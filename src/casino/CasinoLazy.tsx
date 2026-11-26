"use client";
/**
 * Client-only entry for the 3D stage. Picks the quality tier, and renders
 * `fallback` (the DOM experience) on the "low" tier or before mount.
 */
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useQuality, useReducedMotion } from "./quality";
import type { StageMode } from "./scene/Stage";

const Stage = dynamic(() => import("./scene/Stage"), { ssr: false });

export function CasinoLazy({ mode, fallback, className }: { mode: StageMode; fallback: ReactNode; className?: string }) {
  const q = useQuality();
  const reduced = useReducedMotion();
  if (q === null || q === "low") return <>{fallback}</>;
  return <Stage mode={mode} quality={q} reducedMotion={reduced} className={className} />;
}
