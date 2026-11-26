"use client";
/**
 * /lab/keone: Keone on a bare floor with placeholder stool, cabinet box and a
 * lever that follows his pull, plus buttons for every CharacterHandle action.
 * Dev-only (the page 404s in production). `window.__keone` exposes the handle
 * and controller for numeric checks.
 */
import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useCallback, useEffect, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ANCHORS, CABINET_SIZE, PLAY_CAMERA, SEAT_HEIGHT, type CharacterHandle, type Vec3 } from "@/casino/contract";
import { Keone } from "@/casino/character/Keone";
import type { KeoneController } from "@/casino/character/controller";
import { LEVER_PULLED, LEVER_RADIUS, LEVER_REST } from "@/casino/character/dims";

type View = "shoulder" | "front" | "side" | "follow" | "close";
const STOOL = new Vector3(ANCHORS.stool[0], 0, ANCHORS.stool[2]);
const V = (v: Vec3) => [v[0], v[1], v[2]] as [number, number, number];

function Lever({ ctl }: { ctl: React.RefObject<KeoneController | null> }) {
  const arm = useRef<Group>(null);
  useFrame(() => {
    const c = ctl.current;
    if (!arm.current || !c) return;
    arm.current.rotation.x = LEVER_REST + Math.min(1, Math.max(0, c.p.pull)) * (LEVER_PULLED - LEVER_REST);
  });
  return (
    <group position={V(ANCHORS.lever)}>
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, 0.08, 16]} />
        <meshStandardMaterial color="#d9a845" metalness={1} roughness={0.3} />
      </mesh>
      <group ref={arm}>
        <mesh position={[0.03, LEVER_RADIUS / 2, 0]}>
          <cylinderGeometry args={[0.012, 0.012, LEVER_RADIUS, 10]} />
          <meshStandardMaterial color="#d9a845" metalness={1} roughness={0.3} />
        </mesh>
        <mesh position={[0.03, LEVER_RADIUS, 0]}>
          <sphereGeometry args={[0.035, 20, 14]} />
          <meshStandardMaterial color="#ff3fae" emissive="#ff3fae" emissiveIntensity={0.6} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

function Props() {
  const [w, h, d] = CABINET_SIZE;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshPhysicalMaterial color="#120a14" roughness={0.28} clearcoat={1} clearcoatRoughness={0.15} />
      </mesh>
      {/* cabinet placeholder (front face z = d/2) */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshPhysicalMaterial color="#2a0b1f" roughness={0.7} sheen={1} sheenColor="#4a1236" />
      </mesh>
      <mesh position={[0, ANCHORS.reels[1], d / 2 + 0.001]}>
        <planeGeometry args={[0.7, 0.42]} />
        <meshBasicMaterial color="#f1e4cc" toneMapped={false} />
      </mesh>
      {/* stool: seat top at SEAT_HEIGHT */}
      <group position={V(ANCHORS.stool)}>
        <mesh position={[0, SEAT_HEIGHT - 0.04, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.19, 0.18, 0.08, 32]} />
          <meshPhysicalMaterial color="#4a1236" roughness={0.6} sheen={1} sheenColor="#ff8fd6" />
        </mesh>
        <mesh position={[0, (SEAT_HEIGHT - 0.08) / 2, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, SEAT_HEIGHT - 0.08, 12]} />
          <meshStandardMaterial color="#d9a845" metalness={1} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.15, 0.012, 8, 32]} />
          <meshStandardMaterial color="#d9a845" metalness={1} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <cylinderGeometry args={[0.2, 0.22, 0.03, 32]} />
          <meshStandardMaterial color="#d9a845" metalness={1} roughness={0.35} />
        </mesh>
      </group>
      {ANCHORS.aisle.map((a, i) => (
        <mesh key={i} position={[a[0], 0.002, a[2]]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.08, 0.1, 24]} />
          <meshBasicMaterial color="#6e54ff" />
        </mesh>
      ))}
    </>
  );
}

function CameraRig({
  view,
  keone,
  controls,
}: {
  view: View;
  keone: React.RefObject<CharacterHandle | null>;
  controls: React.RefObject<OrbitControlsImpl | null>;
}) {
  const { camera } = useThree();
  // dev hook: lets the capture script place the camera freely (after picking a non-tracking view)
  useEffect(() => {
    window.__labCam = { camera, controls: controls.current };
  }, [camera, controls]);
  useEffect(() => {
    const c = controls.current;
    const set = (p: Vec3, t: Vec3) => {
      camera.position.set(...p);
      c?.target.set(...t);
      c?.update();
    };
    if (view === "shoulder") set(PLAY_CAMERA.position, PLAY_CAMERA.target);
    if (view === "side") set([2.7, 1.35, 1.0], [0.15, 1.0, 0.6]);
  }, [view, camera, controls]);
  // front / close / follow track the character (front & close sit in front of his face)
  useFrame(() => {
    if (view !== "follow" && view !== "front" && view !== "close") return;
    const r = keone.current?.root;
    const c = controls.current;
    if (!r || !c) return;
    const yaw = r.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    if (view === "follow") {
      c.target.set(r.position.x, 0.75, r.position.z);
      camera.position.set(r.position.x + 3.2, 1.3, r.position.z + 1.0);
    } else if (r.position.distanceTo(STOOL) < 0.05) {
      // seated he faces the cabinet: look from beyond its right side
      const close = view === "close";
      camera.position.set(close ? 1.0 : 2.1, close ? 1.45 : 1.45, close ? 0.35 : 0.1);
      c.target.set(0.02, close ? 1.3 : 1.12, 0.9);
    } else {
      const seatedish = r.position.distanceTo(STOOL) < 0.05;
      const close = view === "close";
      const dist = seatedish ? (close ? 0.42 : 0.62) : close ? 1.0 : 1.5;
      const side = seatedish ? (close ? 0.58 : 0.75) : close ? 0.35 : 0.9;
      // seated he faces the cabinet, so "front" looks from beside it
      camera.position.set(r.position.x + fx * dist - fz * side, view === "close" ? 1.45 : 1.25, r.position.z + fz * dist + fx * side);
      c.target.set(r.position.x, view === "close" ? 1.25 : 0.9, r.position.z);
    }
    c.update();
  });
  return null;
}

declare global {
  interface Window {
    __keone?: { handle: CharacterHandle | null; ctl: KeoneController | null; gsap: typeof gsap };
    __labCam?: { camera: import("three").Camera; controls: OrbitControlsImpl | null };
  }
}

export default function KeoneLabScene() {
  const keone = useRef<CharacterHandle>(null);
  const ctl = useRef<KeoneController | null>(null);
  const controls = useRef<OrbitControlsImpl>(null);
  const [view, setView] = useState<View>("front");
  const [quality, setQ] = useState<"high" | "mid">("high");
  const [speed, setSpeed] = useState(1);
  const [info, setInfo] = useState("");

  const onController = useCallback((c: KeoneController | null) => {
    ctl.current = c;
    window.__keone = {
      get handle() {
        return keone.current;
      },
      ctl: c,
      gsap,
    };
  }, []);

  useEffect(() => {
    gsap.globalTimeline.timeScale(speed);
    if (ctl.current) ctl.current.timeScale = speed;
  }, [speed]);

  useEffect(() => {
    const id = setInterval(() => {
      const c = ctl.current;
      if (!c) return;
      const d = c.debug;
      setInfo(
        `${c.state} · seat ${c.p.seat.toFixed(2)} · lever reach ${d.leverReach.toFixed(3)} stretch ${d.leverStretch.toFixed(2)} miss ${(d.leverResidual * 100).toFixed(1)}cm`,
      );
    }, 200);
    return () => clearInterval(id);
  }, []);

  const h = () => keone.current;
  const intro = async () => {
    const k = h();
    if (!k) return;
    k.snap("offstage");
    await k.walk(ANCHORS.aisle, { speed: 1.9 });
    await k.sit();
    await k.pullLever();
  };

  const btn: React.CSSProperties = {
    font: "12px/1 ui-monospace, monospace",
    padding: "7px 10px",
    background: "transparent",
    color: "#f1e4cc",
    border: "1px solid #7a5418",
    borderRadius: 2,
    cursor: "pointer",
  };
  const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        shadows={quality === "high"}
        dpr={[1, 2]}
        camera={{ position: [0.9, 1.5, 3.3], fov: 38, near: 0.05, far: 60 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#0a0610"]} />
        <fogExp2 attach="fog" args={["#0a0610", 0.06]} />
        <ambientLight intensity={0.12} color="#6e54ff" />
        <spotLight
          position={[1.2, 4.2, 3.2]}
          angle={0.55}
          penumbra={0.6}
          intensity={60}
          color="#ffd9e6"
          castShadow={quality === "high"}
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[1.5, 1.8, 4]} intensity={0.6} color="#ffe2cc" />
        <directionalLight position={[-3, 2.5, -2]} intensity={0.8} color="#6e54ff" />
        <pointLight position={[2.5, 1.0, 1.5]} intensity={1.2} color="#ff3fae" distance={6} />
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={2.2} color="#ffe6ee" position={[0, 4, 2]} scale={[4, 2, 1]} rotation-x={Math.PI / 2} />
          <Lightformer form="rect" intensity={0.8} color="#ff3fae" position={[4, 1, 1]} scale={[1, 3, 1]} rotation-y={-Math.PI / 2} />
          <Lightformer form="rect" intensity={0.6} color="#6e54ff" position={[-4, 1.5, -1]} scale={[2, 3, 1]} rotation-y={Math.PI / 2} />
          <Lightformer form="rect" intensity={1.2} color="#fff1e0" position={[0, 1.5, 5]} scale={[3, 2, 1]} />
          <Lightformer form="ring" intensity={1} color="#f6dc95" position={[0, 1, 5]} scale={1.5} />
        </Environment>
        <Props />
        <Lever ctl={ctl} />
        <Keone ref={keone} quality={quality} onController={onController} />
        <OrbitControls ref={controls} makeDefault target={[0.1, 0.85, 0.9]} />
        <CameraRig view={view} keone={keone} controls={controls} />
      </Canvas>

      <div
        data-lab-panel
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          display: "grid",
          gap: 8,
          maxWidth: 560,
          padding: 10,
          background: "rgba(10,6,16,0.82)",
          border: "1px solid #7a5418",
        }}
      >
        <div style={row}>
          <button style={btn} onClick={() => void h()?.walk(ANCHORS.aisle)}>walk aisle 1.2</button>
          <button style={btn} onClick={() => void h()?.walk(ANCHORS.aisle, { speed: 2 })}>walk aisle 2.0</button>
          <button style={btn} onClick={() => void h()?.sit()}>sit</button>
          <button style={btn} onClick={() => void h()?.pullLever()}>pull</button>
          <button style={btn} onClick={() => void intro()}>intro</button>
        </div>
        <div style={row}>
          {(["loss", "small", "nice", "big", "mega"] as const).map((k) => (
            <button key={k} style={btn} onClick={() => h()?.react(k)}>
              {k}
            </button>
          ))}
        </div>
        <div style={row}>
          {(["offstage", "standing", "seated"] as const).map((s) => (
            <button key={s} style={btn} onClick={() => h()?.snap(s)}>
              snap {s}
            </button>
          ))}
        </div>
        <div style={row}>
          {(["front", "shoulder", "side", "close", "follow"] as const).map((v) => (
            <button key={v} style={{ ...btn, borderColor: v === view ? "#ff3fae" : "#7a5418" }} onClick={() => setView(v)}>
              {v}
            </button>
          ))}
        </div>
        <div style={row}>
          {[1, 0.5, 0.25, 0.1, 0].map((s) => (
            <button key={s} style={{ ...btn, borderColor: s === speed ? "#ff3fae" : "#7a5418" }} onClick={() => setSpeed(s)}>
              {s === 0 ? "pause" : `${s}x`}
            </button>
          ))}
          {(["high", "mid"] as const).map((q) => (
            <button key={q} style={{ ...btn, borderColor: q === quality ? "#ff3fae" : "#7a5418" }} onClick={() => setQ(q)}>
              {q}
            </button>
          ))}
        </div>
        <div style={{ font: "11px/1.4 ui-monospace, monospace", color: "#d9a845" }}>{info}</div>
      </div>
    </div>
  );
}
