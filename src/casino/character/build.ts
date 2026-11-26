/**
 * Builds Keone's rig: a hierarchy of groups with vinyl / fabric meshes hung on
 * them. Everything is primitives built in code (lathe, capsule, sphere,
 * cylinder, extruded heart). Geometries and materials are shared module
 * singletons per quality tier; only the Object3D tree is per instance.
 */
import {
  CanvasTexture,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  Quaternion,
  RepeatWrapping,
  Shape,
  SphereGeometry,
  SplineCurve,
  TorusGeometry,
  Vector2,
  Vector3,
  BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Quality } from "../contract";
import { D } from "./dims";

// ── materials (one shared set) ──────────────────────────────────────────────

function vinyl(color: string, extra: Partial<ConstructorParameters<typeof MeshPhysicalMaterial>[0]> = {}) {
  return new MeshPhysicalMaterial({
    color: new Color(color),
    roughness: 0.45,
    clearcoat: 0.8,
    clearcoatRoughness: 0.3,
    ...extra,
  });
}
function fabric(color: string, sheen: string, extra: Partial<ConstructorParameters<typeof MeshPhysicalMaterial>[0]> = {}) {
  return new MeshPhysicalMaterial({
    color: new Color(color),
    roughness: 0.82,
    sheen: 1,
    sheenColor: new Color(sheen),
    sheenRoughness: 0.4,
    ...extra,
  });
}

/**
 * Fine strand texture for the hair, drawn in code: a height field of short
 * overlapping strokes running down the strands, turned into a normal map so
 * the sheen breaks into hair instead of a smooth helmet highlight.
 */
function hairStrandMap() {
  if (typeof document === "undefined") return null;
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const g = c.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, N, N);
  g.lineCap = "round";
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    const x = rnd() * N;
    const y = rnd() * N;
    const len = 10 + rnd() * 26;
    const tilt = (rnd() - 0.5) * 0.35;
    const v = Math.round(60 + rnd() * 140);
    g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    g.lineWidth = 1 + rnd() * 2.2;
    for (const dx of [-N, 0, N]) {
      for (const dy of [-N, 0, N]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + Math.sin(tilt) * len, y + dy + Math.cos(tilt) * len);
        g.stroke();
      }
    }
  }
  const src = g.getImageData(0, 0, N, N).data;
  const out = g.createImageData(N, N);
  const h = (x: number, y: number) => src[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 2.2;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 2.2;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      out.data[o] = (-dx / l) * 127 + 128;
      out.data[o + 1] = (dy / l) * 127 + 128;
      out.data[o + 2] = (1 / l) * 127 + 128;
      out.data[o + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 1.6);
  t.anisotropy = 4;
  return t;
}

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  return {
    // warm light-tan vinyl, satin rather than glossy so it reads as skin under coloured light
    skin: vinyl("#e2b48f", { roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.4, sheen: 0.25, sheenColor: new Color("#ffdcc4") }),
    skinShade: vinyl("#c99272", { roughness: 0.55, clearcoat: 0.25 }),
    stubble: new MeshPhysicalMaterial({ color: new Color("#c7a085"), roughness: 0.85 }),
    // near-black hair: a soft cool sheen on the crown and a satin coat, never a plastic shine
    hair: new MeshPhysicalMaterial({
      normalMap: hairStrandMap(),
      normalScale: new Vector2(1.3, 1.3),
      color: new Color("#0c0b0f"),
      roughness: 0.62,
      sheen: 0.6,
      sheenColor: new Color("#3b4058"),
      sheenRoughness: 0.55,
      clearcoat: 0.15,
      clearcoatRoughness: 0.5,
    }),
    brow: new MeshPhysicalMaterial({ color: new Color("#141218"), roughness: 0.75 }),
    tee: fabric("#18181c", "#50525e"),
    teeRib: fabric("#222227", "#5a5c68", { roughness: 0.75 }),
    jeans: fabric("#2c2f37", "#5f6779"),
    shoe: vinyl("#25252b", { roughness: 0.5, clearcoat: 0.5 }),
    sole: vinyl("#cdc8c0", { roughness: 0.6, clearcoat: 0.3 }),
    eye: vinyl("#1b130f", { roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    glint: new MeshBasicMaterial({ color: "#fff6ee" }),
    mouth: vinyl("#4e2723", { roughness: 0.55, clearcoat: 0.3 }),
    teeth: vinyl("#fbf3e6", { roughness: 0.35, clearcoat: 0.9 }),
    pin: vinyl("#ff3fae", {
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      emissive: new Color("#ff3fae"),
      emissiveIntensity: 0.45,
    }),
  };
}
export type KeoneMaterials = ReturnType<typeof makeMaterials>;
export function getMaterials() {
  return (mats ??= makeMaterials());
}

// ── shared geometry per tier ────────────────────────────────────────────────

/** smooth lathe from a handful of (radius, y) control points */
function lathe(
  points: [number, number][],
  segs: number,
  radial: number,
  closeStart = true,
  closeEnd = true,
  phiStart = 0,
  phiLength = Math.PI * 2,
) {
  const curve = new SplineCurve(points.map(([x, y]) => new Vector2(x, y)));
  const pts = curve.getPoints(segs).map((p) => new Vector2(Math.max(0, p.x), p.y));
  if (closeStart) pts[0].x = 0;
  if (closeEnd) pts[pts.length - 1].x = 0;
  return new LatheGeometry(pts, radial, phiStart, phiLength);
}

/** the head's profile (radius at height y, head-local): a broad, round, full face with a soft wide jaw */
export const HEAD_PROFILE: [number, number][] = [
  [0, -0.205],
  [0.13, -0.2],
  [0.2, -0.166],
  [0.232, -0.098],
  [0.24, -0.012],
  [0.234, 0.078],
  [0.21, 0.158],
  [0.14, 0.22],
  [0, 0.238],
];
export const HEAD_WIDTH = 1.1; // x stretch: the face is a little wider than tall
export const HEAD_DEPTH = 0.92; // z squash
/** hairline above the forehead (the rest of the line is HAIRLINE_KEYS) */
const HAIRLINE = 0.118;
/** face part heights (head-mesh local), shared with the controller */
export const FACE = { browY: 0.056, eyeY: 0.0 } as const;

function profileRadius(y: number) {
  const p = HEAD_PROFILE;
  for (let i = 0; i < p.length - 1; i++) {
    const [r0, y0] = p[i];
    const [r1, y1] = p[i + 1];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}
/** z of the head's front surface at (x, y), head-mesh local */
export function headFrontZ(x: number, y: number) {
  const r = profileRadius(y);
  const u = x / HEAD_WIDTH;
  return HEAD_DEPTH * Math.sqrt(Math.max(0, r * r - u * u));
}

/** tiny deterministic hash -> [0, 1) so the hair is the same every build */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** smoothstep */
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Hairline height (head-mesh local y) around the head. az is the azimuth from
 * the face (0) round to the nape (±π): high over the forehead, dipping over
 * the ears, down to the nape at the back.
 */
const HAIRLINE_KEYS: [number, number][] = [
  [0, HAIRLINE],
  [0.55, 0.112],
  [0.95, 0.09],
  [1.3, 0.062],
  [1.62, 0.05],
  [2.0, 0.0],
  [2.45, -0.09],
  [Math.PI, -0.13],
];
function hairlineY(az: number) {
  const a = Math.abs(az);
  const k = HAIRLINE_KEYS;
  for (let i = 0; i < k.length - 1; i++) {
    if (a <= k[i + 1][0]) {
      const t = sstep(k[i][0], k[i + 1][0], a);
      return k[i][1] + (k[i + 1][1] - k[i][1]) * t;
    }
  }
  return k[k.length - 1][1];
}

/** soft clumps over the crown and front, so the crop reads textured rather than a smooth helmet */
const CLUMPS = Array.from({ length: 70 }, (_, i) => ({
  az: (hash(i + 900) - 0.5) * 2 * 2.9,
  y: 0.02 + hash(i + 950) * 0.22,
  h: 0.0035 + hash(i + 990) * 0.005,
  r: 0.02 + hash(i + 1030) * 0.012,
}));

/**
 * The hair as one solid mass sitting on the skull: a displaced shell from the
 * hairline to the crown. Thick on top and at the front (pushed up and
 * forward, with a short fringe lip over the forehead), close-cropped on the
 * sides and back. Writes the surface point and outward direction for
 * (az, v) so the nubs can sit on it.
 */
function hairSurface(az: number, v: number, out: Vector3, dir: Vector3) {
  const hl = hairlineY(az);
  const y0 = hl + (0.238 - hl) * v;
  const r = profileRadius(Math.min(0.2379, y0));
  out.set(HEAD_WIDTH * r * Math.sin(az), y0, HEAD_DEPTH * r * Math.cos(az));
  dir.set(out.x / HEAD_WIDTH, out.y + 0.03, out.z / HEAD_DEPTH).normalize();

  const a = Math.abs(az);
  // near the crown every azimuth meets at one point: fade the per-azimuth shaping out there,
  // or the pole folds into a peak
  const pole = sstep(0.72, 1, v);
  const front = (1 - sstep(0.7, 1.25, a)) * (1 - pole) + 0.45 * pole; // the face side
  const back = sstep(1.9, 2.6, a) * (1 - pole) + 0.3 * pole;
  // close crop: sides thinnest, the back a little fuller; the front is the fringe
  const close = 0.0045 + 0.004 * back + 0.026 * front;
  const top = 0.03;
  let t = close + (top - close) * sstep(0.1, 0.2, y0);
  // the shell thins to a crisp edge at the hairline on the sides, stays blunt at the fringe
  const rise = y0 - hl;
  t *= 0.45 + 0.55 * sstep(0, 0.035 + 0.02 * (1 - front), rise) + 0.3 * front * (1 - sstep(0, 0.02, rise));
  for (const c of CLUMPS) {
    const d2 = ((az - c.az) * r * 1.05) ** 2 + (y0 - c.y) ** 2;
    // every clump near the top lands on the pole (azimuth stops mattering there), so they would stack into a peak
    t += c.h * Math.exp(-d2 / (c.r * c.r)) * (1 - 0.5 * back) * sstep(0, 0.03, rise) * (1 - pole);
  }
  // strand groups: shallow sculpted grooves from the crown down to the hairline, a little wavy
  const wob = 0.35 * Math.sin(y0 * 38 + az * 2.3) + 0.25 * Math.sin(az * 5.1 + 1.7);
  const ridge = Math.pow(Math.abs(Math.sin(az * 13 + wob)), 0.7);
  const ra = (0.0055 + 0.002 * front) * sstep(0, 0.03, rise) * (0.6 + 0.4 * sstep(0.04, 0.15, y0));
  t += ra * (ridge - 0.5) * (1 - pole);
  out.addScaledVector(dir, t);
  // pushed up and forward: the top mass leans toward the face
  const lift = sstep(0.08, 0.2, y0) * (1 - back * 0.7);
  out.y += 0.006 * lift;
  out.z += 0.012 * lift + 0.004 * front;
  // the fringe: the front edge overhangs the forehead a little and dips
  const fringe = front * (1 - sstep(0, 0.045, rise));
  out.z += 0.012 * fringe;
  out.y -= (0.006 + 0.012 * ridge) * fringe; // the edge breaks into short blunt locks
}

function hairShell(nAz: number, nV: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const d = new Vector3();
  for (let j = 0; j <= nV; j++) {
    const v = Math.pow(j / nV, 1.15);
    for (let i = 0; i < nAz; i++) {
      hairSurface(-Math.PI + (i / nAz) * Math.PI * 2, v, p, d);
      pos.push(p.x, p.y, p.z);
      // u runs round the head, v down the strands: the strand normal map's strokes follow v
      uv.push(i / nAz, p.y * 2.2);
    }
  }
  // a skirt row tucked into the skull under the edge, so no gap shows at the hairline
  for (let i = 0; i < nAz; i++) {
    const az = -Math.PI + (i / nAz) * Math.PI * 2;
    const hl = hairlineY(az) - 0.004;
    const r = profileRadius(hl) - 0.004;
    pos.push(HEAD_WIDTH * r * Math.sin(az), hl, HEAD_DEPTH * r * Math.cos(az));
    uv.push(i / nAz, hl * 2.2);
  }
  const skirt = nV + 1;
  const row = (j: number) => (j < 0 ? skirt : j);
  for (let j = -1; j < nV; j++) {
    for (let i = 0; i < nAz; i++) {
      const i1 = (i + 1) % nAz;
      const a = row(j) * nAz + i;
      const b = row(j) * nAz + i1;
      const c = (j + 1) * nAz + i;
      const e = (j + 1) * nAz + i1;
      idx.push(a, b, c, b, e, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Short blunt nubs merged into the mass: dense over the crown and front,
 * mostly sunk so only rounded tips show, all leaning up and forward, plus a
 * row of fringe tips over the forehead. One geometry, head-mesh local.
 */
function hairNubs(segs: number, radial: number, count: number) {
  const nub = lathe(
    [
      [0, -0.6],
      [1, -0.25],
      [0.96, 0.15],
      [0.74, 0.55],
      [0.42, 0.86],
      [0, 1],
    ],
    segs,
    radial,
  );
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const nrm = new Vector3();
  const scl = new Vector3();
  const dir = new Vector3();
  const up = new Vector3(0, 1, 0);
  const fw = new Vector3();
  const place = (az: number, v: number, k: number, fringe: boolean) => {
    hairSurface(az, v, pos, nrm);
    if (fringe) {
      // fringe locks: forward and a little down over the forehead
      dir.set(Math.sin(az) * 0.3, -0.22, 1);
    } else {
      // swept forward along the surface, lifted off it: short locks pushed up and forward
      fw.set(Math.sin(az) * 0.15, 0.25, 1);
      fw.addScaledVector(nrm, -fw.dot(nrm)).normalize();
      const lift = 0.42 + hash(k + 300) * 0.35;
      dir.copy(fw).multiplyScalar(Math.cos(lift)).addScaledVector(nrm, Math.sin(lift));
    }
    dir.x += (hash(k + 100) - 0.5) * 0.3;
    dir.y += (hash(k + 150) - 0.5) * 0.15;
    dir.normalize();
    q.setFromUnitVectors(up, dir);
    const base = fringe ? 0.02 : 0.02 + hash(k + 200) * 0.008;
    const len = fringe ? 0.028 + hash(k + 250) * 0.008 : 0.034 + hash(k + 250) * 0.016;
    scl.set(base, len, base * 0.7);
    pos.addScaledVector(dir, -0.28 * len).addScaledVector(nrm, -0.004);
    parts.push(nub.clone().applyMatrix4(m.compose(pos, q, scl)));
  };
  // fringe tips along the front hairline
  const nf = Math.round(count * 0.12);
  for (let i = 0; i < nf; i++) {
    const az = -0.82 + (i / (nf - 1)) * 1.64 + (hash(i + 700) - 0.5) * 0.06;
    place(az, 0.025 + hash(i + 720) * 0.03, i + 700, true);
  }
  // the crown and front: golden-angle scatter over the top of the mass
  for (let i = 0; i < count - nf; i++) {
    const t = (i + 0.5) / (count - nf);
    const az = ((i * 2.39996) % (Math.PI * 2)) - Math.PI;
    const a = Math.abs(az);
    const v = 0.14 + Math.sqrt(t) * 0.8;
    // locks only on the front half (they make the up-and-forward silhouette); the crown and back
    // carry their texture in the sculpted grooves, so from behind it reads as a crop, not scales
    if (a > 1.45 || (a > 1.0 && v < 0.5)) continue;
    place(az, v, i + 1, false);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  nub.dispose();
  return merged;
}

function heartGeometry(s: number, curveSegs: number) {
  const sh = new Shape();
  sh.moveTo(0, -0.9 * s);
  sh.bezierCurveTo(-0.15 * s, -0.55 * s, -1.0 * s, -0.2 * s, -1.0 * s, 0.3 * s);
  sh.bezierCurveTo(-1.0 * s, 0.85 * s, -0.25 * s, 1.0 * s, 0, 0.5 * s);
  sh.bezierCurveTo(0.25 * s, 1.0 * s, 1.0 * s, 0.85 * s, 1.0 * s, 0.3 * s);
  sh.bezierCurveTo(1.0 * s, -0.2 * s, 0.15 * s, -0.55 * s, 0, -0.9 * s);
  const g = new ExtrudeGeometry(sh, {
    depth: 0.004,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.003,
    bevelSegments: 3,
    curveSegments: curveSegs,
  });
  g.center();
  return g;
}

function makeGeometry(q: Quality) {
  const hi = q === "high";
  const cap = hi ? 8 : 4;
  const rad = hi ? 20 : 12;
  const sw = hi ? 32 : 18;
  const sh = hi ? 24 : 12;
  const lseg = hi ? 28 : 16;
  const lrad = hi ? 40 : 22;
  return {
    head: lathe(HEAD_PROFILE, lseg, lrad),
    sphere: new SphereGeometry(1, sw, sh),
    sphereLo: new SphereGeometry(1, hi ? 16 : 10, hi ? 12 : 8),
    // hair: one solid shell plus blunt nubs merged into it
    hair: hairShell(hi ? 130 : 80, hi ? 28 : 16),
    hairNubs: hairNubs(hi ? 6 : 4, hi ? 8 : 6, hi ? 150 : 100),
    thigh: new CapsuleGeometry(D.thighR, D.thigh, cap, rad),
    shin: new CapsuleGeometry(D.shinR, D.shin - 0.02, cap, rad),
    upperArm: new CapsuleGeometry(D.upperArmR, D.upperArm, cap, rad),
    // tall enough that its dome clears the bare arm's top cap (else a skin patch shows on the shoulder)
    sleeve: new CapsuleGeometry(0.058, 0.07, cap, rad),
    sleeveHem: new TorusGeometry(0.055, 0.009, hi ? 8 : 5, rad),
    forearm: new CapsuleGeometry(D.forearmR, D.forearm, cap, rad),
    thumb: new CapsuleGeometry(0.019, 0.03, cap, hi ? 10 : 7),
    pantCuff: new TorusGeometry(D.shinR + 0.003, 0.013, hi ? 8 : 5, rad),
    // pelvis / pants seat
    pelvis: lathe(
      [
        [0, -0.135],
        [0.1, -0.128],
        [0.155, -0.1],
        [0.17, -0.04],
        [0.168, 0.04],
        [0.16, 0.075],
        [0, 0.08],
      ],
      lseg,
      lrad,
    ),
    // pullover hem (on the spine)
    hem: lathe(
      [
        [0, -0.1],
        [0.176, -0.098],
        [0.184, -0.07],
        [0.182, 0.0],
        [0.178, 0.08],
        [0.172, 0.12],
        [0, 0.125],
      ],
      lseg,
      lrad,
    ),
    // pullover chest + shoulders (on the chest)
    chest: lathe(
      [
        [0, -0.09],
        [0.168, -0.088],
        [0.178, -0.02],
        [0.183, 0.06],
        [0.177, 0.12],
        [0.142, 0.162],
        [0.078, 0.18],
        [0, 0.18],
      ],
      lseg,
      lrad,
    ),
    crew: new TorusGeometry(0.074, 0.013, hi ? 10 : 6, lrad),
    heart: heartGeometry(0.022, hi ? 10 : 5),
    smile: new TorusGeometry(0.036, 0.0046, hi ? 8 : 5, hi ? 24 : 12, Math.PI * 0.42),
    oRing: new TorusGeometry(0.014, 0.006, hi ? 8 : 5, hi ? 20 : 10),
    grin: new CircleGeometry(0.036, hi ? 24 : 12, Math.PI, Math.PI),
    teeth: new CircleGeometry(0.032, hi ? 18 : 9, Math.PI * 1.02, Math.PI * 0.96),
    brow: new CapsuleGeometry(0.0125, 0.052, cap, hi ? 10 : 6),
    lid: new CapsuleGeometry(0.0042, 0.03, cap, hi ? 8 : 5),
  };
}
export type KeoneGeometry = ReturnType<typeof makeGeometry>;
const geoCache: Partial<Record<Quality, KeoneGeometry>> = {};
export function getGeometry(q: Quality) {
  return (geoCache[q] ??= makeGeometry(q));
}

// ── the rig ─────────────────────────────────────────────────────────────────

export type ArmRig = {
  shoulder: Group; // clavicle / shrug, parent of the IK chain
  upper: Group;
  upperMesh: Mesh;
  fore: Group;
  foreMesh: Mesh;
  hand: Group;
  palm: Mesh;
  thumb: Mesh;
  cuff: Mesh; // the t-shirt sleeve hem (rides on the upper arm, not stretched)
};
export type LegRig = { thigh: Group; thighMesh: Mesh; shin: Group; shinMesh: Mesh; foot: Group };
export type FaceRig = {
  eyes: [Group, Group];
  brows: [Mesh, Mesh];
  smile: Mesh;
  o: Group;
  grin: Group;
};
export type KeoneRig = {
  root: Group;
  body: Group; // yaw lives on root; body carries the hop offset
  hips: Group;
  spine: Group;
  chest: Group;
  neck: Group;
  head: Group;
  arms: { l: ArmRig; r: ArmRig };
  legs: { l: LegRig; r: LegRig };
  face: FaceRig;
  shadowCasters: Mesh[];
};

function mesh(g: BufferGeometry, m: Material, parent: Group, cast: Mesh[] | null, name?: string) {
  const o = new Mesh(g, m);
  if (name) o.name = name;
  parent.add(o);
  if (cast) cast.push(o);
  return o;
}
function group(parent: Group | null, x = 0, y = 0, z = 0, name?: string) {
  const g = new Group();
  g.position.set(x, y, z);
  if (name) g.name = name;
  parent?.add(g);
  return g;
}

/** side: +1 = character's left (local +X), -1 = right */
function buildArm(chest: Group, side: 1 | -1, G: KeoneGeometry, M: KeoneMaterials, cast: Mesh[]): ArmRig {
  const shoulder = group(chest, side * D.shoulderX, D.shoulderUp, 0, side > 0 ? "shoulderL" : "shoulderR");
  const upper = group(shoulder, 0, 0, 0);
  // bare arm under a short t-shirt sleeve
  const upperMesh = mesh(G.upperArm, M.skin, upper, cast);
  upperMesh.position.y = -D.upperArm / 2;
  const sleeve = mesh(G.sleeve, M.tee, upper, cast);
  sleeve.position.y = -0.04;
  const cuff = mesh(G.sleeveHem, M.teeRib, upper, cast);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.y = -0.106;
  const fore = group(upper, 0, -D.upperArm, 0);
  const foreMesh = mesh(G.forearm, M.skin, fore, cast);
  foreMesh.position.y = -D.forearm / 2;
  const hand = group(fore, 0, -D.forearm, 0);
  // mitten: a soft bean, palm faces the body, slightly forward
  const palm = mesh(G.sphere, M.skin, hand, cast);
  palm.scale.set(0.047, 0.066, 0.056);
  palm.position.set(0, -D.handReach + 0.004, 0.004);
  const thumb = mesh(G.thumb, M.skin, hand, cast);
  thumb.position.set(-side * 0.026, -0.038, 0.034);
  thumb.rotation.set(0.5, 0, side * 0.55);
  return { shoulder, upper, upperMesh, fore, foreMesh, hand, palm, thumb, cuff };
}

function buildLeg(hips: Group, side: 1 | -1, G: KeoneGeometry, M: KeoneMaterials, cast: Mesh[]): LegRig {
  const thigh = group(hips, side * D.hipX, -D.hipDrop, 0, side > 0 ? "thighL" : "thighR");
  const thighMesh = mesh(G.thigh, M.jeans, thigh, cast);
  thighMesh.position.y = -D.thigh / 2;
  const shin = group(thigh, 0, -D.thigh, 0);
  const shinMesh = mesh(G.shin, M.jeans, shin, cast);
  shinMesh.position.y = -D.shin / 2 + 0.01;
  const pc = mesh(G.pantCuff, M.jeans, shin, cast);
  pc.rotation.x = Math.PI / 2;
  pc.position.y = -D.shin + 0.035;
  const foot = group(shin, 0, -D.shin, 0);
  // chunky dark sneaker on a light sole, toe forward (+Z)
  const upper = mesh(G.sphere, M.shoe, foot, cast);
  upper.scale.set(0.068, 0.052, 0.112);
  upper.position.set(0, -0.022, 0.036);
  const toe = mesh(G.sphere, M.shoe, foot, cast);
  toe.scale.set(0.064, 0.042, 0.06);
  toe.position.set(0, -0.034, 0.1);
  const sole = mesh(G.sphere, M.sole, foot, cast);
  sole.scale.set(0.074, 0.02, 0.13);
  sole.position.set(0, -D.ankleH + 0.02, 0.045);
  return { thigh, thighMesh, shin, shinMesh, foot };
}

function buildHead(head: Group, G: KeoneGeometry, M: KeoneMaterials, cast: Mesh[]): FaceRig {
  const c = group(head, 0, D.headCenter, 0, "headMesh");
  const skull = mesh(G.head, M.skin, c, cast);
  skull.scale.set(HEAD_WIDTH, 1, HEAD_DEPTH);

  // ears, visible below the short sides
  for (const s of [1, -1]) {
    const ear = mesh(G.sphereLo, M.skin, c, cast);
    ear.scale.set(0.024, 0.048, 0.036);
    ear.position.set(s * HEAD_WIDTH * 0.232, -0.012, -0.012);
    ear.rotation.y = s * 0.25;
    const inner = mesh(G.sphereLo, M.skinShade, c, null);
    inner.scale.set(0.012, 0.03, 0.022);
    inner.position.set(s * HEAD_WIDTH * 0.247, -0.012, -0.004);
  }

  // hair: a solid crop (close sides, thick top pushed up and forward, short fringe) with blunt nubs for texture
  const hair = mesh(G.hair, M.hair, c, cast);
  hair.name = "hair";
  const nubs = mesh(G.hairNubs, M.hair, c, cast);
  nubs.name = "hairNubs";
  // face parts, seated on the head surface (normal from the stretched ellipse)
  const onFace = (o: Group | Mesh, x: number, y: number, out = 0) => {
    o.position.set(x, y, headFrontZ(x, y) + out);
    const r = Math.max(0.05, profileRadius(y));
    o.rotation.y = Math.asin(Math.max(-1, Math.min(1, x / HEAD_WIDTH / r))) * 0.85;
    c.add(o);
  };

  // eyes: smallish, relaxed and narrow, under a heavy lid line
  const eyes: Group[] = [];
  for (const s of [1, -1]) {
    const eg = new Group();
    onFace(eg, s * 0.088, FACE.eyeY, -0.004);
    const ball = mesh(G.sphere, M.eye, eg, null);
    ball.scale.set(0.02, 0.0115, 0.008);
    const glint = mesh(G.sphereLo, M.glint, eg, null);
    glint.scale.set(0.0035, 0.0035, 0.002);
    glint.position.set(s * -0.006 + 0.004, 0.004, 0.007);
    eyes.push(eg);
    const lid = new Mesh(G.lid, M.skinShade);
    onFace(lid, s * 0.088, FACE.eyeY + 0.0125, -0.003);
    lid.rotation.z = Math.PI / 2 + s * 0.12;
  }

  // brows: straight, fairly thick, a slight angle
  const brows: Mesh[] = [];
  for (const s of [1, -1]) {
    const b = new Mesh(G.brow, M.brow);
    onFace(b, s * 0.09, FACE.browY, -0.002);
    b.rotation.z = Math.PI / 2 + s * 0.08;
    brows.push(b);
  }

  // nose: short and broad, soft rounded tip
  const nose = new Mesh(G.sphereLo, M.skin);
  nose.scale.set(0.034, 0.021, 0.024);
  onFace(nose, 0, -0.048, -0.01);
  for (const s of [1, -1]) {
    const wing = new Mesh(G.sphereLo, M.skin);
    wing.scale.set(0.014, 0.013, 0.012);
    onFace(wing, s * 0.024, -0.056, -0.006);
  }

  // faint stubble: chin and upper lip, a touch darker and rougher than the skin
  const chin = new Mesh(G.sphere, M.stubble);
  chin.scale.set(0.07, 0.034, 0.012);
  onFace(chin, 0, -0.148, -0.0105);
  chin.rotation.x = 0.35; // follow the chin's slope so only a flush patch shows
  const lip = new Mesh(G.sphere, M.stubble);
  lip.scale.set(0.034, 0.009, 0.006);
  onFace(lip, 0, -0.079, -0.0052);

  // mouths: one visible at a time. Neutral is a small closed half-smirk (one corner up).
  const smile = new Mesh(G.smile, M.mouth);
  onFace(smile, 0.004, -0.1, -0.003);
  // arc of 0.42π centred on the bottom, then tipped so his left corner lifts: a half-smirk
  smile.rotation.z = Math.PI + Math.PI * 0.29 + 0.14;
  smile.position.y += 0.03;

  const o = new Group();
  onFace(o, 0, -0.106, -0.003);
  const ring = mesh(G.oRing, M.mouth, o, null);
  ring.scale.set(1, 1.2, 0.6);
  const hole = mesh(G.sphereLo, M.mouth, o, null);
  hole.scale.set(0.013, 0.016, 0.003);
  o.visible = false;

  const grin = new Group();
  onFace(grin, 0, -0.092, -0.005);
  const gm = mesh(G.grin, M.mouth, grin, null);
  gm.scale.set(1.2, 0.9, 1);
  const teeth = mesh(G.teeth, M.teeth, grin, null);
  teeth.position.set(0, -0.003, 0.001);
  teeth.scale.set(1.15, 0.32, 1);
  grin.visible = false;

  return { eyes: [eyes[0], eyes[1]], brows: [brows[0], brows[1]], smile, o, grin };
}

export function buildKeone(q: Quality): KeoneRig {
  const G = getGeometry(q);
  const M = getMaterials();
  const cast: Mesh[] = [];

  const root = group(null, 0, 0, 0, "keone");
  const body = group(root, 0, 0, 0, "body");
  const hips = group(body, 0, 0.62, 0, "hips");
  const pelvis = mesh(G.pelvis, M.jeans, hips, cast);
  pelvis.scale.z = 0.84;

  const spine = group(hips, 0, D.spineUp, 0, "spine");
  const hem = mesh(G.hem, M.tee, spine, cast);
  hem.scale.z = 0.84;
  hem.position.y = -0.02;

  const chest = group(spine, 0, D.chestUp, 0, "chest");
  const torso = mesh(G.chest, M.tee, chest, cast);
  torso.scale.set(1, 1, 0.84);
  // plain black crew-neck tee: a ribbed collar ring
  const crew = mesh(G.crew, M.teeRib, chest, cast);
  crew.rotation.x = Math.PI / 2 - 0.12;
  crew.position.set(0, 0.168, 0.006);
  crew.scale.set(1, 0.9, 1);
  // the Simp Cult wink: a tiny pink heart pin on the chest
  const pin = mesh(G.heart, M.pin, chest, null);
  pin.position.set(0.09, 0.07, 0.142);
  pin.rotation.set(-0.12, 0.42, 0.12);

  const neck = group(chest, 0, D.neckUp, 0, "neck");
  const neckMesh = mesh(G.sphereLo, M.skin, neck, cast);
  neckMesh.scale.set(0.075, 0.06, 0.068);
  neckMesh.position.y = 0.01;
  const head = group(neck, 0, D.headUp, 0, "head");
  const face = buildHead(head, G, M, cast);

  // a soft warm fill in front of and above the face so he reads true in the neon room,
  // plus a faint cool rim from behind (high tier). Parented to the chest so they follow the lean.
  const fill = new PointLight("#ffdcc0", 0.7, 1.2, 2);
  fill.position.set(0, 0.4, 0.6); // aimed at the face more than the hair
  fill.name = "keoneFill";
  chest.add(fill);
  if (q === "high") {
    const rim = new PointLight("#b9c4ff", 0.9, 1.2, 2);
    rim.position.set(0, 0.55, -0.5);
    rim.name = "keoneRim";
    chest.add(rim);
  }

  const arms = { l: buildArm(chest, 1, G, M, cast), r: buildArm(chest, -1, G, M, cast) };
  const legs = { l: buildLeg(hips, 1, G, M, cast), r: buildLeg(hips, -1, G, M, cast) };

  return { root, body, hips, spine, chest, neck, head, arms, legs, face, shadowCasters: cast };
}
