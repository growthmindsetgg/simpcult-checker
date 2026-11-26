"use client";
/**
 * Lab for the 3D stage. Portalled to <body> so the site's page-enter transform
 * can't trap the fixed layer.
 *
 * Query params: ?quality=high|mid|low  ?mode=hero|play  ?intro=1 (replay)  ?pauseAt=<s> (freeze the intro)
 */
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CasinoLazy } from "@/casino/CasinoLazy";

const noop = () => () => {};

function useLabMode(): "hero" | "play" {
  return useSyncExternalStore(
    noop,
    () => (new URLSearchParams(window.location.search).get("mode") === "hero" ? "hero" : "play"),
    () => "play",
  );
}

export function LabClient() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const mode = useLabMode();
  if (!mounted) return null;
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#0a0610" }}>
      <CasinoLazy mode={mode} fallback={<p style={{ padding: 24 }}>low tier: DOM fallback</p>} />
    </div>,
    document.body,
  );
}
