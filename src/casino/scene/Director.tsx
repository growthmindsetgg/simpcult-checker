"use client";
/**
 * The camera director: the short "house lights up" intro (INTRO_SHOTS), the
 * resting PLAY / HERO frames, and the hero-mode attract loop.
 *
 * The intro is shot from the resting frame itself, with Keone already
 * seated: the hero's first paint is a poster of exactly that frame, so the
 * live canvas fades in over a picture it matches, then the sign flickers on
 * and the house lights step up in under two seconds. No walk-in, no face
 * shots: his face only turns to camera on a win.
 *
 * Lenses are chosen in millimetres on a 36 × 20.25 mm (16:9) gate and turned
 * into a vertical fov with fov = 2·atan(gateH / 2f).
 *
 * The resting frames are solved per aspect: from a fixed camera direction the
 * solver finds the closest distance at which a set of world points (the reel
 * window, the topper, Keone's head...) fits a screen rectangle that keeps
 * clear of the DOM (the slot HUD along the bottom, the home headline on the
 * left), then lens-shifts (camera.setViewOffset) the subject into that
 * rectangle.
 *
 * Every GSAP timeline here is created paused and advanced from useFrame, so
 * when the stage stops rendering (offscreen, hidden tab) the lights and the
 * attract timer freeze together.
 */
import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useRef, type RefObject } from "react";
import { PerspectiveCamera as Cam3, Vector3, type PerspectiveCamera } from "three";
import { ANCHORS, casino, INTRO_LENGTH, INTRO_SEEN_KEY, type CabinetHandle, type CharacterHandle, type Vec3 } from "../contract";
import { evaluate, gridFromStops, type Grid } from "@/games/slot/engine";
import { LINES, STRIP_LEN } from "@/games/slot/config";
import type { StageFx } from "./fx";
import type { StageMode } from "./Stage";
import { ROOM } from "./Room";
import { SIGN_POS } from "./Sign";

// ── lenses ──────────────────────────────────────────────────────────────────

const GATE_H = 20.25; // mm, a 36 mm wide 16:9 gate
/** vertical fov (degrees) for a focal length (mm) */
export const lens = (f: number) => (2 * Math.atan(GATE_H / (2 * f)) * 180) / Math.PI;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t: number) => t * t * (3 - 2 * t);

/** 0 on a landscape screen (aspect ≥ 1.5) → 1 on a phone held upright (aspect ≤ 0.6) */
function tallness(aspect: number) {
  return smooth(clamp01((Math.log(1.5) - Math.log(aspect)) / (Math.log(1.5) - Math.log(0.6))));
}

// ── camera pose: a target plus an orbit (azimuth, horizontal radius, height) ──

/** sx / sy: lens shift in NDC (the target lands at (sx, sy) instead of the centre) */
type Pose = { tx: number; ty: number; tz: number; az: number; r: number; y: number; fov: number; sx: number; sy: number };

// ── the resting frames ──────────────────────────────────────────────────────

type Rect = readonly [x0: number, x1: number, y0: number, y1: number];
type FrameSpec = {
  target: Vec3;
  az: number;
  el: number;
  mmWide: number;
  mmTall: number;
  /** world points that must land inside the rect, by tallness (0 landscape → 1 tall phone) */
  points: (k: number) => readonly Vec3[];
  /** the clear screen area, NDC, on a landscape screen and on a tall phone */
  rectWide: Rect;
  rectTall: Rect;
};

/** the seated head, roughly (centre); the solver keeps it in frame */
const HEAD: Vec3 = [0, 1.48, 0.92];
const WIN = { x: 0.34, y0: ANCHORS.reels[1] - 0.24, y1: ANCHORS.reels[1] + 0.24, z: 0.36 };

const FRAMES: Record<StageMode, FrameSpec> = {
  /**
   * Play: a long lens from behind his right shoulder, swung far enough right
   * that the sightline to reel 1 clears his head. The reels sit above the HUD
   * (the bottom ~36% of a desktop screen, ~44% of a phone); his head and
   * shoulder hold the left edge.
   */
  play: {
    target: [0.0, 1.4, 0.45],
    az: 0.84,
    el: 0.26,
    mmWide: 50,
    mmTall: 35,
    points: (k) => [
      [-WIN.x, WIN.y0, WIN.z],
      [WIN.x, WIN.y0, WIN.z],
      [-WIN.x, WIN.y1, WIN.z],
      [WIN.x, WIN.y1, WIN.z],
      [0, 1.98, 0.25], // the topper's neon
      [0.64, 1.46, 0.42], // the lever ball
      // his head holds the left edge: its right side on a wide screen, more of it on a phone
      [HEAD[0] + lerp(0.12, -0.06, k), HEAD[1] + 0.05, HEAD[2]],
    ],
    rectWide: [-0.94, 0.92, -0.36, 0.8],
    rectTall: [-0.9, 0.9, -0.1, 0.78],
  },
  /**
   * Home: no HUD, a headline at the bottom-left. Wide screens put the machine,
   * Keone and the sign in the right half; phones put them in the top half,
   * above the copy.
   */
  hero: {
    target: [0.1, 1.25, 0.3],
    az: 0.62,
    el: 0.1,
    mmWide: 40,
    mmTall: 30,
    points: () => [
      [-0.5, 0.02, 0.4],
      [0.5, 0.02, 0.4],
      [0.62, 1.5, 0.42],
      [-0.5, 2.12, 0.1],
      [0.5, 2.12, 0.1],
      [0.25, 0.02, 1.2], // stool base
      [HEAD[0], HEAD[1] + 0.3, HEAD[2]],
      [SIGN_POS[0] - 1.0, SIGN_POS[1] + 0.45, SIGN_POS[2]],
      [SIGN_POS[0] + 1.0, SIGN_POS[1] + 0.45, SIGN_POS[2]],
    ],
    rectWide: [0.06, 0.9, -0.86, 0.78],
    rectTall: [-0.9, 0.9, -0.12, 0.8],
  },
};

const solver = new Cam3();
const sv = new Vector3();

/** project the spec's points from distance d (along the spec's direction) and return their NDC box */
function measure(spec: FrameSpec, aspect: number, d: number, fov: number) {
  const [tx, ty, tz] = spec.target;
  const ce = Math.cos(spec.el);
  solver.position.set(tx + Math.sin(spec.az) * ce * d, ty + Math.sin(spec.el) * d, tz + Math.cos(spec.az) * ce * d);
  solver.lookAt(tx, ty, tz);
  solver.fov = fov;
  solver.aspect = aspect;
  solver.near = 0.05;
  solver.updateProjectionMatrix();
  solver.updateMatrixWorld(true);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of spec.points(tallness(aspect))) {
    sv.set(p[0], p[1], p[2]).project(solver);
    x0 = Math.min(x0, sv.x);
    x1 = Math.max(x1, sv.x);
    y0 = Math.min(y0, sv.y);
    y1 = Math.max(y1, sv.y);
  }
  return { x0, x1, y0, y1 };
}

/** furthest the camera can back off along the spec's direction and stay inside the room */
function roomLimit(spec: FrameSpec) {
  const [tx, ty, tz] = spec.target;
  const ce = Math.cos(spec.el);
  const dx = Math.sin(spec.az) * ce;
  const dy = Math.sin(spec.el);
  const dz = Math.cos(spec.az) * ce;
  const m = 0.45;
  let d = 12;
  if (dx > 0) d = Math.min(d, (ROOM.x1 - m - tx) / dx);
  if (dx < 0) d = Math.min(d, (ROOM.x0 + m - tx) / dx);
  if (dz > 0) d = Math.min(d, (ROOM.z1 - m - tz) / dz);
  if (dy > 0) d = Math.min(d, (ROOM.h - m - ty) / dy);
  return d;
}

function solveFrame(spec: FrameSpec, aspect: number): Pose {
  const k = tallness(aspect);
  const rect = spec.rectWide.map((v, i) => lerp(v, spec.rectTall[i], k));
  const rw = rect[1] - rect[0];
  const rh = rect[3] - rect[2];
  let fov = lens(lerp(spec.mmWide, spec.mmTall, k));
  const fits = (b: ReturnType<typeof measure>) => b.x1 - b.x0 <= rw && b.y1 - b.y0 <= rh;
  const dMax = roomLimit(spec);
  let d: number;
  if (!fits(measure(spec, aspect, dMax, fov))) {
    // backed against the wall: widen the lens instead
    d = dMax;
    let lo = fov;
    let hi = 80;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (fits(measure(spec, aspect, d, mid))) hi = mid;
      else lo = mid;
    }
    fov = hi;
  } else {
    let lo = 1.2;
    let hi = dMax;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (fits(measure(spec, aspect, mid, fov))) hi = mid;
      else lo = mid;
    }
    d = hi;
  }
  const b = measure(spec, aspect, d, fov);
  const [tx, ty, tz] = spec.target;
  return {
    tx,
    ty,
    tz,
    az: spec.az,
    r: d * Math.cos(spec.el),
    y: ty + Math.sin(spec.el) * d,
    fov,
    sx: (rect[0] + rect[1]) / 2 - (b.x0 + b.x1) / 2,
    sy: (rect[2] + rect[3]) / 2 - (b.y0 + b.y1) / 2,
  };
}

const restCache = new Map<string, Pose>();
function restPose(mode: StageMode, aspect: number) {
  const key = `${mode}:${aspect.toFixed(3)}`;
  let p = restCache.get(key);
  if (!p) {
    p = solveFrame(FRAMES[mode], aspect);
    if (restCache.size > 24) restCache.clear();
    restCache.set(key, p);
  }
  return p;
}

// ── helpers ─────────────────────────────────────────────────────────────────

export function randomGrid(): Grid {
  const r = () => Math.floor(Math.random() * STRIP_LEN);
  return gridFromStops([r(), r(), r()]);
}

function markSeen() {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {}
}

function introSeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** dev/lab hooks: ?intro=1 forces a replay (even under reduced motion), ?pauseAt=<seconds> freezes the intro there,
 *  ?motion=1 runs the hero attract loop even under reduced motion */
function labParams(): { force: boolean; pauseAt: number | null; motion: boolean } {
  if (process.env.NODE_ENV === "production") return { force: false, pauseAt: null, motion: false };
  try {
    const q = new URLSearchParams(window.location.search);
    const p = q.get("pauseAt");
    const n = p === null ? NaN : Number(p);
    return { force: q.get("intro") === "1", pauseAt: Number.isFinite(n) ? n : null, motion: q.get("motion") === "1" };
  } catch {
    return { force: false, pauseAt: null, motion: false };
  }
}

export type DirectorApi = { skip(): void };

type Props = {
  mode: StageMode;
  reducedMotion: boolean;
  fxRef: RefObject<StageFx>;
  keoneRef: RefObject<CharacterHandle | null>;
  cabinetRef: RefObject<CabinetHandle | null>;
  apiRef: RefObject<DirectorApi | null>;
  onIntroDone(): void;
  onFreeze(): void;
};

export function Director({ mode, reducedMotion, fxRef, keoneRef, cabinetRef, apiRef, onIntroDone, onFreeze }: Props) {
  const cam = useRef<Pose>(restPose(mode, 16 / 9));
  const running = useRef(new Map<gsap.core.Timeline, () => void>());
  const gen = useRef(0);
  const state = useRef({
    done: false,
    clock: 0,
    pauseAt: null as number | null,
    frozen: false,
    attractIn: 4,
    attractBusy: false,
    attractCount: 0,
    drift: 0,
    still: false,
    aspect: 16 / 9,
  });
  const view = useRef({ w: 0, h: 0, sx: 0, sy: 0, fov: 0 });
  const scratch = useRef({ pos: new Vector3(), tgt: new Vector3() });
  const cbs = useRef({ onIntroDone, onFreeze });
  useEffect(() => {
    cbs.current = { onIntroDone, onFreeze };
  }, [onIntroDone, onFreeze]);

  useEffect(() => {
    const g = gen;
    const fx = fxRef.current;
    const my = ++g.current;
    const alive = () => g.current === my;
    const run = running.current;
    const st = state.current;

    /** play a paused timeline on the frame clock */
    const play = (tl: gsap.core.Timeline) =>
      new Promise<void>((resolve) => {
        tl.pause(0);
        run.set(tl, resolve);
      });

    const finalFrame = () => {
      for (const [tl, resolve] of run) {
        tl.kill();
        resolve();
      }
      run.clear();
      Object.assign(fx, { sign: 1, sub: 1, key: 1, room: 1 });
      keoneRef.current?.snap("seated");
      markSeen();
      if (process.env.NODE_ENV !== "production" && st.clock > 0) console.info(`[casino] intro ran ${st.clock.toFixed(2)} s`);
      st.done = true;
      st.attractIn = 3 + Math.random() * 2;
      casino.setIntroDone(true);
      cbs.current.onIntroDone();
    };

    apiRef.current = {
      skip() {
        if (st.done) return;
        g.current++; // aborts the timeline below
        finalFrame();
      },
    };

    const lab = labParams();
    st.pauseAt = lab.pauseAt;
    st.still = reducedMotion && !lab.motion;
    st.clock = 0;
    st.done = false;

    // the resting frame, Keone seated and a full grid on the glass, from the very first frame
    keoneRef.current?.snap("seated");
    cabinetRef.current?.show(randomGrid());

    if (!lab.force && (reducedMotion || introSeen())) {
      finalFrame();
      return () => {
        g.current++;
      };
    }

    casino.setIntroDone(false);
    /*
     * The beats (INTRO_LENGTH, 1.8 s), all on the resting frame:
     *  0.0   the house at half light (never black: the poster under the canvas is the lit frame)
     *  0.1   the "simp" tube stutters on; "MACHINE" follows at 0.7
     *  0.95, 1.25, 1.55   the house lights come up in three steps, the key spot with them
     */
    Object.assign(fx, { sign: 0, sub: 0, key: 0.5, room: 0.55 });
    const tl = gsap.timeline({ paused: true });
    const flick = (key: "sign" | "sub", seq: [number, number][]) => seq.forEach(([t, v]) => tl.set(fx, { [key]: v }, t));
    flick("sign", [[0.1, 0.6], [0.16, 0], [0.28, 0.9], [0.33, 0.1], [0.44, 1], [0.53, 0.35], [0.58, 1]]);
    flick("sub", [[0.7, 0.7], [0.74, 0], [0.84, 1]]);
    tl.to(fx, { room: 0.72, key: 0.68, duration: 0.12, ease: "power2.out" }, 0.95);
    tl.to(fx, { room: 0.87, key: 0.85, duration: 0.12, ease: "power2.out" }, 1.25);
    tl.to(fx, { room: 1, key: 1, duration: 0.2, ease: "power2.out" }, 1.55);
    tl.to({}, { duration: INTRO_LENGTH }, 0);
    void play(tl).then(() => {
      if (alive()) finalFrame();
    });

    return () => {
      g.current++;
      for (const [t] of run) t.kill();
      run.clear();
      if (apiRef.current) apiRef.current = null;
    };
  }, [mode, reducedMotion, fxRef, keoneRef, cabinetRef, apiRef]);

  // ── hero attract loop: Keone spins every ~6–8 s with a display-only grid ──
  const attract = async () => {
    const st = state.current;
    if (!cabinetRef.current || st.attractBusy) return;
    st.attractBusy = true;
    st.attractCount++;
    try {
      const pull = Promise.all([keoneRef.current?.pullLever(), cabinetRef.current?.pullLever()]);
      setTimeout(() => cabinetRef.current?.startSpin(), 300);
      await Promise.race([pull, new Promise((r) => setTimeout(r, 1500))]);
      const grid = randomGrid();
      await Promise.race([
        cabinetRef.current?.stop(grid, { staggerMs: 240, anticipationReel: null }),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      const mult = evaluate(grid, LINES).totalWin / LINES;
      const k = keoneRef.current;
      // his face turns to camera only on a real win (the nice/big grin); small wins get the nod, losses nothing
      if (mult >= 5) k?.react(mult >= 25 ? "big" : "nice");
      else if (mult > 0) k?.react("small");
    } finally {
      st.attractBusy = false;
      st.attractIn = 6 + Math.random() * 2;
    }
  };

  useFrame((three, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const st = state.current;
    const c = cam.current;
    const s = scratch.current;
    const W = three.size.width;
    const H = Math.max(1, three.size.height);
    st.aspect = W / H;

    for (const [tl, resolve] of running.current) {
      tl.time(Math.min(tl.duration(), tl.time() + dt));
      if (tl.progress() >= 1) {
        running.current.delete(tl);
        resolve();
      }
    }
    if (!st.done) {
      st.clock += dt;
      if (process.env.NODE_ENV !== "production") (window as { __casinoClock?: number }).__casinoClock = st.clock;
      if (!st.frozen && st.pauseAt !== null && st.clock >= st.pauseAt) {
        st.frozen = true; // fires once; the lab can still step frames by hand
        cbs.current.onFreeze();
      }
    }
    // always the solved resting frame (it re-solves on resize)
    Object.assign(c, restPose(mode, st.aspect));

    if (st.done && mode === "hero" && !st.still) {
      st.drift += dt;
      st.attractIn -= dt;
      if (st.attractIn <= 0 && !st.attractBusy) void attract();
    }

    // static orbit pose (+ a slow breathing drift on the home page)
    const camera = three.camera as PerspectiveCamera;
    let az = c.az;
    let y = c.y;
    if (st.done && mode === "hero" && !st.still) {
      az += Math.sin(st.drift * 0.17) * 0.05;
      y += Math.sin(st.drift * 0.23 + 1.1) * 0.04;
    }
    s.pos.set(c.tx + Math.sin(az) * c.r, y, c.tz + Math.cos(az) * c.r);
    s.tgt.set(c.tx, c.ty, c.tz);
    camera.position.copy(s.pos);
    camera.lookAt(s.tgt);

    // lens shift: only touch the projection when something changed
    const v = view.current;
    const { sx, sy, fov } = c;
    if (v.w !== W || v.h !== H || Math.abs(v.sx - sx) > 1e-4 || Math.abs(v.sy - sy) > 1e-4 || Math.abs(v.fov - fov) > 1e-3) {
      Object.assign(v, { w: W, h: H, sx, sy, fov });
      camera.fov = fov;
      if (Math.abs(sx) < 1e-4 && Math.abs(sy) < 1e-4) {
        camera.clearViewOffset();
      } else {
        camera.setViewOffset(W, H, (-sx * W) / 2, (sy * H) / 2, W, H);
      }
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
