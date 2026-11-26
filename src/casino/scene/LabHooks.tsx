"use client";
/**
 * Dev-only: lets the lab step the frozen stage by hand (the browser pane used
 * for screenshots doesn't run requestAnimationFrame while it is hidden).
 *   window.__casinoLab.step(seconds, fps = 30)  → advances every useFrame + renders
 *   window.__casinoLab.cells()                  → which reel cells Keone hides, in screen pixels
 *   window.__casinoLab.react(kind) / skip()     → drive the character / director by hand
 */
import { useThree } from "@react-three/fiber";
import { useEffect, type RefObject } from "react";
import { Box3, Raycaster, Vector3, type Object3D } from "three";
import { ANCHORS, type CharacterHandle } from "../contract";
import { setQuality } from "../quality";

type Kind = "loss" | "small" | "nice" | "big" | "mega";
type LabApi = {
  step(seconds: number, fps?: number): Promise<number>;
  freeze(): void;
  info(): unknown;
  quality(q: "high" | "mid"): void;
  cells(): unknown;
  react(kind: Kind): void;
  skip(): void;
  exposure(v: number): void;
};

/** reel cell sample points (centre + four inset corners), world space; mirrors Cabinet3D's reel layout */
const REEL_X = [-0.195, 0, 0.195];
const ROW_Y = [0.13, 0, -0.13];

export function LabHooks({
  freeze,
  skip,
  keoneRef,
}: {
  freeze(): void;
  skip(): void;
  keoneRef: RefObject<CharacterHandle | null>;
}) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const w = window as unknown as { __casinoLab?: LabApi };
    const ray = new Raycaster();
    const v = new Vector3();
    const dir = new Vector3();
    w.__casinoLab = {
      freeze,
      skip,
      quality: (q) => setQuality(q),
      react: (kind) => keoneRef.current?.react(kind),
      exposure: (v) => {
        get().gl.toneMappingExposure = v;
      },
      info() {
        const s = get();
        const r = keoneRef.current?.root;
        const f = (p: { x: number; y: number; z: number }) => [p.x, p.y, p.z].map((n) => +n.toFixed(2));
        return { t: +s.clock.elapsedTime.toFixed(2), cam: f(s.camera.position), keone: r ? f(r.position) : null, fov: (s.camera as { fov?: number }).fov };
      },
      cells() {
        const s = get();
        const cam = s.camera;
        const root = keoneRef.current?.root ?? null;
        const toPx = (p: Vector3) => {
          v.copy(p).project(cam);
          return [Math.round(((v.x + 1) / 2) * s.size.width), Math.round(((1 - v.y) / 2) * s.size.height)];
        };
        const hidden = (p: Vector3) => {
          if (!root) return false;
          dir.copy(p).sub(cam.position);
          const d = dir.length();
          ray.set(cam.position, dir.normalize());
          ray.far = d;
          return ray.intersectObject(root, true).length > 0;
        };
        const reels = REEL_X.map((x) => {
          let blocked = 0;
          let total = 0;
          let top = Infinity;
          let bottom = -Infinity;
          let left = Infinity;
          let right = -Infinity;
          for (const ry of ROW_Y) {
            for (const [dx, dy] of [[0, 0], [-0.06, -0.045], [0.06, -0.045], [-0.06, 0.045], [0.06, 0.045]]) {
              const p = new Vector3(x + dx, ANCHORS.reels[1] + ry + dy, 0.33);
              total++;
              if (hidden(p)) blocked++;
              const [px, py] = toPx(p);
              top = Math.min(top, py);
              bottom = Math.max(bottom, py);
              left = Math.min(left, px);
              right = Math.max(right, px);
            }
          }
          return { blocked, total, box: [left, top, right, bottom] };
        });
        // Keone's head on screen (bounding box of its world box corners)
        let head: number[] | null = null;
        const hm = root?.getObjectByName("headMesh") as Object3D | undefined;
        if (hm) {
          const b = new Box3().setFromObject(hm);
          let l = Infinity;
          let t = Infinity;
          let r = -Infinity;
          let btm = -Infinity;
          for (let i = 0; i < 8; i++) {
            const c = new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
            const [px, py] = toPx(c);
            l = Math.min(l, px);
            r = Math.max(r, px);
            t = Math.min(t, py);
            btm = Math.max(btm, py);
          }
          head = [l, t, r, btm];
        }
        return { size: [s.size.width, s.size.height], reels, head };
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
  }, [get, freeze, skip, keoneRef]);
  return null;
}
