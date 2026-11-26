"use client";
/**
 * CasinoStage: the velvet room, the lit Simp Machine, Keone, and the intro.
 *
 * Tiers (see contract Quality):
 *   high  shadows (one spot), reflector floor, bloom + ACES + vignette + grain + SMAA, DPR ≤ 2
 *   mid   no shadows, glossy clearcoat floor, bloom + ACES only, CSS vignette, DPR ≤ 1.5
 * drei PerformanceMonitor steps high → mid at runtime (never when ?quality= is forced).
 * Rendering pauses whenever the stage is offscreen or the tab is hidden.
 */
import { PerformanceMonitor } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Keone } from "../character/Keone";
import { Cabinet3D } from "@/games/slot/ui/three/Cabinet3D";
import { casino, type CabinetHandle, type CharacterHandle, type Quality } from "../contract";
import { isQualityForced, setQuality } from "../quality";
import { Director, type DirectorApi } from "./Director";
import { createFx } from "./fx";
import { Lights } from "./Lights";
import { C, FOG_DENSITY } from "./palette";
import { Post } from "./Post";
import { Room } from "./Room";
import { Sign } from "./Sign";
import { Stool } from "./Stool";
import { LabHooks } from "./LabHooks";
import styles from "./Stage.module.css";

export type StageMode = "hero" | "play";
export type StageProps = { mode: StageMode; quality: Exclude<Quality, "low">; reducedMotion: boolean; className?: string };

/**
 * Exposure per tier. Mid has no shadows, no grain and a CSS vignette in place
 * of the post one, so it reads brighter at the same exposure.
 */
const EXPOSURE: Record<Exclude<Quality, "low">, number> = { high: 1.02, mid: 0.95 };

function Exposure({ value }: { value: number }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    get().gl.toneMappingExposure = value;
  }, [get, value]);
  return null;
}

function Ready({ onReady }: { onReady(): void }) {
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(onReady));
    return () => cancelAnimationFrame(id);
  }, [onReady]);
  return null;
}

export default function CasinoStage({ mode, quality, reducedMotion, className }: StageProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const keone = useRef<CharacterHandle>(null);
  const cabinet = useRef<CabinetHandle>(null);
  const director = useRef<DirectorApi>(null);
  const fxRef = useRef(createFx());
  // shadows are decided once: stepping down only stops the spot casting
  const [shadowMap] = useState(quality === "high");
  const [visible, setVisible] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [ready, setReady] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const mountedAt = useRef(0);

  // pause rendering offscreen / hidden tab
  useEffect(() => {
    mountedAt.current = performance.now();
    const el = wrap.current;
    if (!el) return;
    let onScreen = true;
    const update = () => setVisible(onScreen && document.visibilityState === "visible");
    const io = new IntersectionObserver(
      ([e]) => {
        onScreen = e.isIntersecting;
        update();
      },
      { threshold: 0.01 },
    );
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // the stage ↔ game bridge: a stable object that always delegates to the live handles
  useEffect(() => {
    const cab: CabinetHandle = {
      startSpin: () => cabinet.current?.startSpin(),
      stop: (grid, opts) => cabinet.current?.stop(grid, opts) ?? Promise.resolve(),
      show: (grid) => cabinet.current?.show(grid),
      highlight: (cells, tier) => cabinet.current?.highlight(cells, tier),
      pullLever: () => cabinet.current?.pullLever() ?? Promise.resolve(),
    };
    casino.register({
      async pullLever() {
        await Promise.all([keone.current?.pullLever(), cabinet.current?.pullLever()]);
      },
      react: (kind) => keone.current?.react(kind),
      cabinet: cab,
      skipIntro: () => director.current?.skip(),
    });
    return () => {
      casino.register(null);
      casino.setIntroDone(false);
    };
  }, []);

  // Escape skips the intro too
  useEffect(() => {
    if (introDone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") director.current?.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [introDone]);

  const onReady = useCallback(() => setReady(true), []);
  const skip = useCallback(() => director.current?.skip(), []);
  const onIntroDone = useCallback(() => setIntroDone(true), []);
  const onFreeze = useCallback(() => setFrozen(true), []);
  const stepDown = useCallback(() => {
    // ignore the first seconds: shader compilation always dips
    if (performance.now() - mountedAt.current < 6000) return;
    setQuality("mid");
  }, []);

  const high = quality === "high";
  const [forced] = useState(isQualityForced);

  return (
    <div ref={wrap} className={`${styles.stage} ${className ?? ""}`}>
      <Canvas
        className={styles.canvas}
        shadows={shadowMap ? "percentage" : false}
        dpr={high ? [1, 2] : [1, 1.5]}
        frameloop={visible && !frozen ? "always" : "never"}
        gl={{ antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.toneMappingExposure = EXPOSURE[quality];
        }}
        camera={{ fov: 30, near: 0.1, far: 40, position: [1.85, 1.05, 12.45] }}
        aria-hidden
      >
        <color attach="background" args={[C.ink]} />
        <fogExp2 attach="fog" args={[C.ink, FOG_DENSITY]} />
        {high && !forced && <PerformanceMonitor onDecline={stepDown} onFallback={stepDown} flipflops={3} />}
        <Suspense fallback={null}>
          <Lights fxRef={fxRef} shadows={high} />
          <Room quality={quality} />
          <Sign fxRef={fxRef} idleFlicker={!reducedMotion} />
          <Stool shadows={high} />
          <Cabinet3D ref={cabinet} quality={quality} />
          <Keone ref={keone} quality={quality} />
          <Director
            mode={mode}
            reducedMotion={reducedMotion}
            fxRef={fxRef}
            keoneRef={keone}
            cabinetRef={cabinet}
            apiRef={director}
            onIntroDone={onIntroDone}
            onFreeze={onFreeze}
          />
          <Ready onReady={onReady} />
        </Suspense>
        <Exposure value={EXPOSURE[quality]} />
        <Post quality={quality} />
        {process.env.NODE_ENV !== "production" && <LabHooks freeze={onFreeze} skip={skip} keoneRef={keone} />}
      </Canvas>
      {!high && <div className={styles.vignette} aria-hidden />}
      <div className={`${styles.curtain} ${ready ? styles.curtainUp : ""}`} aria-hidden />
      {/* portalled to <body>: the page's copy and the slot HUD stack above the stage's own context */}
      {ready &&
        !introDone &&
        visible &&
        createPortal(
          <button type="button" className={styles.skip} data-mode={mode} onClick={skip}>
            skip intro<kbd>esc</kbd>
          </button>,
          document.body,
        )}
    </div>
  );
}
