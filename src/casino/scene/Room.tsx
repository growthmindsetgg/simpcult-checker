"use client";
/**
 * The private salon: lacquered floor, velvet walls and curtain, brass trim,
 * banquette, bar, practical lamps and a row of unlit machines receding into
 * fog. Static geometry only; the lit hero machine is the slot builder's
 * Cabinet3D at the origin.
 *
 * Room box: x −4.8 … 5.8, z −1.6 (behind the machine) … 13.2 (entrance), y 0 … 4.4.
 */
import { MeshReflectorMaterial } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,

  InstancedMesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type Texture,
} from "three";
import type { Quality } from "../contract";
import { C } from "./palette";
import { tuftedNormalMap } from "./textures";

export const ROOM = { x0: -4.8, x1: 5.8, z0: -1.6, z1: 13.2, h: 4.4 } as const;
const CX = (ROOM.x0 + ROOM.x1) / 2;
const CZ = (ROOM.z0 + ROOM.z1) / 2;
const W = ROOM.x1 - ROOM.x0;
const D = ROOM.z1 - ROOM.z0;

type Mats = ReturnType<typeof makeMaterials>;

function makeMaterials() {
  const velvet = new MeshPhysicalMaterial({
    color: C.velvet,
    roughness: 0.82,
    sheen: 1,
    sheenColor: new Color(C.velvetHi),
    sheenRoughness: 0.45,
  });
  const brass = new MeshStandardMaterial({ color: C.gold, metalness: 1, roughness: 0.3 });
  const brassDim = new MeshStandardMaterial({ color: C.goldLo, metalness: 1, roughness: 0.38 });
  const lacquer = new MeshStandardMaterial({ color: "#110a12", metalness: 0.35, roughness: 0.28 });
  const ceiling = new MeshStandardMaterial({ color: "#07040a", roughness: 1 });
  const glassWarm = new MeshStandardMaterial({
    color: "#2a1608",
    emissive: new Color("#ffb46a"),
    emissiveIntensity: 1.6,
    roughness: 0.6,
  });
  const screenDim = new MeshStandardMaterial({
    color: "#05030a",
    emissive: new Color("#3a1f6e"),
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0.2,
  });
  const amber = new MeshStandardMaterial({ color: "#1a0e05", emissive: new Color("#ff9a4a"), emissiveIntensity: 0.55 });
  // the doorway glow: dim enough to read as a warm corridor beyond, not a lit panel
  const beyond = new MeshStandardMaterial({ color: "#000", emissive: new Color("#9a4a2c"), emissiveIntensity: 0.12 });
  return { velvet, brass, brassDim, lacquer, ceiling, glassWarm, screenDim, beyond, amber };
}

/** a velvet material with tufting at ~0.34 m diamonds for a w × h panel */
function tufted(base: MeshPhysicalMaterial, w: number, h: number, map: Texture) {
  const m = base.clone();
  const t = map.clone();
  t.repeat.set(w / 0.34, h / 0.34);
  t.needsUpdate = true;
  m.normalMap = t;
  m.normalScale.set(1.1, 1.1);
  return m;
}

// ── floor ───────────────────────────────────────────────────────────────────

function Floor({ quality }: { quality: Exclude<Quality, "low"> }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[CX, 0, CZ]} receiveShadow>
      <planeGeometry args={[W, D]} />
      {quality === "high" ? (
        <MeshReflectorMaterial
          resolution={512}
          blur={[260, 70]}
          mixBlur={0.7}
          mixStrength={7}
          mixContrast={1}
          mirror={0}
          depthScale={0}
          color="#120a14"
          metalness={0.6}
          roughness={0.55}
        />
      ) : (
        <meshPhysicalMaterial color="#0c070f" metalness={0.4} roughness={0.32} clearcoat={1} clearcoatRoughness={0.06} />
      )}
    </mesh>
  );
}

/** brass inlay: a ring "stage" around the lit machine and a border band */
function Inlay({ m }: { m: Mats }) {
  return (
    <group position-y={0.003}>
      <mesh rotation-x={-Math.PI / 2} material={m.brass} receiveShadow>
        <ringGeometry args={[1.72, 1.76, 96]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} material={m.brassDim} receiveShadow>
        <ringGeometry args={[1.84, 1.855, 96]} />
      </mesh>
    </group>
  );
}

// ── walls ───────────────────────────────────────────────────────────────────

const RAIL = 1.05;

function Walls({ m }: { m: Mats }) {
  const tuft = useMemo(() => tuftedNormalMap(), []);
  const lower = useMemo(
    () => ({
      side: tufted(m.velvet, D, RAIL, tuft),
      back: tufted(m.velvet, W, RAIL, tuft),
    }),
    [m, tuft],
  );
  const upperH = ROOM.h - RAIL;
  return (
    <group>
      {/* left wall (x0), facing +x */}
      <mesh position={[ROOM.x0, RAIL / 2, CZ]} rotation-y={Math.PI / 2} material={lower.side}>
        <planeGeometry args={[D, RAIL]} />
      </mesh>
      <mesh position={[ROOM.x0, RAIL + upperH / 2, CZ]} rotation-y={Math.PI / 2} material={m.velvet}>
        <planeGeometry args={[D, upperH]} />
      </mesh>
      {/* right wall (x1), facing −x */}
      <mesh position={[ROOM.x1, RAIL / 2, CZ]} rotation-y={-Math.PI / 2} material={lower.side}>
        <planeGeometry args={[D, RAIL]} />
      </mesh>
      <mesh position={[ROOM.x1, RAIL + upperH / 2, CZ]} rotation-y={-Math.PI / 2} material={m.velvet}>
        <planeGeometry args={[D, upperH]} />
      </mesh>
      {/* back wall (z0), facing +z: tufted behind banquette and bar, curtain covers the middle */}
      <mesh position={[CX, RAIL / 2, ROOM.z0]} material={lower.back}>
        <planeGeometry args={[W, RAIL]} />
      </mesh>
      <mesh position={[CX, RAIL + upperH / 2, ROOM.z0]} material={m.velvet}>
        <planeGeometry args={[W, upperH]} />
      </mesh>
      {/* entrance wall (z1), facing −z */}
      <mesh position={[CX, ROOM.h / 2, ROOM.z1]} rotation-y={Math.PI} material={m.velvet}>
        <planeGeometry args={[W, ROOM.h]} />
      </mesh>
      {/* ceiling */}
      <mesh position={[CX, ROOM.h, CZ]} rotation-x={Math.PI / 2} material={m.ceiling}>
        <planeGeometry args={[W, D]} />
      </mesh>
    </group>
  );
}

/** pleated velvet curtain behind the machine; the neon sign hangs in front of it */
function Curtain({ m }: { m: Mats }) {
  const geo = useMemo(() => {
    const w = 5.6;
    const h = ROOM.h - 0.1;
    const g = new PlaneGeometry(w, h, 240, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const t = 1 - (y + h / 2) / h; // 0 top → 1 floor
      const amp = 1 + 0.5 * t;
      const z =
        amp * (0.075 * Math.sin((x * Math.PI * 2) / 0.34) + 0.028 * Math.sin((x * Math.PI * 2) / 0.137 + 1.3)) +
        0.02 * Math.sin(x * 1.7 + y * 0.6);
      p.setZ(i, z);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group position={[0, (ROOM.h - 0.1) / 2, ROOM.z0 + 0.16]}>
      <mesh geometry={geo} material={m.velvet} receiveShadow />
      {/* brass curtain rod */}
      <mesh position={[0, (ROOM.h - 0.1) / 2 - 0.02, 0.06]} rotation-z={Math.PI / 2} material={m.brass}>
        <cylinderGeometry args={[0.022, 0.022, 5.9, 12]} />
      </mesh>
    </group>
  );
}

// ── brass trim: rails, pilasters, crown (one instanced mesh) ────────────────

type Box = [x: number, y: number, z: number, sx: number, sy: number, sz: number];

function trimBoxes(): Box[] {
  const out: Box[] = [];
  const t = 0.035;
  // chair rail + crown on all four walls
  for (const y of [RAIL, ROOM.h - 0.12]) {
    const s = y === RAIL ? 0.05 : 0.09;
    out.push([ROOM.x0 + t / 2, y, CZ, t, s, D]);
    out.push([ROOM.x1 - t / 2, y, CZ, t, s, D]);
    out.push([CX, y, ROOM.z0 + t / 2, W, s, t]);
    out.push([CX, y, ROOM.z1 - t / 2, W, s, t]);
  }
  // pilasters on the side walls
  for (let z = 0.6; z < ROOM.z1 - 0.5; z += 2.0) {
    out.push([ROOM.x0 + 0.02, ROOM.h / 2, z, 0.03, ROOM.h, 0.06]);
    out.push([ROOM.x1 - 0.02, ROOM.h / 2, z + 1.0, 0.03, ROOM.h, 0.06]);
  }
  return out;
}

function Trim({ m }: { m: Mats }) {
  const ref = useRef<InstancedMesh>(null);
  const boxes = useMemo(() => trimBoxes(), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    boxes.forEach(([x, y, z, sx, sy, sz], i) => {
      o.position.set(x, y, z);
      o.scale.set(sx, sy, sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);
  return <instancedMesh ref={ref} args={[undefined, m.brass, boxes.length]} geometry={UNIT_BOX} frustumCulled={false} />;
}

const UNIT_BOX = new BoxGeometry(1, 1, 1);

// ── the unlit machines in the fog ───────────────────────────────────────────

type Slot = { x: number; z: number; ry: number };

const SLOTS: Slot[] = [
  ...[1.7, 2.6, 3.5, 5.5, 6.4, 7.3, 9.4, 10.3].map((z) => ({ x: ROOM.x0 + 0.55, z, ry: Math.PI / 2 })),
  ...[3.9, 4.8, 5.7, 8.0, 8.9, 9.8].map((z) => ({ x: ROOM.x1 - 0.55, z, ry: -Math.PI / 2 })),
];

function GhostMachines({ m }: { m: Mats }) {
  const body = useRef<InstancedMesh>(null);
  const hood = useRef<InstancedMesh>(null);
  const screen = useRef<InstancedMesh>(null);
  const edge = useRef<InstancedMesh>(null);
  const geos = useMemo(
    () => ({
      body: new BoxGeometry(0.76, 1.42, 0.66).translate(0, 0.71, 0),
      hood: new BoxGeometry(0.76, 0.5, 0.42).translate(0, 0.25, 0),
      screen: new PlaneGeometry(0.5, 0.36),
      edge: new BoxGeometry(0.018, 1.9, 0.018).translate(0, 0.95, 0),
    }),
    [],
  );
  useLayoutEffect(() => {
    const o = new Object3D();
    const c = new Object3D();
    SLOTS.forEach((s, i) => {
      o.position.set(s.x, 0, s.z);
      o.rotation.set(0, s.ry, 0);
      o.updateMatrix();
      body.current?.setMatrixAt(i, o.matrix);
      c.position.set(0, 1.42, -0.1);
      c.rotation.set(-0.32, 0, 0);
      c.updateMatrix();
      c.matrix.premultiply(o.matrix);
      hood.current?.setMatrixAt(i, c.matrix);
      c.position.set(0, 1.62, 0.04);
      c.rotation.set(-0.32, 0, 0);
      c.updateMatrix();
      c.matrix.premultiply(o.matrix);
      screen.current?.setMatrixAt(i, c.matrix);
      for (const side of [-1, 1]) {
        c.position.set(side * 0.38, 0, 0.33);
        c.rotation.set(0, 0, 0);
        c.updateMatrix();
        c.matrix.premultiply(o.matrix);
        edge.current?.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), c.matrix);
      }
    });
    for (const r of [body, hood, screen, edge]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, []);
  const n = SLOTS.length;
  return (
    <group>
      <instancedMesh ref={body} args={[geos.body, m.lacquer, n]} />
      <instancedMesh ref={hood} args={[geos.hood, m.lacquer, n]} />
      <instancedMesh ref={screen} args={[geos.screen, m.screenDim, n]} />
      <instancedMesh ref={edge} args={[geos.edge, m.brassDim, n * 2]} />
    </group>
  );
}

// ── banquette, side table and lamp (back left) ──────────────────────────────

function Banquette({ m }: { m: Mats }) {
  const tuft = useMemo(() => tuftedNormalMap(), []);
  const backMat = useMemo(() => tufted(m.velvet, 2.8, 0.75, tuft), [m, tuft]);
  return (
    <group position={[-3.15, 0, ROOM.z0 + 0.42]}>
      {/* plinth, seat, tufted back */}
      <mesh position={[0, 0.09, 0.05]} material={m.lacquer}>
        <boxGeometry args={[2.9, 0.18, 0.62]} />
      </mesh>
      <mesh position={[0, 0.3, 0.05]} material={m.velvet}>
        <boxGeometry args={[2.86, 0.24, 0.6]} />
      </mesh>
      <mesh position={[0, 0.82, -0.2]} rotation-x={-0.08} material={backMat}>
        <boxGeometry args={[2.86, 0.8, 0.16]} />
      </mesh>
      <mesh position={[0, 1.24, -0.24]} rotation-z={Math.PI / 2} material={m.brass}>
        <cylinderGeometry args={[0.015, 0.015, 2.9, 10]} />
      </mesh>
      {/* cocktail table */}
      <group position={[0.35, 0, 0.95]}>
        <mesh position={[0, 0.36, 0]} material={m.brass}>
          <cylinderGeometry args={[0.025, 0.025, 0.7, 10]} />
        </mesh>
        <mesh position={[0, 0.015, 0]} material={m.brass}>
          <cylinderGeometry args={[0.2, 0.22, 0.03, 32]} />
        </mesh>
        <mesh position={[0, 0.72, 0]} material={m.lacquer}>
          <cylinderGeometry args={[0.36, 0.36, 0.03, 40]} />
        </mesh>
        <mesh position={[0, 0.735, 0]} rotation-x={Math.PI / 2} material={m.brass}>
          <torusGeometry args={[0.36, 0.008, 6, 48]} />
        </mesh>
        <TableLamp m={m} position={[0.1, 0.735, -0.05]} />
      </group>
    </group>
  );
}

function TableLamp({ m, position }: { m: Mats; position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.12, 0]} material={m.brass}>
        <cylinderGeometry args={[0.012, 0.012, 0.24, 8]} />
      </mesh>
      <mesh position={[0, 0.01, 0]} material={m.brass}>
        <cylinderGeometry args={[0.06, 0.07, 0.02, 20]} />
      </mesh>
      <mesh position={[0, 0.29, 0]} material={m.glassWarm}>
        <cylinderGeometry args={[0.07, 0.12, 0.13, 24, 1, true]} />
      </mesh>
    </group>
  );
}

// ── wall sconces ────────────────────────────────────────────────────────────

const SCONCES: { x: number; z: number; ry: number }[] = [
  { x: ROOM.x0 + 0.04, z: 4.5, ry: Math.PI / 2 },
  { x: ROOM.x0 + 0.04, z: 8.4, ry: Math.PI / 2 },
  { x: ROOM.x1 - 0.04, z: 7.0, ry: -Math.PI / 2 },
  { x: ROOM.x1 - 0.04, z: 11.0, ry: -Math.PI / 2 },
];

function Sconces({ m }: { m: Mats }) {
  const shade = useMemo(() => new CylinderGeometry(0.05, 0.075, 0.16, 20, 1, true), []);
  return (
    <group>
      {SCONCES.map((s, i) => (
        <group key={i} position={[s.x, 2.15, s.z]} rotation-y={s.ry}>
          <mesh material={m.brass} position={[0, 0, 0.01]}>
            <boxGeometry args={[0.09, 0.3, 0.02]} />
          </mesh>
          <mesh material={m.brass} position={[0, -0.04, 0.08]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.008, 0.008, 0.14, 6]} />
          </mesh>
          <mesh geometry={shade} material={m.glassWarm} position={[0, 0.02, 0.15]} />
        </group>
      ))}
    </group>
  );
}

// ── bar (back right) ────────────────────────────────────────────────────────

function Bar({ m }: { m: Mats }) {
  const bottles = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new CylinderGeometry(0.035, 0.04, 0.3, 10).translate(0, 0.15, 0), []);
  const N = 22;
  useLayoutEffect(() => {
    const o = new Object3D();
    for (let i = 0; i < N; i++) {
      const shelf = i < 12 ? 0 : 1;
      const k = shelf === 0 ? i : i - 12;
      const x = -1.25 + k * (shelf === 0 ? 0.22 : 0.26) + (shelf ? 0.08 : 0);
      const s = 0.8 + ((i * 37) % 7) / 14;
      o.position.set(x, 1.32 + shelf * 0.55, 0);
      o.scale.set(1, s, 1);
      o.updateMatrix();
      bottles.current?.setMatrixAt(i, o.matrix);
    }
    if (bottles.current) {
      bottles.current.instanceMatrix.needsUpdate = true;
      bottles.current.computeBoundingSphere();
    }
  }, []);
  return (
    <group position={[3.95, 0, ROOM.z0]}>
      {/* back bar: shelves, bottles and an amber strip under each shelf */}
      <group position={[0, 0, 0.2]}>
        {[1.3, 1.85].map((y) => (
          <group key={y}>
            <mesh position={[0, y, 0]} material={m.brassDim}>
              <boxGeometry args={[2.9, 0.025, 0.24]} />
            </mesh>
            <mesh position={[0, y + 0.02, -0.11]} material={m.amber}>
              <boxGeometry args={[2.7, 0.01, 0.01]} />
            </mesh>
          </group>
        ))}
        <instancedMesh ref={bottles} args={[geo, m.lacquer, N]} />
      </group>
      {/* counter */}
      <group position={[0, 0, 1.25]}>
        <mesh position={[0, 0.52, 0]} material={m.lacquer}>
          <boxGeometry args={[2.9, 1.04, 0.5]} />
        </mesh>
        <mesh position={[0, 1.06, 0.02]} material={m.lacquer}>
          <boxGeometry args={[3.0, 0.05, 0.62]} />
        </mesh>
        <mesh position={[0, 1.09, 0.33]} rotation-z={Math.PI / 2} material={m.brass}>
          <cylinderGeometry args={[0.018, 0.018, 3.0, 10]} />
        </mesh>
        <mesh position={[0, 0.16, 0.36]} rotation-z={Math.PI / 2} material={m.brass}>
          <cylinderGeometry args={[0.022, 0.022, 2.9, 10]} />
        </mesh>
      </group>
    </group>
  );
}

// ── the entrance (behind the opening camera) ────────────────────────────────

function Entrance({ m }: { m: Mats }) {
  const x = 3.2;
  const z = ROOM.z1 - 0.02;
  return (
    <group position={[x, 0, z]} rotation-y={Math.PI}>
      <mesh position={[0, 1.3, 0.005]} material={m.beyond}>
        <planeGeometry args={[1.2, 2.6]} />
      </mesh>
      {/* brass frame */}
      <mesh position={[-0.64, 1.32, 0.03]} material={m.brass}>
        <boxGeometry args={[0.06, 2.7, 0.06]} />
      </mesh>
      <mesh position={[0.64, 1.32, 0.03]} material={m.brass}>
        <boxGeometry args={[0.06, 2.7, 0.06]} />
      </mesh>
      <mesh position={[0, 2.66, 0.03]} material={m.brass}>
        <boxGeometry args={[1.34, 0.07, 0.06]} />
      </mesh>
      {/* half-drawn velvet curtain */}
      <mesh position={[-0.42, 1.3, 0.06]} material={m.velvet}>
        <boxGeometry args={[0.38, 2.6, 0.06]} />
      </mesh>
      <mesh position={[0.48, 1.3, 0.06]} material={m.velvet}>
        <boxGeometry args={[0.26, 2.6, 0.06]} />
      </mesh>
    </group>
  );
}

export function Room({ quality }: { quality: Exclude<Quality, "low"> }) {
  const m = useMemo(() => makeMaterials(), []);
  return (
    <group>
      <Floor quality={quality} />
      <Inlay m={m} />
      <Walls m={m} />
      <Curtain m={m} />
      <Trim m={m} />
      <GhostMachines m={m} />
      <Banquette m={m} />
      <Sconces m={m} />
      <Bar m={m} />
      <Entrance m={m} />
    </group>
  );
}

/** the room's warm practical lamp positions (for the lights rig) */
export const LAMPS = {
  banquette: [-2.7, 1.15, ROOM.z0 + 1.3] as const,
  bar: [3.95, 2.1, ROOM.z0 + 0.6] as const,
  sconce: [ROOM.x1 - 0.35, 2.1, 7.0] as const,
  /** the left-wall sconce nearest the machine: grazes the tufted wall and the aisle as he walks in */
  sconceL: [ROOM.x0 + 0.35, 2.1, 4.5] as const,
};

