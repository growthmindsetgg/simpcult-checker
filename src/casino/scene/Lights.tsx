"use client";
/**
 * Lighting, "house lights up": ONE shadowed warm key spot on the machine, a
 * Monad-purple rim, amber practicals, and a code-built environment
 * (Lightformers, no HDR files) so brass has something to reflect.
 *
 * The room reads as a lit velvet salon, not a void: a lavender-over-plum
 * ambient lifts the shadows, a hot-pink wash grazes the curtain pleats, and
 * the environment carries a lavender overhead card, a Monad-purple wash, a
 * cyan kicker and one thin bright strip that draws a crisp highlight line
 * along every brass rail. Levels scale with fx.room / fx.key so the intro can
 * bring the house lights up in steps.
 */
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Object3D, type HemisphereLight, type Material, type Mesh, type MeshStandardMaterial, type PointLight, type SpotLight } from "three";
import { ROOM_ENV } from "./brass";
import type { StageFx } from "./fx";
import { C } from "./palette";
import { LAMPS, ROOM } from "./Room";

const KEY = 95;
const RIM = 40;
const WASH = 12;
const HEMI = 1.0;
/** amber practicals, about 1.5x the old warm levels */
const LAMP = { a: 3.3, b: 4.2, sconce: 10.5, sconceL: 7.5 };

/**
 * Binds the room environment to every material tagged by brass.ts, whenever
 * drei's <Environment> (re)assigns scene.environment. Cheap: it only walks
 * the scene when the texture changes.
 */
function BindRoomEnv() {
  const scene = useThree((s) => s.scene);
  const last = useRef<unknown>(null);
  useFrame(() => {
    const env = scene.environment;
    if (!env || env === last.current) return;
    last.current = env;
    const bind = (m: Material) => {
      if (!m.userData?.[ROOM_ENV]) return;
      (m as MeshStandardMaterial).envMap = env;
      m.needsUpdate = true;
    };
    scene.traverse((o) => {
      const m = (o as Mesh).material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach(bind);
      else bind(m);
    });
  });
  return null;
}

export function Lights({ fxRef, shadows }: { fxRef: RefObject<StageFx>; shadows: boolean }) {
  const key = useRef<SpotLight>(null);
  const rim = useRef<SpotLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const lampA = useRef<PointLight>(null);
  const lampB = useRef<PointLight>(null);
  const sconce = useRef<PointLight>(null);
  const wash = useRef<SpotLight>(null);
  const sconceL = useRef<PointLight>(null);
  const targets = useMemo(() => {
    const k = new Object3D();
    k.position.set(0, 1.0, 0.45);
    const r = new Object3D();
    r.position.set(0.2, 1.3, 0.4);
    const w = new Object3D();
    w.position.set(0, 1.2, ROOM.z0 + 0.2);
    return { k, r, w };
  }, []);

  useFrame(() => {
    const fx = fxRef.current;
    if (key.current) key.current.intensity = KEY * fx.key;
    if (rim.current) rim.current.intensity = RIM * Math.max(fx.key, fx.room * 0.6);
    if (hemi.current) hemi.current.intensity = HEMI * fx.room;
    if (lampA.current) lampA.current.intensity = LAMP.a * fx.room;
    if (lampB.current) lampB.current.intensity = LAMP.b * fx.room;
    if (sconce.current) sconce.current.intensity = LAMP.sconce * fx.room;
    if (sconceL.current) sconceL.current.intensity = LAMP.sconceL * fx.room;
    if (wash.current) {
      wash.current.intensity = WASH * fx.room;
      wash.current.visible = fx.room > 0.001;
    }
  });

  return (
    <>
      <primitive object={targets.k} />
      <primitive object={targets.r} />
      <primitive object={targets.w} />
      {/* the hero: warm, slightly pink, from above the player's right shoulder */}
      <spotLight
        ref={key}
        position={[1.15, 4.25, 2.6]}
        target={targets.k}
        color="#ffd3c4"
        intensity={0}
        angle={0.36}
        penumbra={0.75}
        decay={2}
        distance={12}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.025}
        shadow-camera-near={1.5}
        shadow-camera-far={8}
      />
      {/* Monad-purple rim from behind left */}
      <spotLight
        ref={rim}
        position={[-2.4, 3.3, -1.0]}
        target={targets.r}
        color={C.monad}
        intensity={0}
        angle={0.62}
        penumbra={1}
        decay={2}
        distance={9}
      />
      {/* coloured ambient: Monad violet from above, a warm velvet bounce from the floor */}
      <hemisphereLight ref={hemi} args={["#5a3f9e", "#4a2a2a", 0]} />
      {/* a hot-pink wash grazing the curtain from the ceiling: the pleats catch it as velvet sheen */}
      <spotLight
        ref={wash}
        position={[0.3, ROOM.h - 0.15, ROOM.z0 + 1.5]}
        target={targets.w}
        color={C.pinkHot}
        intensity={0}
        angle={0.95}
        penumbra={1}
        decay={2}
        distance={7}
      />
      <pointLight ref={lampA} position={[...LAMPS.banquette]} color={C.amber} intensity={0} distance={4} decay={2} />
      {/* the sconce halfway down the aisle: catches Keone's side as he walks past */}
      <pointLight ref={sconce} position={[...LAMPS.sconce]} color={C.amber} intensity={0} distance={6.5} decay={2} />
      <pointLight ref={sconceL} position={[...LAMPS.sconceL]} color={C.amber} intensity={0} distance={5.5} decay={2} />
      <pointLight ref={lampB} position={[...LAMPS.bar]} color={C.amber} intensity={0} distance={4.5} decay={2} />

      <Environment resolution={256} frames={1} environmentIntensity={0.9}>
        {/* lavender overhead softbox */}
        <Lightformer form="rect" color={C.lavender} intensity={3} scale={[5, 1.6, 1]} position={[0.8, 5, 2]} rotation-x={Math.PI / 2} />
        {/* one thin bright strip above and in front: a crisp highlight line along every brass rail and edge */}
        <Lightformer form="rect" color="#fff4e6" intensity={4} scale={[20, 0.1, 1]} position={[0, 4.2, 4]} rotation-x={Math.PI * 0.75} />
        {/* the neon, as a strip behind the machine */}
        <Lightformer form="rect" color={C.neon} intensity={3.5} scale={[3, 0.35, 1]} position={[0, 3.1, -3]} />
        {/* Monad-purple side wash */}
        <Lightformer form="rect" color={C.monad} intensity={2.2} scale={[3, 4, 1]} position={[-5, 2, 1]} rotation-y={Math.PI / 2} />
        {/* amber practical on the right */}
        <Lightformer form="circle" color={C.amber} intensity={1.6} scale={1.2} position={[5, 1.6, 3]} rotation-y={-Math.PI / 2} />
        {/* the cyan kicker: chrome and brass edges catch a cool line */}
        <Lightformer form="rect" color={C.cyan} intensity={1.0} scale={[1, 3, 1]} position={[3, 2, 5]} rotation-y={-Math.PI / 4} />
      </Environment>
      <BindRoomEnv />
    </>
  );
}
