"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Canvas } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { Cabinet3D } from "@/games/slot/ui/three/Cabinet3D";
import { casino, PLAY_CAMERA, type CabinetHandle, type Quality } from "@/casino/contract";
import { PAYLINES, SCATTER, STRIP_LEN, type SymbolId } from "@/games/slot/config";
import { evaluate, gridFromStops } from "@/games/slot/engine";
import { sfx, unlockAudio } from "@/games/slot/ui/sound";
import { ANTICIPATION_MS, anticipationReel, STAGGER_MS, tierFor, useSlotGame, type ReelsDriver, type SlotGameApi, type Tier } from "@/games/slot/ui/useSlotGame";

/**
 * Dev lab for the cabinet: a stand-in room (floor, key light, a code-built
 * environment, bloom) and buttons that drive the cabinet exactly the way the
 * game does: pull, start, stop with stagger/anticipation, highlight.
 */

type Cells = [number, number][];
const row = (r: number): Cells => [0, 1, 2].map((reel) => [reel, r] as [number, number]);
const col = (top: SymbolId, mid: SymbolId, bot: SymbolId): SymbolId[] => [top, mid, bot];

const FORCED: Record<string, { grid: SymbolId[][]; cells: Cells; tier: Tier | null; antic?: number | null }> = {
  small: { grid: [col("heart", "chog", "rose"), col("rose", "molandak", "heart"), col("heart", "moyaki", "rose")], cells: row(1), tier: "small" },
  nice: { grid: [col("heart", "chog", "rose"), col("rose", "chog", "heart"), col("heart", "chog", "rose")], cells: row(1), tier: "nice" },
  big: { grid: [col("rose", "monad", "heart"), col("heart", "monad", "rose"), col("rose", "monad", "heart")], cells: row(1), tier: "big" },
  mega: {
    grid: [col("wild", "wild", "wild"), col("wild", "wild", "wild"), col("heart", "wild", "rose")],
    cells: [...row(1), [0, 0], [1, 0], [0, 2], [1, 2], [2, 0], [2, 2]] as Cells,
    tier: "mega",
  },
  faces: {
    grid: [col("founder-2", "founder-1", "founder-3"), col("founder-3", "founder-1", "founder-2"), col("founder-2", "founder-1", "heart")],
    cells: row(1),
    tier: "nice",
  },
  anticipation: { grid: [col("heart", SCATTER, "rose"), col(SCATTER, "chog", "heart"), col("rose", SCATTER, "heart")], cells: [[0, 1], [1, 0], [2, 1]], tier: "nice", antic: 2 },
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function CabinetLab() {
  const cab = useRef<CabinetHandle>(null);
  const [quality, setQ] = useState<Exclude<Quality, "low">>("high");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("ready");
  const [view, setView] = useState<"play" | "close" | "wide">("play");
  const cam =
    view === "close"
      ? { position: [0.12, 1.36, 1.15] as const, target: [0, 1.32, 0.3] as const }
      : view === "wide"
        ? { position: [2.2, 1.6, 3.6] as const, target: [0, 1.0, 0] as const }
        : { position: PLAY_CAMERA.position, target: PLAY_CAMERA.target };

  // register as the stage would, so casino.controls has a real cabinet driver
  useEffect(() => {
    casino.register({
      pullLever: () => cab.current?.pullLever() ?? Promise.resolve(),
      react: () => {},
      get cabinet() {
        return cab.current as CabinetHandle;
      },
      skipIntro: () => {},
    });
    casino.setIntroDone(true);
    return () => {
      casino.register(null);
      casino.setIntroDone(false);
    };
  }, []);

  const run = async (grid: SymbolId[][], cells: Cells, tier: Tier | null, antic: number | null) => {
    const c = casino.controls;
    if (!c || busy) return;
    setBusy(true);
    unlockAudio();
    c.cabinet.highlight([], null);
    sfx.spinStart();
    sfx.lever();
    const t0 = performance.now();
    await c.pullLever();
    c.cabinet.startSpin();
    await sleep(Math.max(0, 900 - (performance.now() - t0)));
    await c.cabinet.stop(grid, { staggerMs: STAGGER_MS, anticipationReel: antic });
    sfx.stopWhir();
    if (tier) {
      c.cabinet.highlight(cells, tier);
      if (tier === "small") sfx.smallWin();
      else sfx.win(tier);
    }
    setLog(`${tier ?? "loss"}${antic !== null ? " (anticipation)" : ""}: ${grid.map((r) => r.join("/")).join("  |  ")}`);
    setBusy(false);
  };

  const random = () => {
    const stops = [0, 1, 2].map(() => Math.floor(Math.random() * STRIP_LEN));
    const grid = gridFromStops(stops);
    const out = evaluate(grid, 100);
    const cells = new Set<string>();
    for (const w of out.lineWins) PAYLINES[w.line].forEach((r, reel) => cells.add(`${reel}:${r}`));
    if (out.scatterWin > 0) grid.forEach((cl, reel) => cl.forEach((s, r) => s === SCATTER && cells.add(`${reel}:${r}`)));
    void run(
      grid,
      [...cells].map((k) => k.split(":").map(Number) as [number, number]),
      tierFor(out.totalWin, 100),
      anticipationReel(grid),
    );
  };

  // portal to <body>: the page template animates a transform, which would trap position: fixed
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted) return null;
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "#0a0610" }}>
      <Canvas
        shadows={quality === "high"}
        dpr={quality === "high" ? [1, 2] : [1, 1.5]}
        gl={{ antialias: false, toneMapping: THREE.NoToneMapping }}
      >
        <color attach="background" args={["#0a0610"]} />
        <fogExp2 attach="fog" args={["#0a0610", 0.09]} />
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={2.2} color="#ffd9b8" position={[2, 3, 3]} scale={[3, 2, 1]} target={[0, 1, 0]} />
          <Lightformer form="rect" intensity={1.6} color="#ff3fae" position={[-3, 1.5, 1]} scale={[1, 3, 1]} target={[0, 1, 0]} />
          <Lightformer form="rect" intensity={1.2} color="#6e54ff" position={[0, 2, -3]} scale={[4, 1, 1]} target={[0, 1, 0]} />
          <Lightformer form="ring" intensity={3} color="#fff1d6" position={[0, 5, 1]} scale={1.5} target={[0, 0, 0]} />
        </Environment>
        <ambientLight intensity={0.08} color="#6e54ff" />
        <spotLight
          position={[1.6, 3.6, 2.6]}
          angle={0.5}
          penumbra={0.6}
          intensity={38}
          color="#ffd2dc"
          castShadow={quality === "high"}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0004}
        />
        <directionalLight position={[-2, 2, -3]} intensity={0.6} color="#6e54ff" />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#120610" roughness={0.18} metalness={0.2} />
        </mesh>
        <Cabinet3D ref={cab} quality={quality} reducedMotion={false} />
        <PerspectiveCamera key={view} makeDefault position={[...cam.position]} fov={PLAY_CAMERA.fov} />
        <OrbitControls key={`o-${view}`} target={[...cam.target]} enableDamping />
        <EffectComposer multisampling={quality === "high" ? 4 : 0}>
          <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.9} />
          <Vignette darkness={0.55} offset={0.3} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>

      <div
        style={{
          position: "absolute",
          left: 12,
          top: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          maxWidth: 560,
          font: "12px ui-monospace, monospace",
        }}
      >
        <LabBtn onClick={random} disabled={busy}>
          spin + stop (random)
        </LabBtn>
        {Object.entries(FORCED).map(([k, v]) => (
          <LabBtn key={k} onClick={() => void run(v.grid, v.cells, v.tier, v.antic ?? null)} disabled={busy}>
            {k}
          </LabBtn>
        ))}
        <LabBtn onClick={() => cab.current?.highlight([], null)}>clear</LabBtn>
        <LabBtn onClick={() => setQ(quality === "high" ? "mid" : "high")}>quality: {quality}</LabBtn>
        <LabBtn onClick={() => void cab.current?.pullLever()}>lever only</LabBtn>
        <LabBtn onClick={() => setView(view === "play" ? "close" : view === "close" ? "wide" : "play")}>view: {view}</LabBtn>
        <HookPanel />
        <p style={{ width: "100%", color: "#f1e4cc99", marginTop: 4 }}>
          {log} · anticipation hunts {ANTICIPATION_MS}ms
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** the real game hook driving this cabinet through casino.controls (needs a session; dev only) */
function HookPanel() {
  const dom = useRef<ReelsDriver | null>(null);
  return <HookView g={useSlotGame({ domDriver: dom, stageExpected: true })} />;
}

function HookView({ g }: { g: SlotGameApi }) {
  return (
    <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "center", color: "#f6dc95" }}>
      <LabBtn onClick={() => void g.spin()} disabled={!g.canSpin || g.spinning} data-testid="hook-spin">
        real spin (game hook)
      </LabBtn>
      <span data-testid="hook-balance">{g.status === "ready" ? g.balance : g.status}</span>
      <span>
        won <span id={g.winId}>0</span>
      </span>
      <span style={{ opacity: 0.6 }}>{g.say}</span>
    </div>
  );
}

function LabBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      style={{
        padding: "6px 10px",
        border: "1px solid #7a5418",
        color: "#f6dc95",
        background: "#0a0610cc",
        borderRadius: 2,
        opacity: props.disabled ? 0.4 : 1,
      }}
    />
  );
}
