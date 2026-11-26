"use client";
/**
 * The camera director: the cinematic intro (INTRO_SHOTS), the final PLAY
 * frame, and the hero-mode attract loop.
 *
 * Every GSAP timeline here is created paused and advanced from useFrame, so
 * when the stage stops rendering (offscreen, hidden tab) the camera, the
 * character and the attract timer all freeze together. Character/cabinet
 * steps are gated on their promises, each raced against a frame-clock
 * timeout so an unfinished handle can never hang the intro.
 */
import { useFrame } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useRef, type RefObject } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import {
  ANCHORS,
  casino,
  INTRO_SEEN_KEY,
  PLAY_CAMERA,
  type CabinetHandle,
  type CharacterHandle,
  type Vec3,
} from "../contract";
import { evaluate, gridFromStops, type Grid } from "@/games/slot/engine";
import { LINES, STRIP_LEN } from "@/games/slot/config";
import type { StageFx } from "./fx";
import type { StageMode } from "./Stage";
import { ROOM } from "./Room";

/** below this aspect the director widens the framing (portrait phones, narrow panes) */
const NARROW = 1.25;

/**
 * The resting play frame. Contract PLAY_CAMERA ([0.95, 1.78, 2.75] → [0, 1.25, 0.2]) puts the
 * big-head caricature's skull over the left reel, so the director rests further to the player's
 * right, where the sightline to the reels clears his head. (Proposed as the new PLAY_CAMERA.)
 */
export const PLAY_FRAME = { position: [1.55, 1.9, 2.45] as Vec3, target: [0.02, 1.3, 0.3] as Vec3, fov: PLAY_CAMERA.fov };

// ── camera pose: a target plus an orbit (azimuth, horizontal radius, height) ──

type Pose = { tx: number; ty: number; tz: number; az: number; r: number; y: number; fov: number };
type Cam = Pose & { follow: number };

function poseFrom(pos: Vec3, target: Vec3, fov: number): Pose {
  const dx = pos[0] - target[0];
  const dz = pos[2] - target[2];
  return { tx: target[0], ty: target[1], tz: target[2], az: Math.atan2(dx, dz), r: Math.hypot(dx, dz), y: pos[1], fov };
}

const POSE = {
  open: poseFrom([1.85, 1.05, 12.45], [0.15, 2.45, -1.0], 30),
  openEnd: poseFrom([1.8, 0.98, 11.55], [0.15, 2.3, -1.0], 29),
  threeQuarter: poseFrom([-1.85, 1.42, 3.1], [0.1, 1.05, 0.5], 34),
  shoulder: poseFrom([1.45, 1.8, 2.3], [-0.05, 1.3, 0.3], 36),
  lever: poseFrom([1.6, 1.6, 2.25], [0.2, 1.2, 0.25], 37),
  play: poseFrom(PLAY_FRAME.position, PLAY_FRAME.target, PLAY_FRAME.fov),
  /** home page: no HUD, so pull back far enough to keep the sign in the shot */
  hero: poseFrom([2.35, 1.75, 4.9], [0.05, 1.7, 0], 36),
};

/** tracking-shot offsets from Keone's feet (world space; he walks roughly −Z) */
const FOLLOW_EYE = new Vector3(-0.95, 0.55, 2.1);
/** the tracking camera aims a little past Keone, toward the lit machine */
const FOLLOW_AIM = 0.15;
const FOLLOW_AIM_Y = 1.1;

export function randomGrid(): Grid {
  const r = () => Math.floor(Math.random() * STRIP_LEN);
  return gridFromStops([r(), r(), r()]);
}

function pathLength(p: readonly Vec3[]) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]);
  return l;
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
  const cam = useRef<Cam>({ ...POSE.open, follow: 0 });
  const running = useRef(new Map<gsap.core.Timeline, () => void>());
  const gen = useRef(0);
  const state = useRef({
    done: false,
    clock: 0,
    pauseAt: null as number | null,
    frozen: false,
    attractIn: 4,
    attractBusy: false,
    drift: 0,
    still: false,
  });
  const scratch = useRef({
    eye: new Vector3(),
    look: new Vector3(),
    pos: new Vector3(),
    tgt: new Vector3(),
    rawPos: new Vector3(),
    rawTgt: new Vector3(),
    tmp: new Vector3(),
    primed: false,
  });
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
    const c = cam.current;

    /** play a paused timeline on the frame clock */
    const play = (tl: gsap.core.Timeline) =>
      new Promise<void>((resolve) => {
        tl.pause(0);
        run.set(tl, resolve);
      });
    const sleep = (s: number) => play(gsap.timeline({ paused: true }).to({}, { duration: s }));
    const within = <T,>(p: Promise<T> | undefined, s: number) => Promise.race([p ?? Promise.resolve(), sleep(s)]);

    const setPose = (p: Pose) => Object.assign(c, p);
    const tweenPose = (tl: gsap.core.Timeline, p: Pose, dur: number, at: number | string, ease = "power2.inOut") =>
      tl.to(c, { ...p, duration: dur, ease }, at);

    /** re-express the current camera as an orbit pose so the next move is a true arc */
    const syncToCamera = () => {
      const s = scratch.current;
      const { rawPos: a, rawTgt: b } = s;
      Object.assign(c, poseFrom([a.x, a.y, a.z], [b.x, b.y, b.z], c.fov), { follow: 0 });
    };

    const rest = mode === "hero" ? POSE.hero : POSE.play;
    const finalFrame = () => {
      for (const [tl, resolve] of run) {
        tl.kill();
        resolve();
      }
      run.clear();
      Object.assign(fx, { sign: 1, sub: 1, key: 1, room: 1 });
      setPose(rest);
      c.follow = 0;
      keoneRef.current?.snap("seated");
      cabinetRef.current?.show(randomGrid());
      markSeen();
      st.done = true;
      st.attractIn = 3 + Math.random() * 2;
      casino.setIntroDone(true);
      cbs.current.onIntroDone();
    };

    apiRef.current = {
      skip() {
        if (st.done) return;
        g.current++; // aborts the async chain below
        finalFrame();
      },
    };

    const lab = labParams();
    st.pauseAt = lab.pauseAt;
    st.still = reducedMotion && !lab.motion;
    st.clock = 0;
    st.done = false;

    // a full grid on the glass before anything moves
    cabinetRef.current?.show(randomGrid());

    if (!lab.force && (reducedMotion || introSeen())) {
      finalFrame();
      return () => {
        g.current++;
      };
    }

    casino.setIntroDone(false);
    Object.assign(fx, { sign: 0, sub: 0, key: 0, room: 0 });
    setPose(POSE.open);
    c.follow = 0;
    keoneRef.current?.snap("offstage");

    (async () => {
      const aisle = ANCHORS.aisle;
      const walkStart = 0.55;
      const speed = pathLength(aisle) / (7.0 - walkStart); // arrive as the arc settles
      let walk: Promise<void> | undefined;

      // ── 1. sign: black → neon flickers on; slow push down the aisle ──
      const sign = gsap.timeline({ paused: true });
      tweenPose(sign, POSE.openEnd, 1.6, 0, "power1.inOut");
      const flick = (key: "sign" | "sub", seq: [number, number][]) => seq.forEach(([t, v]) => sign.set(fx, { [key]: v }, t));
      flick("sign", [[0.18, 0.55], [0.24, 0], [0.38, 0.85], [0.43, 0.08], [0.55, 1], [0.66, 0.3], [0.71, 1]]);
      flick("sub", [[0.86, 0.7], [0.9, 0], [1.02, 1]]);
      sign.to(fx, { key: 1, duration: 0.18, ease: "power3.out" }, 1.12);
      sign.to(fx, { room: 1, duration: 0.7, ease: "power1.out" }, 1.15);
      sign.call(() => {
        walk = keoneRef.current?.walk(aisle, { speed });
      }, undefined, walkStart);
      await play(sign);
      if (!alive()) return;

      // ── 2. track: low, beside him as he walks ──
      const track = gsap.timeline({ paused: true });
      track.to(c, { follow: 1, fov: 36, duration: 0.9, ease: "power2.inOut" }, 0);
      track.to({}, { duration: 3.4 }, 0);
      await play(track);
      if (!alive()) return;

      // ── 3. arc: orbit to a three-quarter view of the lit machine ──
      syncToCamera();
      const arc = gsap.timeline({ paused: true });
      tweenPose(arc, POSE.threeQuarter, 1.8, 0, "power2.inOut");
      await play(arc);
      if (!alive()) return;
      await within(walk, 2.5);
      if (!alive()) return;

      // ── 4. sit: push in over his right shoulder ──
      const sitP = keoneRef.current?.sit();
      const sit = gsap.timeline({ paused: true });
      tweenPose(sit, POSE.shoulder, 1.4, 0, "power2.inOut");
      await Promise.all([play(sit), within(sitP, 2.5)]);
      if (!alive()) return;

      // ── 5. pull: attract spin, then settle on the PLAY frame ──
      const k = keoneRef.current;
      const cab = cabinetRef.current;
      const pullP = Promise.all([k?.pullLever(), cab?.pullLever()]);
      const pull = gsap.timeline({ paused: true });
      tweenPose(pull, POSE.lever, 1.0, 0, "power2.out");
      pull.call(() => cabinetRef.current?.startSpin(), undefined, 0.35);
      tweenPose(pull, rest, mode === "hero" ? 1.4 : 0.8, 1.0, "power2.inOut");
      const camP = play(pull);
      await within(pullP, 1.6);
      if (!alive()) return;
      const grid = randomGrid();
      await within(cabinetRef.current?.stop(grid, { staggerMs: 200, anticipationReel: null }), 3.5);
      if (!alive()) return;
      await camP;
      if (!alive()) return;
      finalFrame();
    })().catch((err) => {
      if (process.env.NODE_ENV !== "production") console.warn("[casino] intro aborted:", err);
      if (alive()) finalFrame();
    });

    return () => {
      g.current++;
      for (const [tl] of run) tl.kill();
      run.clear();
      if (apiRef.current) apiRef.current = null;
    };
  }, [mode, reducedMotion, fxRef, keoneRef, cabinetRef, apiRef]);

  // ── hero attract loop: Keone spins every ~6–8 s with a display-only grid ──
  const attract = async () => {
    const st = state.current;
    if (!cabinetRef.current || st.attractBusy) return;
    st.attractBusy = true;
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
      if (mult > 0) keoneRef.current?.react(mult >= 25 ? "big" : mult >= 5 ? "nice" : "small");
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

    for (const [tl, resolve] of running.current) {
      tl.time(Math.min(tl.duration(), tl.time() + dt));
      if (tl.progress() >= 1) {
        running.current.delete(tl);
        resolve();
      }
    }
    if (!st.done) {
      st.clock += dt;
      if (!st.frozen && st.pauseAt !== null && st.clock >= st.pauseAt) {
        st.frozen = true; // fires once; the lab can still step frames by hand
        cbs.current.onFreeze();
      }
    }

    if (st.done && mode === "hero" && !st.still) {
      st.drift += dt;
      st.attractIn -= dt;
      if (st.attractIn <= 0 && !st.attractBusy) void attract();
    }

    // static orbit pose
    const camera = three.camera as PerspectiveCamera;
    const aspect = three.size.width / Math.max(1, three.size.height);
    let az = c.az;
    let y = c.y;
    // narrow screens see the reels past his head at a steeper angle: swing a little further right
    if (st.done && aspect < NARROW) az += Math.min(0.24, 0.16 * (NARROW / aspect - 1));
    if (st.done && mode === "hero" && !st.still) {
      az += Math.sin(st.drift * 0.17) * 0.06;
      y += Math.sin(st.drift * 0.23 + 1.1) * 0.05;
    }
    s.pos.set(c.tx + Math.sin(az) * c.r, y, c.tz + Math.cos(az) * c.r);
    s.tgt.set(c.tx, c.ty, c.tz);

    // tracking blend
    const root = keoneRef.current?.root;
    if (root) {
      s.tmp.copy(root.position).add(FOLLOW_EYE);
      s.eye.lerp(s.tmp, s.primed && c.follow > 0 ? 1 - Math.exp(-dt * 5) : 1);
      s.tmp.copy(root.position).multiplyScalar(1 - FOLLOW_AIM);
      s.tmp.y = FOLLOW_AIM_Y; // the machine sits at the origin
      s.look.lerp(s.tmp, s.primed && c.follow > 0 ? 1 - Math.exp(-dt * 5) : 1);
      s.primed = true;
      if (c.follow > 0.0001) {
        s.pos.lerp(s.eye, c.follow);
        s.tgt.lerp(s.look, c.follow);
      }
    }
    s.rawPos.copy(s.pos);
    s.rawTgt.copy(s.tgt);

    // portrait / narrow framing: dolly back so the machine and Keone stay in frame,
    // and bias the subject upward to leave room for the HUD along the bottom
    let fov = c.fov;
    if (aspect < NARROW) {
      const k = Math.min(2.6, Math.pow(NARROW / aspect, 0.9));
      // dolly back as far as the room allows (≤ 3.5 m extra), make up the rest with fov
      const dist = s.pos.distanceTo(s.tgt);
      let kd = Math.min(k, 1 + 3.5 / Math.max(0.5, dist));
      s.tmp.copy(s.pos).sub(s.tgt);
      for (let i = 0; i < 6; i++) {
        const x = s.tgt.x + s.tmp.x * kd;
        const y = s.tgt.y + s.tmp.y * kd;
        const z = s.tgt.z + s.tmp.z * kd;
        if (x > ROOM.x0 + 0.4 && x < ROOM.x1 - 0.4 && z > ROOM.z0 + 0.4 && z < ROOM.z1 - 0.4 && y < ROOM.h - 0.4) break;
        kd = 1 + (kd - 1) * 0.6;
      }
      s.pos.copy(s.tmp.multiplyScalar(kd).add(s.tgt));
      s.pos.y = Math.min(ROOM.h - 0.4, Math.max(0.45, s.pos.y));
      const kf = k / kd;
      fov = (2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) * kf) * 180) / Math.PI;
      // bias the subject upward: the HUD sits along the bottom of narrow screens
      s.tgt.y -= (k - 1) * 0.28;
    }
    camera.position.copy(s.pos);
    camera.lookAt(s.tgt);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
