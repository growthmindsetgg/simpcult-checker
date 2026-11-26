"use client";
/**
 * Lighting per the art direction: ONE shadowed warm key spot on the machine,
 * a Monad-purple rim, two warm practicals, and a code-built environment
 * (Lightformers, no HDR files) so brass has something to reflect.
 */
import { Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Object3D, type HemisphereLight, type PointLight, type SpotLight } from "three";
import type { StageFx } from "./fx";
import { C } from "./palette";
import { LAMPS } from "./Room";

const KEY = 95;
const RIM = 26;

export function Lights({ fxRef, shadows }: { fxRef: RefObject<StageFx>; shadows: boolean }) {
  const key = useRef<SpotLight>(null);
  const rim = useRef<SpotLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const lampA = useRef<PointLight>(null);
  const lampB = useRef<PointLight>(null);
  const sconce = useRef<PointLight>(null);
  const targets = useMemo(() => {
    const k = new Object3D();
    k.position.set(0, 1.0, 0.45);
    const r = new Object3D();
    r.position.set(0.2, 1.3, 0.4);
    return { k, r };
  }, []);

  useFrame(() => {
    const fx = fxRef.current;
    if (key.current) key.current.intensity = KEY * fx.key;
    if (rim.current) rim.current.intensity = RIM * Math.max(fx.key, fx.room * 0.6);
    if (hemi.current) hemi.current.intensity = 0.32 * fx.room;
    if (lampA.current) lampA.current.intensity = 1.6 * fx.room;
    if (lampB.current) lampB.current.intensity = 2.2 * fx.room;
    if (sconce.current) sconce.current.intensity = 6 * fx.room;
  });

  return (
    <>
      <primitive object={targets.k} />
      <primitive object={targets.r} />
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
      <hemisphereLight ref={hemi} args={["#2b1440", C.ink, 0]} />
      <pointLight ref={lampA} position={[...LAMPS.banquette]} color="#ffb46a" intensity={0} distance={4} decay={2} />
      {/* the sconce halfway down the aisle: catches Keone's side as he walks past */}
      <pointLight ref={sconce} position={[...LAMPS.sconce]} color="#ffb46a" intensity={0} distance={6.5} decay={2} />
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
