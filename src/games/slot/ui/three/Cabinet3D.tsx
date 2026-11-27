"use client";
/**
 * The Simp Machine cabinet in 3D. Stands at the origin facing +Z, outer size
 * CABINET_SIZE, lever pivot at ANCHORS.lever, reel window centred on
 * ANCHORS.reels. Rendered inside the casino Stage's <Canvas>; it brings no
 * canvas, environment or post of its own.
 *
 * It is self-sufficient on purpose: the Stage passes only `ref` and
 * `quality`, and React context doesn't cross into the R3F tree, so the
 * cabinet loads its own symbol art and faces (module stores) and plays its
 * own reel sounds.
 */
import "@fontsource-variable/bodoni-moda";
import "@fontsource-variable/bodoni-moda/wght-italic.css";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { ANCHORS, CABINET_SIZE, type CabinetHandle, type Quality } from "@/casino/contract";
import { PAYLINES, type SymbolId } from "../../config";
import { useSymbolArt } from "../symbols";
import { applyFaces, useFaces } from "../faces";
import { sfx } from "../sound";
import { ANTICIPATION_MS, ATTRACT_GRID } from "../useSlotGame";
import { createAtlas, paintAtlas } from "./atlas";
import { drawBelly, drawBrassRoughness, drawSign, fontsReady } from "./textures";
import { buildCabinetEnv, capDirectSpecular, glassShadeMaterial, glassSheenMaterial } from "./materials";
import { resetCabinet, tickCabinet } from "./live";
import { ALPHA, RADIUS, REEL_GAP, REEL_W, REEL_X, ReelSystem } from "./reels";

type Tier = "small" | "nice" | "big" | "mega";
type Props = {
  ref?: Ref<CabinetHandle>;
  quality: Quality;
  /** skip coins and shake; when omitted the cabinet reads prefers-reduced-motion itself */
  reducedMotion?: boolean;
};

const [W, , D] = CABINET_SIZE;
const REEL_Y = ANCHORS.reels[1];
const DRUM_Z = 0.08; // drum axis; its face sits just behind the glass at z ≈ 0.34
const WIN_W = 0.6;
const WIN_H = 0.4;
const FRONT = 0.28; // front of the upper face plate
const GLASS_Z = 0.352;
const LINE_Z = 0.346;
const BRACKET_BACK = 0.08; // the lever bracket starts here on the cabinet's side
const LEVER_REST = 0.18; // rad, a slight forward lean
const LEVER_PULLED = 2.6; // rad: ball travels ~0.34 m down
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** linear F0 reflectance for a conductor's `color` (no sRGB round trip) */
const F0 = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

/**
 * Win juice per tier (game-feel). Small: the reel ticks and a quiet glow, no
 * hold. Medium (nice): a 50 ms hold, a few coins. Large (big/mega): a
 * 120-150 ms hold, one flash, and a zoom punch (the page scales the stage).
 * The hold freezes the drums' clock only; the stop() promise never waits on it.
 */
const JUICE: Record<Tier, { hold: number; trauma: number; coins: number; flash: number }> = {
  small: { hold: 0, trauma: 0, coins: 0, flash: 0 },
  nice: { hold: 0.05, trauma: 0.32, coins: 9, flash: 0 },
  big: { hold: 0.12, trauma: 0.72, coins: 30, flash: 0.5 },
  mega: { hold: 0.15, trauma: 1, coins: 48, flash: 0.65 },
};
/** the winning line leads; coins follow once it has mostly drawn */
const COINS_AFTER_LINE = 0.28;

const COLORS = {
  lacquer: "#3d0b26",
  lacquerDeep: "#22061a",
  gold: "#d9a845",
  neon: "#ff3fae",
  ink: "#0a0610",
};

// ── shapes ──────────────────────────────────────────────────────────────────

function roundedRect(s: THREE.Shape | THREE.Path, cx: number, cy: number, w: number, h: number, r: number) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function frameShape(ow: number, oh: number, or: number, iw: number, ih: number, ir: number, holeDy = 0) {
  const s = roundedRect(new THREE.Shape(), 0, 0, ow, oh, or) as THREE.Shape;
  // holes wind the other way
  const hole = new THREE.Path();
  const x = -iw / 2;
  const y = -ih / 2 + holeDy;
  hole.moveTo(x + ir, y);
  hole.quadraticCurveTo(x, y, x, y + ir);
  hole.lineTo(x, y + ih - ir);
  hole.quadraticCurveTo(x, y + ih, x + ir, y + ih);
  hole.lineTo(x + iw - ir, y + ih);
  hole.quadraticCurveTo(x + iw, y + ih, x + iw, y + ih - ir);
  hole.lineTo(x + iw, y + ir);
  hole.quadraticCurveTo(x + iw, y, x + iw - ir, y);
  hole.lineTo(x + ir, y);
  s.holes.push(hole);
  return s;
}

const N_TOP_BULBS = 26;
const TOPPER_BASE = 1.73;
const TOPPER_RECT = 0.13;
const TOPPER_RY = 0.175;
function archPoints(halfW: number, rect: number, ry: number, steps = 40): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [new THREE.Vector2(halfW, 0), new THREE.Vector2(halfW, rect)];
  for (let i = 1; i < steps; i++) {
    const a = (i / steps) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * halfW, rect + Math.sin(a) * ry));
  }
  pts.push(new THREE.Vector2(-halfW, rect), new THREE.Vector2(-halfW, 0));
  return pts;
}

type CoinSim = {
  p: Float32Array;
  v: Float32Array;
  r: Float32Array;
  w: Float32Array;
  life: Float32Array;
  pending: { at: number; n: number; tier?: Tier; soft?: boolean }[];
  next: number;
};
const newCoinSim = (n: number): CoinSim => ({
  p: new Float32Array(n * 3),
  v: new Float32Array(n * 3),
  r: new Float32Array(n * 3),
  w: new Float32Array(n * 3),
  life: new Float32Array(n),
  pending: [],
  next: 0,
});

// ── component ───────────────────────────────────────────────────────────────

export function Cabinet3D({ ref, quality, reducedMotion }: Props) {
  const shadows = quality === "high";
  const root = useRef<THREE.Group>(null);
  const leverArm = useRef<THREE.Group>(null);

  // symbol art + faces → one atlas texture (sharp and smeared)
  const { art: baseArt, ready } = useSymbolArt();
  const faces = useFaces();
  const art = useMemo(() => applyFaces(baseArt, faces), [baseArt, faces]);

  const gl = useThree((s) => s.gl);
  const [gfx] = useState(() => {
    const atlas = createAtlas();
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    const tex = (c: HTMLCanvasElement, premultiplied = false) => {
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.premultiplyAlpha = premultiplied;
      return t;
    };
    const map = tex(atlas.sharp, true);
    const blur = tex(atlas.blur, true);
    const signCanvas = document.createElement("canvas");
    const bellyCanvas = document.createElement("canvas");
    const roughCanvas = document.createElement("canvas");
    drawSign(signCanvas);
    drawBelly(bellyCanvas);
    drawBrassRoughness(roughCanvas);
    const sign = tex(signCanvas);
    const belly = tex(bellyCanvas);
    const rough = new THREE.CanvasTexture(roughCanvas);
    rough.colorSpace = THREE.NoColorSpace;
    rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
    // extrude UVs are in metres and primitives' are 0..1 per face: ~14 tiles keeps the streaks millimetre-fine on both
    rough.repeat.set(14, 14);
    rough.anisotropy = aniso;
    const env = buildCabinetEnv(gl);
    const reels = new ReelSystem(map, blur);
    reels.show(ATTRACT_GRID);
    return { atlas, map, blur, sign, signCanvas, belly, bellyCanvas, rough, env, reels };
  });
  const { reels } = gfx;
  /** how many atlas cells fell back to the drawn name tile on the last paint (-1: not painted yet) */
  const fallbackCount = useRef(-1);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // paintAtlas always resolves with every cell painted (art, its fallback source, or the name tile)
    const upload = () => {
      if (!alive) return;
      gfx.map.needsUpdate = true;
      gfx.blur.needsUpdate = true;
    };
    void paintAtlas(gfx.atlas, art, () => {
      // art that arrived after its timeout replaced its name tile
      fallbackCount.current = Math.max(0, fallbackCount.current - 1);
      upload();
    }).then((fallbacks) => {
      if (!alive) return;
      fallbackCount.current = fallbacks;
      gfx.map.needsUpdate = true;
      gfx.blur.needsUpdate = true;
    });
    return () => {
      alive = false;
    };
  }, [art, ready, gfx]);

  useEffect(() => {
    let alive = true;
    void fontsReady().then(() => {
      if (!alive) return;
      drawSign(gfx.signCanvas);
      drawBelly(gfx.bellyCanvas);
      gfx.sign.needsUpdate = true;
      gfx.belly.needsUpdate = true;
    });
    return () => {
      alive = false;
    };
  }, [gfx]);

  useEffect(
    () => () => {
      reels.dispose();
      gfx.map.dispose();
      gfx.blur.dispose();
      gfx.sign.dispose();
      gfx.belly.dispose();
      gfx.rough.dispose();
      gfx.env.dispose();
      resetCabinet();
    },
    [gfx, reels],
  );

  // dev-only readback for the play tests: what the drums show, and the meshes worth toggling
  const glassRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __simpCabinet?: unknown };
    w.__simpCabinet = {
      grid: () => reels.visibleGrid(),
      busy: () => reels.busy,
      glass: () => glassRef.current,
      fallbacks: () => fallbackCount.current,
    };
    return () => {
      delete w.__simpCabinet;
    };
  }, [reels]);

  const reduced = useRef(false);
  useEffect(() => {
    reduced.current = reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, [reducedMotion]);

  // ── materials ─────────────────────────────────────────────────────────────
  // conductors: metalness 1, measured F0 in `color`, the cabinet's own card studio bound as envMap
  const mats = useMemo(() => {
    const env = gfx.env;
    const lacquer = capDirectSpecular(
      new THREE.MeshPhysicalMaterial({
        color: COLORS.lacquer,
        roughness: 0.42,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        envMap: env,
        envMapIntensity: 0.7,
      }),
    );
    const lacquerDeep = capDirectSpecular(
      new THREE.MeshPhysicalMaterial({
        color: COLORS.lacquerDeep,
        roughness: 0.5,
        clearcoat: 0.85,
        clearcoatRoughness: 0.12,
        envMap: env,
        envMapIntensity: 0.55,
      }),
    );
    // brass: F0 0.89/0.72/0.36 nudged toward the palette's gold; roughness 0.25-0.42 through the streak map
    const brass = capDirectSpecular(
      new THREE.MeshStandardMaterial({
        color: F0(0.89, 0.68, 0.3),
        metalness: 1,
        roughness: 0.5,
        roughnessMap: gfx.rough,
        envMap: env,
        envMapIntensity: 0.95,
      }),
    );
    // brass in the tray and the lever boss: older, darker, rougher
    const brassSoft = capDirectSpecular(
      new THREE.MeshStandardMaterial({
        color: F0(0.66, 0.48, 0.21),
        metalness: 1,
        roughness: 0.78,
        roughnessMap: gfx.rough,
        envMap: env,
        envMapIntensity: 0.8,
      }),
    );
    const dark = new THREE.MeshStandardMaterial({ color: "#0b0308", roughness: 0.95 });
    // the belly glass keeps a lit pane (it sits under printed art, not over the reels)
    const glass = new THREE.MeshPhysicalMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.08,
      roughness: 0.18,
      metalness: 0,
      envMap: env,
      envMapIntensity: 0.4,
      depthWrite: false,
    });
    const reelGlassShade = glassShadeMaterial(WIN_W / WIN_H);
    const reelGlassSheen = glassSheenMaterial();
    // the lever ball's key-light glint is capped like the brass, so it shines without blooming
    const ball = capDirectSpecular(
      new THREE.MeshPhysicalMaterial({
        color: "#a50f45",
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMap: env,
        envMapIntensity: 0.8,
      }),
    );
    const cream = new THREE.MeshStandardMaterial({ color: "#f1e4cc", roughness: 0.45 });
    const belly = new THREE.MeshStandardMaterial({
      map: gfx.belly,
      emissiveMap: gfx.belly,
      emissive: new THREE.Color("#ffffff"),
      emissiveIntensity: 0.5,
      roughness: 0.35,
    });
    // the topper neon: its white tube core lands ~2x over the stage's bloom threshold (1.1, linear
    // luminance), its painted spill well under it, so only the tube blooms
    const sign = new THREE.MeshBasicMaterial({
      map: gfx.sign,
      color: new THREE.Color(COLORS.neon).multiplyScalar(8.5),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const line = new THREE.MeshBasicMaterial({
      color: new THREE.Color("#ff6cc4").multiplyScalar(5),
      toneMapped: false,
      transparent: true,
    });
    // coins: gold F0, polished
    const coin = capDirectSpecular(
      new THREE.MeshStandardMaterial({
        color: F0(1.0, 0.71, 0.29),
        metalness: 1,
        roughness: 0.26,
        envMap: env,
        envMapIntensity: 1.15,
      }),
      1.0,
    );
    return { lacquer, lacquerDeep, brass, brassSoft, dark, glass, reelGlassShade, reelGlassSheen, ball, cream, belly, sign, line, coin };
  }, [gfx]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // ── geometry that isn't a primitive ──────────────────────────────────────
  const geo = useMemo(() => {
    const ex = (shape: THREE.Shape, depth: number, bevel = 0) =>
      new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 18,
      });
    const facePlate = ex(frameShape(0.94, 0.68, 0.02, WIN_W, WIN_H, 0.012, REEL_Y - 1.36), FRONT);
    const bezel = ex(frameShape(0.7, 0.52, 0.045, WIN_W, WIN_H, 0.012), 0.05, 0.012);
    const bellyFrame = ex(frameShape(0.74, 0.37, 0.02, 0.66, 0.31, 0.006), 0.012, 0.006);

    const arch = new THREE.Shape(archPoints(0.49, TOPPER_RECT, TOPPER_RY));
    const topper = ex(arch, 0.54, 0.012);
    const inner = new THREE.ShapeGeometry(new THREE.Shape(archPoints(0.43, TOPPER_RECT - 0.03, TOPPER_RY - 0.035)), 24);
    const rimPts = archPoints(0.455, TOPPER_RECT - 0.012, TOPPER_RY - 0.016, 48).map((p) => new THREE.Vector3(p.x, p.y, 0));
    const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, false, "centripetal"), 160, 0.009, 8, false);

    // paylines: neon tubes through the cell centres, just behind the glass
    const rowY = (row: number) => RADIUS * Math.sin((1 - row) * ALPHA);
    const lines = PAYLINES.map((rows) => {
      const pts = [
        new THREE.Vector3(-WIN_W / 2 + 0.012, rowY(rows[0]), 0),
        ...rows.map((row, reel) => new THREE.Vector3(REEL_X[reel], rowY(row), 0)),
        new THREE.Vector3(WIN_W / 2 - 0.012, rowY(rows[2]), 0),
      ];
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      return new THREE.TubeGeometry(path, 80, 0.0042, 6, false);
    });
    return { facePlate, bezel, bellyFrame, topper, inner, rim, lines };
  }, []);
  useEffect(
    () => () => {
      const { lines, ...rest } = geo;
      Object.values(rest).forEach((g) => g.dispose());
      lines.forEach((g) => g.dispose());
    },
    [geo],
  );

  // ── bulbs (instanced, warm gold) ──────────────────────────────────────────
  const bulbs = useMemo(() => {
    const pos: THREE.Vector3[] = [];
    // along the topper arch
    const arch = archPoints(0.47, TOPPER_RECT - 0.002, TOPPER_RY + 0.0, 200);
    const curve = new THREE.CatmullRomCurve3(arch.map((p) => new THREE.Vector3(p.x, p.y, 0)));
    for (let i = 0; i < N_TOP_BULBS; i++) {
      const p = curve.getPointAt(0.04 + (i / (N_TOP_BULBS - 1)) * 0.92);
      pos.push(new THREE.Vector3(p.x, TOPPER_BASE + p.y, 0.18 + 0.014));
    }
    // around the reel bezel
    const bw = 0.79;
    const bh = 0.58;
    const per = 2 * (bw + bh);
    const nWin = 32;
    for (let i = 0; i < nWin; i++) {
      let d = (i / nWin) * per;
      let x: number;
      let y: number;
      if (d < bw) [x, y] = [-bw / 2 + d, bh / 2];
      else if ((d -= bw) < bh) [x, y] = [bw / 2, bh / 2 - d];
      else if ((d -= bh) < bw) [x, y] = [bw / 2 - d, -bh / 2];
      else [x, y] = [-bw / 2, -bh / 2 + (d - bw)];
      pos.push(new THREE.Vector3(x, REEL_Y + y, FRONT + 0.006));
    }
    return pos;
  }, []);
  const bulbMesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const m = bulbMesh.current;
    if (!m) return;
    const o = new THREE.Object3D();
    bulbs.forEach((p, i) => {
      o.position.copy(p);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    m.instanceMatrix.needsUpdate = true;
  }, [bulbs]);

  // ── coins (instanced, simple ballistics) ──────────────────────────────────
  const COINS = 96;
  const coinMesh = useRef<THREE.InstancedMesh>(null);
  const coins = useRef<CoinSim | null>(null);
  const coinSim = () => (coins.current ??= newCoinSim(COINS));

  // ── animation state ──────────────────────────────────────────────────────
  const fx = useRef({
    mode: "idle" as "idle" | "spin" | Tier,
    modeAt: 0,
    /** hit-stop: the drums' clock is held until this wall-clock second */
    holdUntil: 0,
    /** screen-shake energy 0..1, decays in real time; the visible offset is trauma² */
    trauma: 0,
    shakeT: 0,
    flash: 0,
    lineOn: [] as number[],
    lineAt: 0,
    lever: { from: LEVER_REST, to: LEVER_REST, t0: 0, dur: 0, spring: false },
    born: 0,
  });
  useEffect(() => {
    fx.current.born = performance.now() / 1000;
  }, []);
  const lineMeshes = useRef<(THREE.Mesh | null)[]>([]);

  const scratch = useRef<{ color: THREE.Color; obj: THREE.Object3D } | null>(null);
  const sheenMesh = useRef<THREE.Mesh>(null);
  const signMesh = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const now = performance.now() / 1000;
    scratch.current ??= { color: new THREE.Color(), obj: new THREE.Object3D() };
    const { color, obj } = scratch.current;
    const f = fx.current;
    tickCabinet(delta);
    // hit-stop holds the drums (their settle, glow and wink) for a beat; everything else runs on
    reels.update(now < f.holdUntil ? 0 : dt);

    // bulbs: a chase whose pace says what the machine is doing
    const m = bulbMesh.current;
    if (m) {
      const pace = f.mode === "idle" ? 1.4 : f.mode === "spin" ? 9 : f.mode === "big" || f.mode === "mega" ? 16 : 11;
      const step = Math.floor(now * pace);
      // big wins alternate halves twice a second (well under the 3 flashes/s limit)
      const winFlash = (f.mode === "big" || f.mode === "mega") && Math.floor(now * 4) % 2 === 0;
      for (let i = 0; i < bulbs.length; i++) {
        const lit = winFlash ? i % 2 === 0 : (i + step) % 3 === 0;
        // the ring around the reel window stays dimmer than the arch, so its bloom never veils the symbols
        // (the arch's lit bulbs sit over the bloom threshold even at idle; the ring's stay under it)
        const peak = i < N_TOP_BULBS ? 3.4 : 1.5;
        const k = f.mode === "idle" ? (lit ? (i < N_TOP_BULBS ? 1.9 : 0.9) : 0.2) : lit ? peak : 0.16;
        color.setRGB(1.0 * k, 0.66 * k, 0.26 * k);
        m.setColorAt(i, color);
      }
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (f.mode !== "idle" && f.mode !== "spin" && now - f.modeAt > (f.mode === "mega" ? 6 : f.mode === "big" ? 4.5 : 3)) f.mode = "idle";

    // the neon sign: flickers on, then the odd stutter
    {
      const age = now - f.born;
      let k = 1;
      if (age < 1.6) k = [0.15, 1, 0.1, 0.9, 0.2, 1][Math.floor(age * 4) % 6] ?? 1;
      else if (Math.sin(now * 0.7) > 0.995) k = 0.55;
      const sm = signMesh.current?.material as THREE.MeshBasicMaterial | undefined;
      if (sm) sm.opacity = k;
    }

    // paylines draw on, one after another
    lineMeshes.current.forEach((mesh, i) => {
      if (!mesh) return;
      const order = f.lineOn.indexOf(i);
      mesh.visible = order >= 0;
      if (order < 0) return;
      // the first line leads; later ones follow on shrinking gaps so the set reads as one wave
      const t = Math.min(1, Math.max(0, (now - f.lineAt - (order * 0.085 - order * order * 0.008)) / 0.42));
      const g = mesh.geometry as THREE.TubeGeometry;
      const total = g.index ? g.index.count : 0;
      g.setDrawRange(0, Math.floor(((1 - Math.pow(1 - t, 3)) * total) / 6) * 6);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 + 0.25 * Math.sin(now * 8 + i);
    });

    // lever
    const arm = leverArm.current;
    if (arm) {
      const l = f.lever;
      const t = l.dur > 0 ? Math.min(1, (now - l.t0) / l.dur) : 1;
      let a: number;
      if (l.spring) {
        // released: swing back past rest and settle
        const e = 1 - Math.exp(-t * 6) * Math.cos(t * 11);
        a = l.from + (l.to - l.from) * e;
      } else {
        a = l.from + (l.to - l.from) * (t * t * (3 - 2 * t));
      }
      arm.rotation.x = a;
    }

    // shake: the cabinet shivers from decaying trauma on summed sines (never per-frame noise);
    // the camera stays the director's
    const g = root.current;
    if (g) {
      if (f.trauma > 0) {
        f.trauma = Math.max(0, f.trauma - 1.5 * dt);
        f.shakeT += dt * 30;
        const k = f.trauma * f.trauma;
        g.position.set(0.006 * k * Math.sin(f.shakeT * 1.7), 0.003 * k * Math.sin(f.shakeT * 2.3), 0);
        g.rotation.z = 0.0035 * k * Math.sin(f.shakeT * 1.1);
      } else if (g.position.x !== 0 || g.rotation.z !== 0) {
        g.position.set(0, 0, 0);
        g.rotation.z = 0;
      }
    }

    // the one flash on a large win: a pink wash over the glass, gone in ~0.2 s
    if (f.flash > 0) f.flash = Math.max(0, f.flash - dt * 3.2);
    const sheen = sheenMesh.current?.material as THREE.ShaderMaterial | undefined;
    if (sheen) sheen.uniforms.uFlash.value = f.flash * f.flash;

    // coins
    const cm = coinMesh.current;
    if (cm) {
      const s = coinSim();
      while (s.pending.length && s.pending[0].at <= now) {
        const { n, tier, soft } = s.pending.shift()!;
        if (tier === "big" || tier === "mega") sfx.coinShower(tier);
        for (let k = 0; k < n; k++) {
          const i = s.next++ % COINS;
          const j = i * 3;
          s.p[j] = (Math.random() - 0.5) * 0.4;
          s.p[j + 1] = REEL_Y + (Math.random() - 0.5) * 0.2;
          s.p[j + 2] = GLASS_Z + 0.02;
          // soft: the few coins of a nice win hop out and drop into the tray
          const pow = soft ? 0.45 : 1;
          s.v[j] = (Math.random() - 0.5) * 2.2 * pow;
          s.v[j + 1] = (1.2 + Math.random() * 2.2) * pow;
          s.v[j + 2] = (0.9 + Math.random() * 1.6) * pow;
          s.r[j] = Math.random() * 6;
          s.r[j + 1] = Math.random() * 6;
          s.r[j + 2] = Math.random() * 6;
          s.w[j] = (Math.random() - 0.5) * 24;
          s.w[j + 1] = (Math.random() - 0.5) * 8;
          s.w[j + 2] = (Math.random() - 0.5) * 24;
          s.life[i] = 3.2 + Math.random() * 0.8;
        }
      }
      let any = false;
      for (let i = 0; i < COINS; i++) {
        const j = i * 3;
        if (s.life[i] <= 0) {
          obj.scale.setScalar(0);
        } else {
          any = true;
          s.life[i] -= dt;
          s.v[j + 1] -= 9.8 * dt;
          s.p[j] += s.v[j] * dt;
          s.p[j + 1] += s.v[j + 1] * dt;
          s.p[j + 2] += s.v[j + 2] * dt;
          if (s.p[j + 1] < 0.003) {
            // floor: bounce, lose energy, slide to a stop
            s.p[j + 1] = 0.003;
            s.v[j + 1] = Math.abs(s.v[j + 1]) * 0.32;
            s.v[j] *= 0.6;
            s.v[j + 2] *= 0.6;
            s.w[j] *= 0.5;
            s.w[j + 2] *= 0.5;
            if (Math.abs(s.v[j + 1]) < 0.25) {
              s.v[j + 1] = 0;
              s.r[j] = Math.PI / 2;
              s.r[j + 2] = 0;
              s.w[j] = 0;
              s.w[j + 2] = 0;
            }
          }
          s.r[j] += s.w[j] * dt;
          s.r[j + 1] += s.w[j + 1] * dt;
          s.r[j + 2] += s.w[j + 2] * dt;
          obj.position.set(s.p[j], s.p[j + 1], s.p[j + 2]);
          obj.rotation.set(s.r[j], s.r[j + 1], s.r[j + 2]);
          obj.scale.setScalar(Math.min(1, s.life[i] / 0.5));
        }
        obj.updateMatrix();
        cm.setMatrixAt(i, obj.matrix);
      }
      cm.instanceMatrix.needsUpdate = true;
      cm.visible = any;
    }
  });

  // ── the handle ────────────────────────────────────────────────────────────
  useImperativeHandle(
    ref,
    (): CabinetHandle => ({
      startSpin() {
        fx.current.lineOn = [];
        fx.current.mode = "spin";
        reels.startSpin();
      },
      async stop(grid: SymbolId[][], { staggerMs, anticipationReel }) {
        const landed: Promise<void>[] = [];
        for (let i = 0; i < grid.length; i++) {
          if (i === anticipationReel) {
            reels.hunt(i, true);
            sfx.anticipation(ANTICIPATION_MS / 1000);
            await sleep(ANTICIPATION_MS);
          }
          landed.push(reels.stopReel(i, grid[i]));
          if (i < grid.length - 1) await sleep(staggerMs);
        }
        await Promise.all(landed);
        if (fx.current.mode === "spin") fx.current.mode = "idle";
      },
      show(grid) {
        if (!reels.busy) reels.show(grid);
      },
      highlight(cells, tier) {
        const f = fx.current;
        const now = performance.now() / 1000;
        reels.highlight(cells, !!tier);
        if (!tier) {
          f.lineOn = [];
          return;
        }
        // the win, choreographed: impact (hold + flash) → the winning line draws (the lead) →
        // the page's counter runs (support) → coins (decoration)
        const j = JUICE[tier];
        const calm = reduced.current;
        const hold = calm ? 0 : j.hold;
        const key = new Set(cells.map(([r, w]) => `${r}:${w}`));
        f.lineOn = PAYLINES.map((rows, i) => (rows.every((row, reel) => key.has(`${reel}:${row}`)) ? i : -1)).filter((i) => i >= 0);
        f.holdUntil = now + hold;
        f.lineAt = now + hold;
        f.mode = tier;
        f.modeAt = now;
        // reduced motion: no hold, no shake, no coins; the flash becomes a faint tint
        f.flash = calm ? j.flash * 0.35 : j.flash;
        if (calm) return;
        f.trauma = Math.min(1, f.trauma + j.trauma);
        if (j.coins > 0) {
          const cs = coinSim();
          const at = now + hold + COINS_AFTER_LINE;
          cs.pending.push({ at, n: j.coins, tier, soft: tier === "nice" });
          if (tier === "mega") cs.pending.push({ at: at + 0.65, n: 40 });
        }
      },
      pullLever() {
        // resolves when the arm bottoms out; the spring back carries on
        const f = fx.current;
        const now = performance.now() / 1000;
        const down = 0.34;
        f.lever = {
          from: leverArm.current?.rotation.x ?? LEVER_REST,
          to: LEVER_PULLED,
          t0: now,
          dur: down,
          spring: false,
        };
        return sleep(down * 1000).then(() => {
          f.lever = {
            from: LEVER_PULLED,
            to: LEVER_REST,
            t0: performance.now() / 1000,
            dur: 0.9,
            spring: true,
          };
        });
      },
    }),
    [reels],
  );

  const onLever = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    window.dispatchEvent(new Event("simp:lever"));
  };
  const hover = (on: boolean) => () => {
    document.body.style.cursor = on ? "pointer" : "";
  };

  const cast = shadows ? { castShadow: true, receiveShadow: true } : {};
  const [lx, ly, lz] = ANCHORS.lever;
  const reelSep = REEL_W / 2 + REEL_GAP / 2;

  return (
    <group ref={root} name="simp-cabinet">
      {/* plinth + brass kick plate */}
      <RoundedBox args={[W, 0.1, D]} radius={0.012} position={[0, 0.05, 0]} material={mats.lacquerDeep} {...cast} />
      <RoundedBox args={[W - 0.02, 0.022, 0.006]} radius={0.0025} smoothness={3} position={[0, 0.085, D / 2 + 0.002]} material={mats.brass} />

      {/* lower body */}
      <RoundedBox args={[0.94, 0.86, 0.72]} radius={0.02} position={[0, 0.53, -0.04]} material={mats.lacquer} {...cast} />
      {/* belly glass: printed art, backlit */}
      <mesh position={[0, 0.665, 0.321]} material={mats.belly}>
        <planeGeometry args={[0.66, 0.31]} />
      </mesh>
      <mesh geometry={geo.bellyFrame} position={[0, 0.665, 0.318]} material={mats.brass} />
      <mesh position={[0, 0.665, 0.33]} material={mats.glass}>
        <planeGeometry args={[0.66, 0.31]} />
      </mesh>

      {/* coin tray */}
      <mesh position={[0, 0.262, 0.322]} material={mats.dark}>
        <planeGeometry args={[0.4, 0.09]} />
      </mesh>
      <RoundedBox args={[0.44, 0.012, 0.075]} radius={0.004} smoothness={3} position={[0, 0.205, 0.358]} material={mats.brassSoft} />
      <RoundedBox args={[0.44, 0.072, 0.01]} radius={0.004} smoothness={3} position={[0, 0.235, 0.394]} material={mats.brass} />
      {[-1, 1].map((sx) => (
        <RoundedBox key={sx} args={[0.01, 0.072, 0.075]} radius={0.004} smoothness={3} position={[sx * 0.215, 0.235, 0.358]} material={mats.brass} />
      ))}

      {/* front corner trims */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * 0.47, 0.54, 0.32]} material={mats.brass}>
            <cylinderGeometry args={[0.009, 0.009, 0.84, 10]} />
          </mesh>
          <mesh position={[sx * 0.47, 1.36, FRONT]} material={mats.brass}>
            <cylinderGeometry args={[0.009, 0.009, 0.66, 10]} />
          </mesh>
        </group>
      ))}

      {/* deck ledge with a brass bullnose and two cream push buttons */}
      <RoundedBox args={[0.98, 0.05, 0.74]} radius={0.01} position={[0, 0.985, 0.01]} material={mats.lacquerDeep} {...cast} />
      <mesh position={[0, 0.985, 0.38]} rotation={[0, 0, Math.PI / 2]} material={mats.brass}>
        <cylinderGeometry args={[0.026, 0.026, 0.98, 20]} />
      </mesh>
      {[-0.26, -0.15].map((x) => (
        <group key={x} position={[x, 1.012, 0.25]}>
          <mesh material={mats.brass}>
            <cylinderGeometry args={[0.032, 0.034, 0.008, 24]} />
          </mesh>
          <mesh position={[0, 0.008, 0]} material={mats.cream}>
            <cylinderGeometry args={[0.024, 0.026, 0.012, 24]} />
          </mesh>
        </group>
      ))}

      {/* upper body: back box + face plate with the reel window */}
      <RoundedBox args={[0.94, 0.68, 0.38]} radius={0.015} position={[0, 1.36, -0.19]} material={mats.lacquer} {...cast} />
      <mesh geometry={geo.facePlate} position={[0, 1.36, 0]} material={mats.lacquer} {...cast} />
      {/* dark liner inside the window so the cavity never shows lacquer */}
      <mesh position={[0, REEL_Y + WIN_H / 2 - 0.001, 0.17]} rotation={[Math.PI / 2, 0, 0]} material={mats.dark}>
        <planeGeometry args={[WIN_W, 0.36]} />
      </mesh>
      <mesh position={[0, REEL_Y - WIN_H / 2 + 0.001, 0.17]} rotation={[-Math.PI / 2, 0, 0]} material={mats.dark}>
        <planeGeometry args={[WIN_W, 0.36]} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (WIN_W / 2 - 0.001), REEL_Y, 0.17]} rotation={[0, -sx * (Math.PI / 2), 0]} material={mats.dark}>
          <planeGeometry args={[0.36, WIN_H]} />
        </mesh>
      ))}
      <mesh position={[0, REEL_Y, 0.002]} material={mats.dark}>
        <planeGeometry args={[WIN_W, WIN_H]} />
      </mesh>

      {/* the reels */}
      <primitive object={reels.group} position={[0, REEL_Y, DRUM_Z]} />
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * reelSep, REEL_Y, 0.31]} material={mats.dark}>
          <boxGeometry args={[REEL_GAP * 0.8, WIN_H, 0.06]} />
        </mesh>
      ))}

      {/* paylines */}
      {geo.lines.map((g, i) => (
        <mesh
          key={i}
          ref={(m) => {
            lineMeshes.current[i] = m;
          }}
          geometry={g}
          material={mats.line}
          position={[0, REEL_Y, LINE_Z]}
          visible={false}
          renderOrder={2}
        />
      ))}

      {/* brass bezel and glass */}
      <mesh geometry={geo.bezel} position={[0, REEL_Y, FRONT + 0.008]} material={mats.brass} {...cast} />
      {/* reel glass: unlit, a dark inner-shadow layer and a faint additive reflection (and the win flash) */}
      <group ref={glassRef}>
        <mesh position={[0, REEL_Y, GLASS_Z - 0.001]} material={mats.reelGlassShade} renderOrder={3}>
          <planeGeometry args={[WIN_W, WIN_H]} />
        </mesh>
        <mesh ref={sheenMesh} position={[0, REEL_Y, GLASS_Z]} material={mats.reelGlassSheen} renderOrder={4}>
          <planeGeometry args={[WIN_W, WIN_H]} />
        </mesh>
      </group>

      {/* band + arched topper with the neon sign */}
      <RoundedBox args={[0.97, 0.024, 0.62]} radius={0.008} smoothness={3} position={[0, TOPPER_BASE - 0.012, -0.08]} material={mats.brass} />
      <mesh geometry={geo.topper} position={[0, TOPPER_BASE, -0.36]} material={mats.lacquer} {...cast} />
      <mesh geometry={geo.inner} position={[0, TOPPER_BASE, 0.193]} material={mats.dark} />
      <mesh geometry={geo.rim} position={[0, TOPPER_BASE, 0.194]} material={mats.brass} />
      <mesh ref={signMesh} position={[0, TOPPER_BASE + 0.135, 0.197]} material={mats.sign} renderOrder={4}>
        <planeGeometry args={[0.8, 0.25]} />
      </mesh>
      <pointLight position={[0, TOPPER_BASE + 0.14, 0.5]} color={COLORS.neon} intensity={0.5} distance={1.6} decay={2} />

      <instancedMesh ref={bulbMesh} args={[undefined, undefined, bulbs.length]} frustumCulled={false}>
        <sphereGeometry args={[0.0105, 10, 8]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      {/* the lever, on the player's right */}
      {/* side bracket: runs from the cabinet's side out to the pivot (ANCHORS.lever) */}
      <mesh position={[0.495, ly, (BRACKET_BACK + lz + 0.05) / 2]} material={mats.lacquerDeep}>
        <boxGeometry args={[0.05, 0.14, lz + 0.05 - BRACKET_BACK]} />
      </mesh>
      <mesh position={[0.532, ly, lz]} rotation={[0, 0, Math.PI / 2]} material={mats.brassSoft}>
        <cylinderGeometry args={[0.056, 0.06, 0.026, 28]} />
      </mesh>
      <group ref={leverArm} position={[lx, ly, lz]} rotation={[LEVER_REST, 0, 0]}>
        <mesh material={mats.brass}>
          <sphereGeometry args={[0.022, 16, 12]} />
        </mesh>
        <mesh position={[0, 0.09, 0]} material={mats.brass} onClick={onLever} onPointerOver={hover(true)} onPointerOut={hover(false)}>
          <cylinderGeometry args={[0.0095, 0.012, 0.18, 12]} />
        </mesh>
        <mesh position={[0, 0.19, 0]} material={mats.ball} onClick={onLever} onPointerOver={hover(true)} onPointerOut={hover(false)} {...cast}>
          <sphereGeometry args={[0.038, 24, 18]} />
        </mesh>
      </group>

      <instancedMesh ref={coinMesh} args={[undefined, undefined, COINS]} material={mats.coin} frustumCulled={false} visible={false}>
        <cylinderGeometry args={[0.021, 0.021, 0.0035, 18]} />
      </instancedMesh>
    </group>
  );
}
