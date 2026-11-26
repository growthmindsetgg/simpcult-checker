"use client";
/**
 * Dev-only: lets the lab step the frozen stage by hand (the browser pane used
 * for screenshots doesn't run requestAnimationFrame while it is hidden).
 *   window.__casinoLab.step(seconds, fps = 30)  → advances every useFrame + renders
 */
import { useThree } from "@react-three/fiber";
import { useEffect, type RefObject } from "react";
import type { CharacterHandle } from "../contract";
import { setQuality } from "../quality";

type LabApi = { step(seconds: number, fps?: number): Promise<number>; freeze(): void; info(): unknown; quality(q: "high" | "mid"): void };

export function LabHooks({ freeze, keoneRef }: { freeze(): void; keoneRef: RefObject<CharacterHandle | null> }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const w = window as unknown as { __casinoLab?: LabApi };
    w.__casinoLab = {
      freeze,
      quality: (q) => setQuality(q),
      info() {
        const s = get();
        const r = keoneRef.current?.root;
        const f = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z].map((n) => +n.toFixed(2));
        return { t: +s.clock.elapsedTime.toFixed(2), cam: f(s.camera.position), keone: r ? f(r.position) : null, fov: (s.camera as { fov?: number }).fov };
      },
      async step(seconds, fps = 30) {
        const s = get();
        let t = s.clock.elapsedTime;
        const n = Math.round(seconds * fps);
        for (let i = 0; i < n; i++) {
          t += 1 / fps;
          get().advance(t, true);
          // let promise chains (walk → sit → pull) settle between frames
          await new Promise((r) => setTimeout(r, 0));
        }
        return t;
      },
    };
    return () => {
      delete w.__casinoLab;
    };
  }, [get, freeze, keoneRef]);
  return null;
}
