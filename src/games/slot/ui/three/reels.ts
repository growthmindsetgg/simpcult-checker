"use client";

import * as THREE from "three";
import { REELS, ROWS, STRIPS, type SymbolId } from "../../config";
import { isFace } from "../faces";
import { sfx } from "../sound";
import { ATLAS_COLS, cellOrigin } from "./atlas";

/**
 * Three drums. Each has N symbol faces around its rim; a face's symbol is a
 * per-slot uniform pointing into the shared atlas, so results are written by
 * changing a uniform on slots that are round the back of the drum, never on
 * a face you can see.
 *
 * World angle of slot s on a drum turned by θ: ψ = s·α − θ (0 = facing the
 * player, +α = the top row). θ grows while spinning, so symbols travel down.
 * At rest θ = k·α: the rows show slots k+1 (top), k (middle), k−1 (bottom).
 */

export const N = 12;
export const ALPHA = (Math.PI * 2) / N;
export const RADIUS = 0.26;
export const REEL_W = 0.165;
export const REEL_GAP = 0.03;
export const REEL_X = [-(REEL_W + REEL_GAP), 0, REEL_W + REEL_GAP] as const;

const SPEED = 20 * ALPHA; // rad/s at full spin (20 symbols a second, like the DOM reels)
const HUNT_SPEED = 0.42 * SPEED;
const KICK = 0.14 * ALPHA;
const SPINUP_S = 0.28;
const MIN_TRAVEL = 4; // whole slots travelled while decelerating (the result slots start round the back)
const OVERSHOOT = 0.13 * ALPHA;
const SETTLE_S = 0.2;

type Phase =
  | { kind: "idle" }
  | { kind: "spinup"; t0: number; from: number }
  | { kind: "spin"; speed: number }
  | { kind: "decel"; t0: number; from: number; to: number; dur: number; resolve: () => void; landed: boolean }
  | { kind: "settle"; t0: number; from: number; to: number };

type FaceFx = { t0: number; kind: "land" | "wink" };

const vert = /* glsl */ `
attribute vec2 aLocal;
attribute float aSlot;
attribute float aAng;
uniform float uTheta;
varying vec2 vLocal;
varying float vSlot;
varying float vShade;
void main() {
  vLocal = aLocal;
  vSlot = aSlot;
  float psi = aAng - uTheta;
  // backlit drum: brightest facing the player, falling off over the curve
  vShade = pow(clamp(cos(psi), 0.0, 1.0), 1.8);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uMapBlur;
uniform float uBlur;
uniform float uAspect;
uniform float uCellSize;
uniform vec2 uCell[${N}];
uniform vec3 uFx[${N}];     // x,y: scale of the art around its centre; z: vertical offset
uniform vec2 uState[${N}];  // x: pink glow, y: dim
uniform float uHunt;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uNeon;
uniform float uBright;
varying vec2 vLocal;
varying float vSlot;
varying float vShade;
void main() {
  int s = int(vSlot + 0.5);
  vec3 fx = uFx[s];
  vec2 st = uState[s];
  // square art centred on a cell that is a little wider than tall
  vec2 p = vec2((vLocal.x - 0.5) * uAspect, vLocal.y - 0.5 - fx.z) / fx.xy + 0.5;
  float inside = step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
  vec2 uv = uCell[s] + clamp(p, 0.004, 0.996) * uCellSize;
  vec4 a = texture2D(uMap, uv);
  vec4 b = texture2D(uMapBlur, uv);
  vec4 c = mix(a, b, uBlur);
  c.a *= inside;

  // printed paper with a faint horizontal grain, which smears while spinning
  float grain = 0.985 + 0.015 * sin(vLocal.y * 180.0 + vSlot * 7.0);
  vec3 col = mix(uPaper * grain, c.rgb, c.a);
  col = mix(col, uPaper * 0.92, uBlur * 0.35);

  // thin printed rule between symbols
  float rule = smoothstep(0.0, 0.012, vLocal.y) * smoothstep(0.0, 0.012, 1.0 - vLocal.y);
  col *= mix(0.82, 1.0, rule);

  col *= mix(1.0, 0.42, st.y);
  float edge = min(min(vLocal.x * uAspect, (1.0 - vLocal.x) * uAspect), min(vLocal.y, 1.0 - vLocal.y));
  float rim = 1.0 - smoothstep(0.0, 0.07, edge);
  col += uNeon * st.x * (rim * 2.8 + 0.22);
  // anticipation: the whole reel's rim breathes pink
  float hunt = uHunt * (0.55 + 0.45 * sin(uTime * 14.0));
  float side = 1.0 - smoothstep(0.0, 0.06, min(vLocal.x, 1.0 - vLocal.x));
  col += uNeon * hunt * side * 1.2;

  gl_FragColor = vec4(col * vShade * uBright, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function drumGeometry(): THREE.BufferGeometry {
  const seg = 8;
  const pos: number[] = [];
  const local: number[] = [];
  const slot: number[] = [];
  const ang: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (let s = 0; s < N; s++) {
    for (let j = 0; j <= seg; j++) {
      const v = j / seg;
      const a = s * ALPHA - ALPHA / 2 + v * ALPHA;
      const y = RADIUS * Math.sin(a);
      const z = RADIUS * Math.cos(a);
      for (const u of [0, 1]) {
        pos.push((u - 0.5) * REEL_W, y, z);
        nrm.push(0, Math.sin(a), Math.cos(a));
        local.push(u, v);
        slot.push(s);
        ang.push(a);
      }
    }
    for (let j = 0; j < seg; j++) {
      const i0 = base + j * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
    base += (seg + 1) * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("aLocal", new THREE.Float32BufferAttribute(local, 2));
  g.setAttribute("aSlot", new THREE.Float32BufferAttribute(slot, 1));
  g.setAttribute("aAng", new THREE.Float32BufferAttribute(ang, 1));
  g.setIndex(idx);
  return g;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

class Reel {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  theta = 0;
  speed = 0;
  phase: Phase = { kind: "idle" };
  symbols: SymbolId[];
  glow = new Float32Array(N);
  glowTarget = new Float32Array(N);
  dim = new Float32Array(N);
  dimTarget = new Float32Array(N);
  faceFx: (FaceFx | null)[] = Array.from({ length: N }, () => null);
  hunt = 0;
  huntTarget = 0;
  lastTick = 0;
  lastSlot = 0;

  constructor(
    readonly index: number,
    geo: THREE.BufferGeometry,
    map: THREE.Texture,
    blur: THREE.Texture,
  ) {
    this.symbols = Array.from({ length: N }, (_, j) => STRIPS[index][(index * 13 + j * 5) % STRIPS[index].length]);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uMap: { value: map },
        uMapBlur: { value: blur },
        uBlur: { value: 0 },
        uAspect: { value: REEL_W / (RADIUS * ALPHA) },
        uCellSize: { value: 1 / ATLAS_COLS },
        uCell: { value: Array.from({ length: N }, () => new THREE.Vector2()) },
        uFx: { value: Array.from({ length: N }, () => new THREE.Vector3(1, 1, 0)) },
        uState: { value: Array.from({ length: N }, () => new THREE.Vector2()) },
        uHunt: { value: 0 },
        uTime: { value: 0 },
        uTheta: { value: 0 },
        uPaper: { value: new THREE.Color("#f4e8d2") },
        uNeon: { value: new THREE.Color("#ff3fae") },
        uBright: { value: 0.86 },
      },
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.x = REEL_X[index];
    this.writeCells();
  }

  writeCells() {
    const cells = this.mat.uniforms.uCell.value as THREE.Vector2[];
    this.symbols.forEach((id, s) => cells[s].set(...cellOrigin(id)));
  }

  /** slot showing `row` (0 top, 1 middle, 2 bottom) when the drum rests at θ = k·α */
  static slotFor(k: number, row: number) {
    return mod(k + (1 - row), N);
  }

  restingK() {
    return Math.round(this.theta / ALPHA);
  }

  /** visible slots right now, by row (only meaningful at rest) */
  visible(): number[] {
    const k = this.restingK();
    return [0, 1, 2].map((row) => Reel.slotFor(k, row));
  }

  show(col: SymbolId[]) {
    this.phase = { kind: "idle" };
    this.speed = 0;
    const k = this.restingK();
    this.theta = k * ALPHA;
    for (let row = 0; row < ROWS; row++) this.symbols[Reel.slotFor(k, row)] = col[row];
    this.writeCells();
  }

  start(now: number, delay: number) {
    this.phase = { kind: "spinup", t0: now + delay, from: this.theta };
    this.huntTarget = 0;
  }

  setHunt(on: boolean) {
    this.huntTarget = on ? 1 : 0;
    if (on && this.phase.kind === "spin") this.phase = { kind: "spin", speed: HUNT_SPEED };
  }

  stop(col: SymbolId[], now: number): Promise<void> {
    return new Promise((resolve) => {
      const v = this.phase.kind === "spin" ? this.phase.speed : SPEED;
      // land on the first whole slot at least MIN_TRAVEL slots ahead
      const k = Math.ceil(this.theta / ALPHA) + MIN_TRAVEL;
      for (let row = 0; row < ROWS; row++) this.symbols[Reel.slotFor(k, row)] = col[row];
      this.writeCells();
      const to = k * ALPHA;
      const travel = to + OVERSHOOT - this.theta;
      const dur = (3 * travel) / v; // ease-out cubic starts at slope 3: picks up exactly at the current speed
      this.phase = { kind: "decel", t0: now, from: this.theta, to, dur, resolve, landed: false };
    });
  }

  highlight(rows: number[], on: boolean) {
    const k = this.restingK();
    this.glowTarget.fill(0);
    this.dimTarget.fill(0);
    if (!on) return;
    const vis = [0, 1, 2].map((r) => Reel.slotFor(k, r));
    vis.forEach((s, r) => {
      if (rows.includes(r)) {
        this.glowTarget[s] = 1;
        if (isFace(this.symbols[s])) this.faceFx[s] = { t0: performance.now() / 1000, kind: "wink" };
      } else this.dimTarget[s] = 1;
    });
  }

  update(now: number, dt: number) {
    const p = this.phase;
    if (p.kind === "spinup") {
      const t = now - p.t0;
      if (t < 0) {
        // waiting for this reel's stagger
      } else if (t < SPINUP_S * 0.3) {
        // a little pull-back before the spin
        const k = t / (SPINUP_S * 0.3);
        this.theta = p.from - KICK * Math.sin(k * Math.PI * 0.5);
        this.speed = 0;
      } else {
        const k = Math.min(1, (t - SPINUP_S * 0.3) / (SPINUP_S * 0.7));
        this.speed = SPEED * k * k;
        this.theta += this.speed * dt;
        if (k >= 1) this.phase = { kind: "spin", speed: SPEED };
      }
    } else if (p.kind === "spin") {
      // ease toward the target speed (the hunting reel slows down)
      this.speed += (p.speed - this.speed) * Math.min(1, dt * 5);
      this.theta += this.speed * dt;
    } else if (p.kind === "decel") {
      const k = Math.min(1, (now - p.t0) / p.dur);
      const prev = this.theta;
      this.theta = p.from + (p.to + OVERSHOOT - p.from) * easeOutCubic(k);
      this.speed = dt > 0 ? (this.theta - prev) / dt : 0;
      if (k >= 1) {
        this.phase = { kind: "settle", t0: now, from: this.theta, to: p.to };
        this.huntTarget = 0;
        sfx.reelStop(this.index);
        const t = now;
        this.visible().forEach((s) => {
          if (isFace(this.symbols[s])) this.faceFx[s] = { t0: t, kind: "land" };
        });
        p.resolve();
      }
    } else if (p.kind === "settle") {
      const k = Math.min(1, (now - p.t0) / SETTLE_S);
      this.theta = p.from + (p.to - p.from) * easeInOut(k);
      this.speed = 0;
      if (k >= 1) {
        this.theta = p.to;
        this.phase = { kind: "idle" };
      }
    }

    // keep θ bounded so float precision never drifts (whole turns are invisible)
    if (this.phase.kind === "idle" && Math.abs(this.theta) > Math.PI * 200) {
      this.theta = mod(this.theta, Math.PI * 2);
    }

    // ratchet ticks while slowing down
    const slotNow = Math.floor(this.theta / ALPHA);
    if (slotNow !== this.lastSlot) {
      this.lastSlot = slotNow;
      const slowing = this.phase.kind === "decel" || (this.phase.kind === "spin" && this.phase.speed < SPEED);
      if (slowing && now - this.lastTick > 0.06) {
        this.lastTick = now;
        sfx.reelTick(this.index);
      }
    }

    const u = this.mat.uniforms;
    u.uTheta.value = this.theta;
    this.mesh.rotation.x = this.theta;
    u.uBlur.value = Math.min(1, Math.max(0, (Math.abs(this.speed) / SPEED - 0.35) / 0.5));
    u.uTime.value = now;
    this.hunt += (this.huntTarget - this.hunt) * Math.min(1, dt * 8);
    u.uHunt.value = this.hunt;

    const state = u.uState.value as THREE.Vector2[];
    const fx = u.uFx.value as THREE.Vector3[];
    for (let s = 0; s < N; s++) {
      this.glow[s] += (this.glowTarget[s] - this.glow[s]) * Math.min(1, dt * 10);
      this.dim[s] += (this.dimTarget[s] - this.dim[s]) * Math.min(1, dt * 6);
      let glow = this.glow[s] * (0.7 + 0.3 * Math.sin(now * 7));
      let sx = 1;
      let sy = 1;
      let oy = 0;
      if (isFace(this.symbols[s])) {
        // faces breathe a little at rest
        oy = 0.012 * Math.sin(now * 2.1 + s * 1.7) * (this.phase.kind === "idle" ? 1 : 0);
        const f = this.faceFx[s];
        if (f) {
          const t = now - f.t0;
          if (f.kind === "land") {
            // squash on landing, then a pink rim pulse
            const d = Math.exp(-t * 7) * Math.sin(t * 22);
            sx = 1 + 0.12 * d;
            sy = 1 - 0.12 * d;
            glow = Math.max(glow, 0.55 * Math.exp(-t * 3.2));
            if (t > 1.2) this.faceFx[s] = null;
          } else {
            // the wink: three quick squishes
            const beat = t % 0.62;
            const w = beat < 0.3 ? Math.sin((beat / 0.3) * Math.PI) : 0;
            sx = 1 + 0.14 * w;
            sy = 1 - 0.18 * w;
            if (t > 0.62 * 3) this.faceFx[s] = null;
          }
        }
      }
      state[s].set(glow, this.dim[s]);
      fx[s].set(sx, sy, oy);
    }
  }
}

export class ReelSystem {
  readonly group = new THREE.Group();
  readonly reels: Reel[];
  private geo = drumGeometry();

  constructor(map: THREE.Texture, blur: THREE.Texture) {
    this.reels = Array.from({ length: REELS }, (_, i) => new Reel(i, this.geo, map, blur));
    for (const r of this.reels) this.group.add(r.mesh);
  }

  get busy() {
    return this.reels.some((r) => r.phase.kind !== "idle");
  }

  show(grid: SymbolId[][]) {
    this.reels.forEach((r, i) => r.show(grid[i]));
  }

  startSpin() {
    const now = performance.now() / 1000;
    this.reels.forEach((r, i) => {
      r.highlight([], false);
      r.start(now, i * 0.045);
    });
  }

  hunt(i: number, on: boolean) {
    this.reels[i]?.setHunt(on);
  }

  stopReel(i: number, col: SymbolId[]) {
    const r = this.reels[i];
    if (r.phase.kind === "idle" || r.phase.kind === "settle" || r.phase.kind === "spinup") {
      // asked to stop before it reached full speed (or without a spin at all): run at full speed, then decelerate
      r.phase = { kind: "spin", speed: SPEED };
      r.speed = SPEED;
    }
    return r.stop(col, performance.now() / 1000);
  }

  highlight(cells: readonly (readonly [number, number])[], on: boolean) {
    this.reels.forEach((r, i) =>
      r.highlight(
        cells.filter(([reel]) => reel === i).map(([, row]) => row),
        on,
      ),
    );
  }

  update(dt: number) {
    const now = performance.now() / 1000;
    for (const r of this.reels) r.update(now, dt);
  }

  dispose() {
    this.geo.dispose();
    for (const r of this.reels) r.mat.dispose();
  }
}
