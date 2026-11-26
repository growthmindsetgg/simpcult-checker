/**
 * Builds Keone's rig: a hierarchy of groups with vinyl / fabric meshes hung on
 * them. Everything is primitives built in code (lathe, capsule, sphere,
 * cylinder, extruded heart). Geometries and materials are shared module
 * singletons per quality tier; only the Object3D tree is per instance.
 */
import {
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  Quaternion,
  Shape,
  SphereGeometry,
  SplineCurve,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
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

let mats: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  return {
    // warm light-tan vinyl, satin rather than glossy so it reads as skin under coloured light
    skin: vinyl("#e2b48f", { roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.4, sheen: 0.25, sheenColor: new Color("#ffdcc4") }),
    skinShade: vinyl("#c99272", { roughness: 0.55, clearcoat: 0.25 }),
    stubble: new MeshPhysicalMaterial({ color: new Color("#c7a085"), roughness: 0.85 }),
    // matte jet-black hair with a faint blue-black sheen
    hair: new MeshPhysicalMaterial({
      color: new Color("#050507"),
      roughness: 0.7,
      sheen: 0.25,
      sheenColor: new Color("#1d2a48"),
      sheenRoughness: 0.45,
      clearcoat: 0.12,
      clearcoatRoughness: 0.6,
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
/** hairline: front (above the forehead) and sides (just above the ears) */
const HAIRLINE = 0.118;
const SIDE_LINE = 0.042;
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

/**
 * Short, thick, textured crop: many small tapered spikes clustered over the
 * cap, pushed up and forward, with a short tousled fringe. Merged into one
 * geometry (one draw call), in head-mesh local space.
 */
function spikyHair(segs: number, radial: number) {
  const spike = lathe(
    [
      [0, -0.4],
      [1, -0.08],
      [0.88, 0.28],
      [0.58, 0.62],
      [0.26, 0.9],
      [0, 1],
    ],
    segs,
    radial,
  );
  const rings: { y: number; n: number; az: number; s: number; len: number }[] = [
    { y: HAIRLINE + 0.002, n: 13, az: 1.1, s: 0.03, len: 0.036 }, // fringe
    { y: 0.138, n: 19, az: Math.PI, s: 0.033, len: 0.04 },
    { y: 0.16, n: 19, az: Math.PI, s: 0.034, len: 0.042 },
    { y: 0.181, n: 17, az: Math.PI, s: 0.034, len: 0.044 },
    { y: 0.2, n: 14, az: Math.PI, s: 0.034, len: 0.045 },
    { y: 0.216, n: 10, az: Math.PI, s: 0.033, len: 0.044 },
    { y: 0.228, n: 6, az: Math.PI, s: 0.032, len: 0.042 },
    { y: 0.236, n: 2, az: Math.PI, s: 0.03, len: 0.04 },
  ];
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3();
  const dir = new Vector3();
  const up = new Vector3(0, 1, 0);
  let k = 0;
  rings.forEach((ring, ri) => {
    const full = ring.az >= Math.PI;
    for (let i = 0; i < ring.n; i++) {
      k++;
      const t = full ? i / ring.n : ring.n === 1 ? 0.5 : i / (ring.n - 1);
      let az = full ? t * Math.PI * 2 + ri * 0.37 : -ring.az + t * 2 * ring.az;
      az += (hash(k) - 0.5) * (full ? 0.22 : 0.12);
      const y = ring.y + (hash(k + 50) - 0.5) * 0.008;
      const r = profileRadius(y) - 0.003; // sunk a little: one thick mass, tips poking out
      const sx = Math.sin(az);
      const cz = Math.cos(az);
      pos.set(HEAD_WIDTH * r * sx, y, HEAD_DEPTH * r * cz);
      // rough outward normal, pushed up and toward the front; the fringe tips forward
      const fringe = ri === 0;
      dir.set(sx * (fringe ? 0.3 : 0.45), fringe ? 0.7 : 0.95 + ri * 0.05, cz * (fringe ? 0.85 : 0.3) + (fringe ? 0.25 : 0.5));
      dir.x += (hash(k + 100) - 0.5) * 0.45;
      dir.z += (hash(k + 150) - 0.5) * 0.3;
      dir.normalize();
      q.setFromUnitVectors(up, dir);
      const sz = ring.s * (0.85 + hash(k + 200) * 0.3);
      const len = ring.len * (0.75 + hash(k + 250) * 0.55);
      scl.set(sz, len, sz * 0.9);
      parts.push(spike.clone().applyMatrix4(m.compose(pos, q, scl)));
    }
  });
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  spike.dispose();
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
    // hair cap: the skull's own profile above the hairline, a few mm proud of it
    hairCap: lathe(
      [
        [profileRadius(HAIRLINE) + 0.001, HAIRLINE - 0.004],
        [profileRadius(HAIRLINE) + 0.006, HAIRLINE + 0.006],
        ...HEAD_PROFILE.filter(([, y]) => y > HAIRLINE + 0.03).map(([r, y]) => [r === 0 ? 0 : r + 0.006, y + 0.006] as [number, number]),
      ],
      lseg,
      lrad,
      false,
    ),
    // short sides and back: a close band from just above the ears up to the cap (open at the forehead)
    hairBand: lathe(
      [
        [profileRadius(SIDE_LINE) + 0.001, SIDE_LINE - 0.004],
        [profileRadius(SIDE_LINE) + 0.005, SIDE_LINE + 0.004],
        [profileRadius(0.08) + 0.006, 0.08],
        [profileRadius(HAIRLINE + 0.012) + 0.006, HAIRLINE + 0.012],
      ],
      hi ? 8 : 5,
      lrad,
      false,
      false,
      0.95,
      Math.PI * 2 - 1.9,
    ),
    spikes: spikyHair(hi ? 6 : 4, hi ? 7 : 5),
    thigh: new CapsuleGeometry(D.thighR, D.thigh, cap, rad),
    shin: new CapsuleGeometry(D.shinR, D.shin - 0.02, cap, rad),
    upperArm: new CapsuleGeometry(D.upperArmR, D.upperArm, cap, rad),
    sleeve: new CapsuleGeometry(0.058, 0.06, cap, rad),
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
  sleeve.position.y = -0.045;
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

  // hair: close sides, a cap, and a mass of short spikes pushed up and forward
  const cap = mesh(G.hairCap, M.hair, c, cast);
  cap.scale.set(HEAD_WIDTH, 1, HEAD_DEPTH);
  const band = mesh(G.hairBand, M.hair, c, cast);
  band.scale.set(HEAD_WIDTH, 1, HEAD_DEPTH);
  const spikes = mesh(G.spikes, M.hair, c, cast);
  spikes.name = "hairSpikes";
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
  const fill = new PointLight("#ffdcc0", 0.95, 1.2, 2);
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
