/**
 * Keone's brain: a procedural pose composer evaluated every frame, plus the
 * actions behind CharacterHandle. GSAP timelines only tween plain numbers in
 * `p`; `update()` turns those numbers (and the walk state) into joint
 * rotations, then runs two-bone IK for both legs (feet planted / seated) and
 * for the right arm while it works the lever.
 *
 * Coordinates: root-local +Z is "forward", +X is the character's left.
 * `pos` / `yaw` live in the root's parent space, which should be the scene
 * root (ANCHORS are scene coordinates). No allocations in update().
 */
import gsap from "gsap";
import { CatmullRomCurve3, Euler, Quaternion, Vector3 } from "three";
import { ANCHORS, type CharacterState, type Vec3 } from "../contract";
import { FACE, type ArmRig, type KeoneRig, type LegRig } from "./build";
import { D, LEVER_DOWN, LEVER_PULLED, LEVER_RADIUS, LEVER_REST, PULL_TIMING, SEAT_HIPS_Y, STAND_HIPS_Y } from "./dims";
import { solveTwoBone } from "./ik";

export type ReactKind = "loss" | "small" | "nice" | "big" | "mega";
type Mouth = "smile" | "o" | "grin" | "flat";

const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const damp = (a: number, b: number, k: number, dt: number) => lerp(a, b, 1 - Math.exp(-k * dt));
const wrapAngle = (a: number) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
const yawToward = (from: Vec3 | Vector3, to: Vec3 | Vector3) => {
  const fx = "x" in from ? from.x : from[0];
  const fz = "z" in from ? from.z : from[2];
  const tx = "x" in to ? to.x : to[0];
  const tz = "z" in to ? to.z : to[2];
  return Math.atan2(tx - fx, tz - fz);
};

/** step length for a walking speed (m/s): longer strides when faster, short shuffles when slow */
const strideFor = (v: number) => Math.min(0.48, 0.14 + 0.23 * v);
const ACCEL = 3.2;
const DECEL = 2.6;
/** where Keone stands just before hopping onto the stool (his right of the seat, aisle side) */
const PRESEAT: Vec3 = [ANCHORS.stool[0] + 0.32, 0, ANCHORS.stool[2] - 0.03];
const FACE_MACHINE = Math.PI; // facing -Z

type Walk = {
  curve: CatmullRomCurve3;
  len: number;
  s: number;
  v: number;
  speed: number;
  faceYaw: number | null;
  done: () => void;
};

function makeParams() {
  return {
    seat: 0, // 0 standing → 1 seated
    hop: 0, // extra hips lift (m)
    scoot: 0, // hips forward on the seat (m)
    reach: 0, // lever lean pose
    ik: 0, // right arm IK weight
    pull: 0, // lever travel 0..1
    yank: 0, // body drop while pulling
    grip: 0, // right hand closed
    fist: 0, // both hands closed (cheers)
    slump: 0,
    shake: 0, // head shake amplitude
    nod: 0, // nod progress
    nodAmp: 0,
    pump: 0, // right fist pump pose
    pumpBeat: 0,
    armsUp: 0,
    jump: 0, // mega: hips lift with legs tucked
    browUp: 0,
    browSad: 0,
    happyEyes: 0,
    mouthPop: 1,
  };
}
export type KeoneParams = ReturnType<typeof makeParams>;

export class KeoneController {
  rig: KeoneRig | null = null;
  state: CharacterState = "offstage";
  /** dev knob: scales update() time (the lab also scales GSAP's global timeline) */
  timeScale = 1;
  readonly p = makeParams();
  readonly pos = new Vector3(...ANCHORS.door);
  yaw = yawToward(ANCHORS.aisle[0], ANCHORS.aisle[1]);
  private targetYaw = this.yaw;
  private yawRate = 8;
  private mouth: Mouth = "smile";

  // locomotion
  private walking: Walk | null = null;
  private walkW = 0;
  private phase = 0;
  private stride = 0.4;
  private speed = 0;
  private strideX = 0; // travel direction in root-local xz
  private strideZ = 1;

  // idle
  private t = 0;
  private nextBlink = 1.5;
  private blink = 0; // 0..1 progress of a blink, <0 idle
  private nextLook = 2;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookYawT = 0;
  private lookPitchT = 0;

  // timelines and their pending promises
  private tl: { move?: gsap.core.Timeline; pull?: gsap.core.Timeline; react?: gsap.core.Timeline } = {};
  private pending: { walk?: () => void; move?: () => void; pull?: () => void } = {};
  /** bumped by every walk/sit/snap so an interrupted async sequence stops instead of continuing */
  private gen = 0;

  /** last IK numbers, for the lab's numeric checks */
  readonly debug = { leverStretch: 1, leverReach: 0, leverResidual: 0, footDrift: 0, shoulder: [0, 0, 0], headFrontZ: 0 };

  // scratch (no per-frame allocation)
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly vPole = new Vector3();
  private readonly lever = new Vector3();
  private readonly qA = new Quaternion();
  private readonly qB = new Quaternion();
  private readonly qC = new Quaternion();
  private readonly qD = new Quaternion();
  private readonly eu = new Euler();
  private readonly prevFootL = new Vector3();
  private readonly ptmp = new Vector3();

  attach(rig: KeoneRig | null) {
    this.rig = rig;
  }

  /** kill every timeline and settle every promise (unmount / snap). The controller stays usable. */
  dispose() {
    this.gen++;
    this.cancelMove();
    this.cancelPull();
    this.tl.react?.kill();
    this.tl.react = undefined;
    this.resetOverlays();
  }

  // ── public actions ────────────────────────────────────────────────────────

  walk(path: readonly Vec3[], opts?: { speed?: number }): Promise<void> {
    const g = ++this.gen;
    const go = () => (g === this.gen ? this.startWalk(path, opts?.speed ?? 1.2, null) : undefined);
    if (this.state === "seated" || this.p.seat > 0.01) return this.standUp().then(go);
    return go() ?? Promise.resolve();
  }

  async sit(): Promise<void> {
    if (this.state === "seated" && this.p.seat > 0.99) return;
    const g = ++this.gen;
    this.cancelPull();
    const d = Math.hypot(this.pos.x - PRESEAT[0], this.pos.z - PRESEAT[2]);
    if (d > 1.6) {
      // far away: walk most of the way at normal pace first
      const near = new Vector3(...PRESEAT).sub(this.pos).setLength(d - 0.7).add(this.pos);
      await this.startWalk([[near.x, 0, near.z]], 1.2, null);
      if (g !== this.gen) return;
    }
    if (Math.hypot(this.pos.x - PRESEAT[0], this.pos.z - PRESEAT[2]) > 0.04) {
      // a quick shuffle to the seat while turning to face the machine
      await this.startWalk([PRESEAT], 1.5, FACE_MACHINE);
      if (g !== this.gen) return;
    }
    await this.hop(true);
  }

  pullLever(): Promise<void> {
    this.cancelPull();
    if (this.state !== "seated") return Promise.resolve();
    const p = this.p;
    const T = PULL_TIMING;
    return new Promise<void>((resolve) => {
      this.pending.pull = resolve;
      const tl = gsap.timeline({
        onComplete: () => {
          this.tl.pull = undefined;
          this.settle("pull");
        },
      });
      this.tl.pull = tl;
      // The cabinet swings its own arm from t=0 (smoothstep over LEVER_DOWN), so the hand
      // flies in, catches the ball on its way down, rides it to the bottom, then lets go.
      const smooth = (x: number) => x * x * (3 - 2 * x);
      tl.call(() => this.setMouth("o"), [], 0.04);
      tl.to(p, { reach: 1, scoot: 0.1, duration: 0.2, ease: "power2.out" }, 0);
      tl.to(p, { ik: 1, duration: T.grip, ease: "power2.out" }, 0);
      tl.to(p, { browSad: -0.6, duration: 0.15 }, 0);
      tl.to(p, { grip: 1, duration: 0.05, ease: "power1.out" }, T.grip - 0.03);
      tl.to(p, { pull: 1, duration: LEVER_DOWN, ease: smooth }, T.downStart);
      tl.to(p, { yank: 1, duration: LEVER_DOWN, ease: "power2.in" }, T.downStart);
      tl.to(p, { grip: 0, duration: 0.05 }, T.release);
      tl.to(p, { ik: 0, duration: T.end - T.release, ease: "power2.out" }, T.release);
      tl.to(p, { reach: 0, scoot: 0, yank: 0, browSad: 0, duration: T.end - T.release, ease: "power2.inOut" }, T.release);
      tl.call(() => this.setMouth("smile"), [], T.release + 0.05);
      tl.set(p, { pull: 0 }, T.end);
    });
  }

  react(kind: ReactKind) {
    this.tl.react?.kill();
    this.resetReactOverlays();
    const p = this.p;
    const tl = gsap.timeline({
      onComplete: () => {
        this.tl.react = undefined;
        this.setMouth("smile");
      },
    });
    this.tl.react = tl;
    switch (kind) {
      case "loss":
        tl.call(() => this.setMouth("flat"), [], 0);
        tl.to(p, { slump: 1, browSad: 1, duration: 0.35, ease: "power2.out" }, 0);
        tl.to(p, { shake: 1, duration: 0.2 }, 0.15);
        tl.to(p, { shake: 0, duration: 0.45 }, 0.65);
        tl.to(p, { slump: 0, browSad: 0, duration: 0.55, ease: "power2.inOut" }, 0.95);
        break;
      case "small":
        tl.call(() => this.setMouth("smile"), [], 0);
        tl.fromTo(p, { mouthPop: 0.7 }, { mouthPop: 1, duration: 0.35, ease: "back.out(3)" }, 0);
        tl.set(p, { nodAmp: 1 }, 0);
        tl.fromTo(p, { nod: 0 }, { nod: 1, duration: 0.75, ease: "none" }, 0);
        tl.to(p, { browUp: 0.5, duration: 0.15 }, 0);
        tl.to(p, { browUp: 0, nodAmp: 0, duration: 0.25 }, 0.6);
        tl.set(p, { nod: 0 }, 0.86);
        break;
      case "nice":
        tl.call(() => this.setMouth("grin"), [], 0.05);
        tl.to(p, { pump: 1, fist: 1, happyEyes: 1, browUp: 0.6, duration: 0.2, ease: "back.out(2)" }, 0);
        tl.to(p, { pumpBeat: 1, duration: 0.16, ease: "power2.in", yoyo: true, repeat: 3 }, 0.18);
        tl.to(p, { pump: 0, fist: 0, happyEyes: 0, browUp: 0, duration: 0.35, ease: "power2.inOut" }, 0.9);
        break;
      case "big":
        tl.call(() => this.setMouth("grin"), [], 0);
        tl.to(p, { armsUp: 1, fist: 1, happyEyes: 1, browUp: 1, duration: 0.28, ease: "back.out(2)" }, 0);
        tl.to(p, { hop: 0.05, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 3 }, 0.12);
        tl.fromTo(p, { mouthPop: 0.8 }, { mouthPop: 1.15, duration: 0.3, ease: "back.out(3)" }, 0);
        tl.to(p, { armsUp: 0, fist: 0, happyEyes: 0, browUp: 0, mouthPop: 1, duration: 0.45, ease: "power2.inOut" }, 1.15);
        break;
      case "mega":
        tl.call(() => this.setMouth("grin"), [], 0);
        tl.to(p, { armsUp: 1, fist: 1, happyEyes: 1, browUp: 1, mouthPop: 1.3, duration: 0.25, ease: "back.out(2)" }, 0);
        tl.to(p, { jump: 1, duration: 0.24, ease: "power2.out", yoyo: true, repeat: 3, repeatDelay: 0.04 }, 0.1);
        tl.to(p, { shake: 0.35, duration: 0.2 }, 0.2);
        tl.to(p, { shake: 0, duration: 0.3 }, 1.0);
        tl.to(p, { armsUp: 0, fist: 0, happyEyes: 0, browUp: 0, mouthPop: 1, duration: 0.5, ease: "power2.inOut" }, 1.55);
        break;
    }
  }

  snap(state: CharacterState) {
    this.dispose();
    this.walkW = 0;
    this.speed = 0;
    this.phase = 0;
    const p = this.p;
    if (state === "seated") {
      this.pos.set(ANCHORS.stool[0], 0, ANCHORS.stool[2]);
      this.yaw = this.targetYaw = FACE_MACHINE;
      p.seat = 1;
      this.state = "seated";
    } else if (state === "offstage") {
      this.pos.set(...ANCHORS.door);
      this.yaw = this.targetYaw = yawToward(ANCHORS.aisle[0], ANCHORS.aisle[1]);
      p.seat = 0;
      this.state = "offstage";
    } else {
      // standing (and "walking", which can't be snapped to): the end of the aisle, facing on toward the machine
      const a = ANCHORS.aisle;
      const end = a[a.length - 1];
      this.pos.set(end[0], 0, end[2]);
      this.yaw = this.targetYaw = yawToward(a[a.length - 2], end);
      p.seat = 0;
      this.state = "standing";
    }
    p.hop = 0;
  }

  // ── internals: actions ────────────────────────────────────────────────────

  private startWalk(path: readonly Vec3[], speed: number, faceYaw: number | null): Promise<void> {
    this.cancelWalk();
    const pts: Vector3[] = [];
    const here = this.ptmp.set(this.pos.x, 0, this.pos.z);
    if (!path.length || here.distanceTo(new Vector3(path[0][0], 0, path[0][2])) > 0.05) pts.push(here.clone());
    for (const q of path) {
      const v = new Vector3(q[0], 0, q[2]);
      if (!pts.length || pts[pts.length - 1].distanceTo(v) > 0.02) pts.push(v);
    }
    if (pts.length < 2) {
      this.state = this.p.seat > 0.5 ? "seated" : "standing";
      return Promise.resolve();
    }
    const curve = new CatmullRomCurve3(pts, false, "centripetal", 0.5);
    const len = curve.getLength();
    this.state = "walking";
    return new Promise<void>((resolve) => {
      this.pending.walk = resolve;
      this.walking = {
        curve,
        len,
        s: 0,
        v: Math.max(this.speed, faceYaw === null ? 0.15 : 0.6),
        speed: Math.max(0.2, speed),
        faceYaw,
        done: resolve,
      };
    });
  }

  /** hop onto (true) or off (false) the stool: one blended ≈0.55s move */
  private hop(on: boolean): Promise<void> {
    this.cancelMove();
    const p = this.p;
    const from = this.v3.copy(this.pos).clone();
    const to = on ? new Vector3(ANCHORS.stool[0], 0, ANCHORS.stool[2]) : new Vector3(...PRESEAT);
    const k = { t: 0 };
    this.targetYaw = FACE_MACHINE;
    this.yawRate = 10;
    return new Promise<void>((resolve) => {
      this.pending.move = resolve;
      const tl = gsap.timeline({
        onComplete: () => {
          this.tl.move = undefined;
          this.state = on ? "seated" : "standing";
          this.settle("move");
        },
      });
      this.tl.move = tl;
      tl.to(
        k,
        {
          t: 1,
          duration: 0.5,
          ease: "power2.inOut",
          onUpdate: () => {
            this.pos.lerpVectors(from, to, k.t);
          },
        },
        0,
      );
      tl.to(p, { seat: on ? 1 : 0, duration: 0.42, ease: on ? "power2.out" : "power2.in" }, on ? 0.04 : 0.06);
      tl.to(p, { hop: 0.07, duration: 0.22, ease: "power2.out" }, 0);
      tl.to(p, { hop: on ? -0.018 : 0, duration: 0.22, ease: "power2.in" }, 0.22);
      if (on) tl.to(p, { hop: 0, duration: 0.24, ease: "back.out(3)" }, 0.44);
    });
  }

  private standUp(): Promise<void> {
    this.cancelPull();
    return this.hop(false);
  }

  private setMouth(m: Mouth) {
    this.mouth = m;
  }

  private settle(kind: "walk" | "move" | "pull") {
    const r = this.pending[kind];
    this.pending[kind] = undefined;
    r?.();
  }
  private cancelWalk() {
    if (this.walking) {
      this.walking = null;
      this.settle("walk");
    }
  }
  private cancelMove() {
    this.cancelWalk();
    this.tl.move?.kill();
    this.tl.move = undefined;
    this.settle("move");
    if (this.state === "walking") this.state = this.p.seat > 0.5 ? "seated" : "standing";
  }
  private cancelPull() {
    this.tl.pull?.kill();
    this.tl.pull = undefined;
    const p = this.p;
    p.reach = p.ik = p.pull = p.yank = p.grip = p.scoot = 0;
    if (!this.tl.react) p.browSad = 0;
    if (this.mouth === "o") this.mouth = "smile";
    this.settle("pull");
  }
  private resetReactOverlays() {
    const p = this.p;
    p.slump = p.shake = p.nod = p.nodAmp = p.pump = p.pumpBeat = p.armsUp = p.jump = 0;
    p.fist = p.happyEyes = p.browUp = 0;
    p.browSad = 0;
    p.mouthPop = 1;
    if (this.p.seat > 0.99 || this.p.seat < 0.01) p.hop = 0;
  }
  private resetOverlays() {
    this.resetReactOverlays();
    const p = this.p;
    p.reach = p.ik = p.pull = p.yank = p.grip = p.scoot = 0;
    this.mouth = "smile";
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  update(rawDt: number) {
    const rig = this.rig;
    if (!rig) return;
    const dt = Math.min(rawDt, 1 / 20) * this.timeScale;
    this.t += dt;
    const t = this.t;
    const p = this.p;

    this.updateLocomotion(dt);

    // root
    const dy = wrapAngle(this.targetYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + dy * (1 - Math.exp(-this.yawRate * dt)));
    rig.root.position.copy(this.pos);
    rig.root.rotation.set(0, this.yaw, 0);

    const seat = clamp01(p.seat);
    const W = this.walkW * (1 - seat);
    const ph = this.phase * TAU;
    const vN = Math.min(1.4, this.speed / 1.2);
    const breath = Math.sin(t * 1.7);

    // ── hips ──
    const bob = -0.016 * Math.cos(2 * ph) * W * (0.6 + 0.4 * vN);
    const standY = STAND_HIPS_Y + bob - (0.02 + 0.03 * Math.min(1, vN)) * W + 0.003 * breath * (1 - W);
    const jumpY = p.jump * 0.16;
    const hipsY = lerp(standY, SEAT_HIPS_Y, seat) + p.hop + jumpY - p.yank * 0.03 * seat;
    const weight = Math.sin(t * 0.55) * (1 - W) * (1 - seat);
    // reaching for the lever he slides toward his right (-X) and forward on the seat
    const hipsX = 0.022 * Math.sin(ph) * W + 0.012 * weight - 0.1 * p.reach * seat;
    const hipsZ = seat * (-0.03 + p.scoot);
    rig.hips.position.set(hipsX, hipsY, hipsZ);
    rig.hips.rotation.set(
      -0.06 * seat - 0.04 * W,
      -0.13 * Math.cos(ph) * W * vN,
      -0.05 * Math.sin(ph) * W - 0.025 * weight,
    );

    // ── spine / chest ──
    // the lever sits beside the cabinet, so the reach is mostly a lean to his right
    // (keeps the big head clear of the cabinet face) with a little forward pitch
    const reach = p.reach * seat;
    rig.spine.rotation.set(
      0.07 * W * vN + 0.08 * seat + 0.16 * reach + 0.22 * p.slump + 0.1 * p.yank * seat - 0.08 * p.armsUp,
      0.08 * Math.cos(ph) * W * vN + 0.12 * reach,
      0.03 * Math.sin(ph) * W + 0.32 * reach + 0.02 * weight,
    );
    rig.chest.rotation.set(
      0.02 * breath + 0.14 * reach + 0.14 * p.slump + 0.08 * p.yank * seat - 0.1 * p.armsUp,
      0.06 * Math.cos(ph) * W * vN + 0.12 * reach,
      0.22 * reach,
    );
    const bs = 1 + 0.012 * breath;
    rig.chest.scale.set(bs, 1, bs);

    // ── head ──
    this.updateLook(dt, seat, W);
    const shake = p.shake * 0.32 * Math.sin(t * 15);
    const nod = p.nodAmp * 0.22 * Math.sin(p.nod * TAU * 2);
    rig.neck.rotation.set(-0.12 * reach - 0.1 * seat * (1 - reach) + 0.12 * p.slump, 0.5 * this.lookYaw * (1 - reach), -0.22 * reach);
    rig.head.rotation.set(
      this.lookPitch - 0.1 * reach + nod + 0.22 * p.slump - 0.25 * p.armsUp - 0.02 * bob * 10,
      0.5 * this.lookYaw * (1 - reach) + shake - 0.3 * reach,
      -0.05 * Math.sin(ph) * W - 0.2 * reach + 0.04 * weight,
    );

    // ── arms (FK), then right-arm lever IK ──
    this.poseArm(rig.arms.l, 1, W, ph, vN, seat);
    this.poseArm(rig.arms.r, -1, W, ph, vN, seat);

    rig.root.updateMatrixWorld(true);

    // ── legs (IK) ──
    this.poseLeg(rig.legs.l, rig, 1, W, ph, seat);
    this.poseLeg(rig.legs.r, rig, -1, W, ph, seat);

    if (p.ik > 0.001) this.leverIK(rig.arms.r, rig);
    else this.debug.leverStretch = 1;

    this.poseFace(rig, dt);
  }

  private updateLocomotion(dt: number) {
    const w = this.walking;
    if (w) {
      const remaining = w.len - w.s;
      const vT = Math.min(w.speed, Math.sqrt(2 * DECEL * remaining) + 0.12);
      w.v = w.v < vT ? Math.min(vT, w.v + ACCEL * dt) : Math.max(vT, w.v - DECEL * 1.6 * dt);
      const ds = Math.min(w.v * dt, remaining);
      w.s += ds;
      const u = Math.min(1, w.s / w.len);
      // heading from two nearby points (getTangentAt allocates internally)
      const u0 = Math.max(0, u - 0.002);
      const u1 = Math.min(1, u + 0.002);
      w.curve.getPointAt(u1, this.v2);
      w.curve.getPointAt(u0, this.v3);
      this.v2.sub(this.v3);
      w.curve.getPointAt(u, this.v1);
      this.pos.set(this.v1.x, 0, this.v1.z);
      const travel = Math.atan2(this.v2.x, this.v2.z);
      this.targetYaw = w.faceYaw ?? travel;
      this.yawRate = w.faceYaw === null ? 9 : 7;
      const rel = travel - this.yaw;
      this.strideX = Math.sin(rel);
      this.strideZ = Math.cos(rel);
      this.speed = w.v;
      this.stride = strideFor(w.v);
      this.phase += ds / (2 * this.stride);
      this.walkW = damp(this.walkW, 1, 12, dt);
      if (remaining - ds <= 1e-4) {
        this.walking = null;
        this.state = this.p.seat > 0.5 ? "seated" : "standing";
        this.settle("walk");
      }
    } else {
      this.speed = damp(this.speed, 0, 10, dt);
      this.walkW = damp(this.walkW, 0, 9, dt);
      if (this.walkW < 0.002) this.walkW = 0;
    }
  }

  private updateLook(dt: number, seat: number, W: number) {
    this.nextLook -= dt;
    if (this.nextLook <= 0) {
      this.nextLook = 1.6 + Math.random() * 2.6;
      const range = W > 0.5 ? 0.25 : seat > 0.5 ? 0.35 : 0.6;
      // mostly look ahead (the reels when seated), with the odd glance aside
      this.lookYawT = Math.random() < 0.55 ? (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 2 * range;
      this.lookPitchT = seat > 0.5 ? -0.02 + (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 0.18;
    }
    this.lookYaw = damp(this.lookYaw, this.lookYawT, 5, dt);
    this.lookPitch = damp(this.lookPitch, this.lookPitchT, 5, dt);
  }

  private poseArm(arm: ArmRig, side: 1 | -1, W: number, ph: number, vN: number, seat: number) {
    const p = this.p;
    // standing idle
    let ux = 0.06 + 0.02 * Math.sin(this.t * 1.7);
    let uy = 0;
    let uz = side * 0.14;
    let fx = -0.28;
    // walk swing (opposite the leg on the same side)
    const swing = side * 0.5 * Math.cos(ph) * W * (0.5 + 0.5 * vN);
    ux += swing;
    fx -= (0.25 + 0.3 * Math.max(0, -swing)) * W;
    // seated: hands resting on the thighs
    ux = lerp(ux, -0.32, seat);
    uz = lerp(uz, side * 0.06, seat);
    uy = lerp(uy, -side * 0.15, seat);
    fx = lerp(fx, -0.78, seat);
    // loss: arms go limp
    fx = lerp(fx, -0.35, p.slump * seat * 0.6);
    // fist pump (right arm)
    if (side < 0 && p.pump > 0) {
      const beat = p.pumpBeat;
      ux = lerp(ux, -0.75 + 0.45 * beat, p.pump);
      uz = lerp(uz, side * 0.38, p.pump);
      uy = lerp(uy, 0.25 * -side, p.pump);
      fx = lerp(fx, -2.1 + 0.35 * beat, p.pump);
    }
    // both arms up: a happy V
    if (p.armsUp > 0) {
      const wig = 0.08 * Math.sin(this.t * 18 + side);
      ux = lerp(ux, -0.25, p.armsUp);
      uy = lerp(uy, 0, p.armsUp);
      uz = lerp(uz, side * (2.55 + wig), p.armsUp);
      fx = lerp(fx, -0.35, p.armsUp);
    }
    arm.upper.rotation.set(ux, uy, uz);
    arm.fore.rotation.set(fx, 0, 0);
    arm.shoulder.rotation.set(0, 0, side * 0.12 * p.armsUp);
    arm.hand.rotation.set(0.1 + 0.25 * seat, side * 0.1, 0);
    // reset any stretch left by the IK
    arm.upperMesh.scale.y = 1;
    arm.upperMesh.position.y = -D.upperArm / 2;
    arm.fore.position.y = -D.upperArm;
    arm.foreMesh.scale.y = 1;
    arm.foreMesh.position.y = -D.forearm / 2;
    arm.hand.position.y = -D.forearm;
    // grip
    const g = Math.max(p.fist, side < 0 ? p.grip : 0);
    arm.palm.scale.set(0.047 + 0.006 * g, 0.066 - 0.012 * g, 0.056 + 0.004 * g);
    arm.thumb.rotation.set(0.5 + 0.5 * g, 0, side * (0.55 - 0.35 * g));
  }

  private poseLeg(leg: LegRig, rig: KeoneRig, side: 1 | -1, W: number, ph: number, seat: number) {
    const p = this.p;
    const hips = rig.hips.position;
    // standing / walking foot target (root-local)
    const u = (this.phase + (side > 0 ? 0 : 0.5)) % 1;
    const L = this.stride * Math.min(1, W * 1.15);
    let off: number;
    let lift: number;
    let pitch: number;
    if (u < 0.5) {
      const s = u / 0.5;
      off = L * (0.5 - s);
      lift = 0;
      pitch = 0.18 * Math.max(0, s - 0.75) * 4 * W; // heel peel before toe-off
    } else {
      const s = (u - 0.5) / 0.5;
      const e = s * s * (3 - 2 * s);
      off = L * (-0.5 + e);
      lift = (0.055 + 0.025 * Math.min(1.4, this.speed / 1.2)) * Math.sin(Math.PI * s) * W;
      pitch = (0.5 * Math.sin(Math.PI * s * 1.2) - 0.35 * Math.max(0, s - 0.7) * 3.3) * W;
    }
    // settle step: as the walk blends out, lift whichever foot still has to slide home
    const settle = this.walkW > 0 && !this.walking ? Math.sin(Math.PI * this.walkW) * Math.min(1, Math.abs(off) * 8) : 0;
    const sx = side * (D.hipX + 0.004) + this.strideX * off;
    const sy = D.ankleH + lift + 0.04 * settle;
    const sz = this.strideZ * off;

    // seated target, relative to the hips: thigh level, shin hanging, feet dangling and kicking idly
    const kick = 0.035 * Math.sin(this.t * 1.9 + side * 1.4) * (1 - p.reach) * (1 - p.jump);
    const tuck = p.jump * 0.06;
    const ax = hips.x + side * (D.hipX + 0.01);
    const ay = hips.y - D.hipDrop - D.shin * 0.96 + tuck;
    const az = hips.z + D.thigh - 0.05 + kick - tuck;

    // blend; during the hop the feet leave the floor early
    const k = seat * seat * (3 - 2 * seat);
    this.v1.set(lerp(sx, ax, k), lerp(sy, ay, k), lerp(sz, az, k));
    rig.root.localToWorld(this.v1);
    // knee pole: in front, at knee height
    this.vPole.set(side * 0.06, lerp(0.4, hips.y + 0.25, k), 1.2);
    rig.root.localToWorld(this.vPole);

    solveTwoBone(rig.hips, leg.thigh, D.thigh, D.shin, this.v1, this.vPole, 1, 1, this.qA, this.qB);
    leg.thigh.quaternion.copy(this.qA);
    leg.shin.quaternion.copy(this.qB);
    leg.thigh.updateMatrixWorld(true);

    // keep the sole flat (or pitched) in root space: foot = inv(shinWorld) * rootWorld * desired
    const footPitch = lerp(pitch, 0.4, k) + 0.08 * Math.sin(this.t * 1.9 + side * 1.4) * k;
    this.eu.set(footPitch, side * 0.07 * (1 - W), 0);
    this.qC.setFromEuler(this.eu);
    leg.shin.getWorldQuaternion(this.qD).invert();
    rig.root.getWorldQuaternion(this.qA);
    leg.foot.quaternion.copy(this.qD).multiply(this.qA).multiply(this.qC);

    if (side > 0) {
      // lab metric: world drift of the left foot while it is planted
      leg.foot.getWorldPosition(this.v2);
      this.debug.footDrift = u > 0.04 && u < 0.46 && W > 0.95 ? this.v2.distanceTo(this.prevFootL) : 0;
      this.prevFootL.copy(this.v2);
    }
  }

  private leverIK(arm: ArmRig, rig: KeoneRig) {
    const p = this.p;
    const w = clamp01(p.ik);
    // the cabinet's ball: an arc toward the player and down around the pivot
    const th = LEVER_REST + clamp01(p.pull) * (LEVER_PULLED - LEVER_REST);
    this.lever.set(ANCHORS.lever[0], ANCHORS.lever[1] + LEVER_RADIUS * Math.cos(th), ANCHORS.lever[2] + LEVER_RADIUS * Math.sin(th));
    rig.root.parent?.localToWorld(this.lever);

    // elbow out to the right and down
    arm.shoulder.getWorldPosition(this.vPole);
    this.debug.shoulder[0] = this.vPole.x;
    this.debug.shoulder[1] = this.vPole.y;
    this.debug.shoulder[2] = this.vPole.z;
    (rig.head.children[0] ?? rig.head).getWorldPosition(this.v1);
    this.debug.headFrontZ = this.v1.z - 0.22; // head centre minus its half-depth (he faces -Z)
    this.v3.set(-0.8, -0.35, -0.1).applyQuaternion(rig.root.quaternion);
    this.vPole.add(this.v3);

    const a = D.upperArm;
    const b = D.forearm + D.handReach;
    const res = solveTwoBone(arm.shoulder, arm.upper, a, b, this.lever, this.vPole, -1, 1.3, this.qA, this.qB);
    this.debug.leverReach = res.reach;
    this.debug.leverStretch = res.stretch;

    arm.upper.quaternion.slerp(this.qA, w);
    arm.fore.quaternion.slerp(this.qB, w);
    const s = 1 + (res.stretch - 1) * w;
    arm.upperMesh.scale.y = s;
    arm.upperMesh.position.y = (-D.upperArm / 2) * s;
    arm.fore.position.y = -D.upperArm * s;
    arm.foreMesh.scale.y = s;
    arm.foreMesh.position.y = (-D.forearm / 2) * s;
    arm.hand.position.y = -D.forearm * s;
    arm.hand.rotation.set(lerp(arm.hand.rotation.x, 0.2, w), lerp(arm.hand.rotation.y, 0.9, w), 0);

    arm.upper.updateMatrixWorld(true);
    arm.palm.getWorldPosition(this.v1);
    this.debug.leverResidual = this.v1.distanceTo(this.lever);
  }

  private poseFace(rig: KeoneRig, dt: number) {
    const p = this.p;
    const f = rig.face;
    // blink
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blink < 0) {
      this.blink = 0;
      this.nextBlink = 2.2 + Math.random() * 3.2;
      if (Math.random() < 0.18) this.nextBlink = 0.25; // the odd double blink
    }
    let lid = 1;
    if (this.blink >= 0) {
      this.blink += dt / 0.15;
      lid = 1 - Math.sin(Math.min(1, this.blink) * Math.PI) * 0.92;
      if (this.blink >= 1) this.blink = -1;
    }
    const happy = 1 - 0.55 * p.happyEyes;
    for (let i = 0; i < 2; i++) {
      const e = f.eyes[i];
      e.scale.set(1 + 0.08 * p.browUp, lid * happy * (1 + 0.1 * p.browUp), 1);
      const s = i === 0 ? 1 : -1;
      const b = f.brows[i];
      b.position.y = FACE.browY + 0.016 * p.browUp + 0.004 * p.browSad;
      b.rotation.z = Math.PI / 2 + s * (0.08 - 0.32 * p.browSad);
    }
    f.smile.visible = this.mouth === "smile" || this.mouth === "flat";
    f.o.visible = this.mouth === "o";
    f.grin.visible = this.mouth === "grin";
    const pop = p.mouthPop;
    if (this.mouth === "flat") f.smile.scale.set(0.75, 0.22, 1);
    else f.smile.scale.set(pop, pop, 1);
    f.o.scale.setScalar(0.9 + 0.1 * pop);
    f.grin.scale.setScalar(pop);
  }
}
