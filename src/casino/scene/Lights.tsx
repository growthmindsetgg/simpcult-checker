"use client";
/**
 * Lighting per the art direction: ONE shadowed warm key spot on the machine,
 * a Monad-purple rim, warm practicals, and a code-built environment
 * (Lightformers, no HDR files) so brass has something to reflect.
 *
 * The room must read as velvet and brass, not black: a coloured ambient
 * (aubergine sky over a warm floor bounce) lifts the shadows to velvet, and a
 * soft wash grazes the curtain pleats from above so the sheen shows. Every
 * level here scales with fx.room / fx.key so the opening still starts black.
 */
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Object3D, type HemisphereLight, type PointLight, type SpotLight } from "three";
import type { StageFx } from "./fx";
import { C } from "./palette";
import { LAMPS, ROOM } from "./Room";

const KEY = 95;
const RIM = 26;
const WASH = 7;

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
    if (hemi.current) hemi.current.intensity = 0.62 * fx.room;
    if (lampA.current) lampA.current.intensity = 2.2 * fx.room;
    if (lampB.current) lampB.current.intensity = 2.8 * fx.room;
    if (sconce.current) sconce.current.intensity = 7 * fx.room;
    if (sconceL.current) sconceL.current.intensity = 5 * fx.room;
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
      {/* coloured ambient: aubergine from above, a warm brass-and-velvet bounce from the floor */}
      <hemisphereLight ref={hemi} args={["#3a1838", "#24110c", 0]} />
      {/* a soft rose wash grazing the curtain from the ceiling: the pleats catch it as velvet sheen */}
      <spotLight
        ref={wash}
        position={[0.3, ROOM.h - 0.15, ROOM.z0 + 1.5]}
        target={targets.w}
        color="#ff9fb8"
        intensity={0}
        angle={0.95}
        penumbra={1}
        decay={2}
        distance={7}
      />
      <pointLight ref={lampA} position={[...LAMPS.banquette]} color="#ffb46a" intensity={0} distance={4} decay={2} />
      {/* the sconce halfway down the aisle: catches Keone's side as he walks past */}
      <pointLight ref={sconce} position={[...LAMPS.sconce]} color="#ffb46a" intensity={0} distance={6.5} decay={2} />
      <pointLight ref={sconceL} position={[...LAMPS.sconceL]} color="#ffb46a" intensity={0} distance={5.5} decay={2} />
      <pointLight ref={lampB} position={[...LAMPS.bar]} color="#ffb46a" intensity={0} distance={4.5} decay={2} />

      <Environment resolution={128} frames={1} environmentIntensity={0.55}>
        {/* warm ceiling softbox */}
        <Lightformer form="rect" color="#ffd9b8" intensity={2.2} scale={[5, 1.4, 1]} position={[0.8, 5, 2]} rotation-x={Math.PI / 2} />
        {/* the neon, as a strip behind the machine */}
        <Lightformer form="rect" color={C.neon} intensity={3.5} scale={[3, 0.35, 1]} position={[0, 3.1, -3]} />
        {/* purple side wash */}
        <Lightformer form="rect" color={C.monad} intensity={1.4} scale={[3, 4, 1]} position={[-5, 2, 1]} rotation-y={Math.PI / 2} />
        {/* warm practical on the right */}
        <Lightformer form="circle" color="#ffb46a" intensity={1.2} scale={1.2} position={[5, 1.6, 3]} rotation-y={-Math.PI / 2} />
        {/* a cool kicker so chrome edges catch */}
        <Lightformer form="rect" color="#c9b8ff" intensity={0.6} scale={[1, 3, 1]} position={[3, 2, 5]} rotation-y={-Math.PI / 4} />
      </Environment>
    </>
  );
}
