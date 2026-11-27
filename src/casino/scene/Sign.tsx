"use client";
/**
 * The SIMP MACHINE neon: Bodoni italic "simp" with a swash, tracked-out
 * "MACHINE" beneath, hung on brass rods in front of the curtain. Lettering is
 * a canvas texture (self-hosted font, no CDN), split per line into a tube
 * core (high gain, toneMapped false: the only part bright enough to bloom)
 * and a soft halo added under the bloom threshold, so the glow reads as light
 * on the air rather than a printed blur. A pink spill light makes the velvet
 * folds and the lacquer floor carry the sign.
 */
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { AdditiveBlending, type MeshBasicMaterial, type PointLight } from "three";
import { brassMaterial } from "./brass";
import type { StageFx } from "./fx";
import { C } from "./palette";
import { signTextures } from "./textures";

/** tube core gain: the tube's white-hot centre lands ~3x over the bloom threshold */
export const SIGN_CORE_GAIN = 3.4;
/** halo gain: kept under the bloom threshold, it lights the air without blooming */
const HALO_GAIN = 1.1;
const OFF = 0.035;

export const SIGN_POS = [0, 3.12, -1.12] as const;

export function Sign({ fxRef, idleFlicker }: { fxRef: RefObject<StageFx>; idleFlicker: boolean }) {
  const tex = useMemo(() => signTextures(), []);
  const brass = useMemo(() => ({ rail: brassMaterial(0.18), rod: brassMaterial(0.22, 0.7) }), []);
  const word = useRef<MeshBasicMaterial>(null);
  const sub = useRef<MeshBasicMaterial>(null);
  const wordHalo = useRef<MeshBasicMaterial>(null);
  const subHalo = useRef<MeshBasicMaterial>(null);
  const spill = useRef<PointLight>(null);
  const idle = useRef({ next: 14, t: -1 });

  useFrame((state, dt) => {
    const fx = fxRef.current;
    let subLevel = fx.sub;
    if (idleFlicker && fx.sub >= 1) {
      const s = idle.current;
      const now = state.clock.elapsedTime;
      if (s.t < 0 && now > s.next) s.t = 0;
      if (s.t >= 0) {
        s.t += dt;
        // two quick drop-outs, like a tired transformer
        const t = s.t;
        if ((t > 0.05 && t < 0.11) || (t > 0.2 && t < 0.24)) subLevel = 0.15;
        if (t > 0.4) {
          s.t = -1;
          s.next = now + 16 + ((now * 7.31) % 9);
        }
      }
    }
    word.current?.color.setScalar(Math.max(OFF, fx.sign) * SIGN_CORE_GAIN);
    sub.current?.color.setScalar(Math.max(OFF, subLevel) * SIGN_CORE_GAIN * 0.9);
    wordHalo.current?.color.setScalar(fx.sign * HALO_GAIN);
    subHalo.current?.color.setScalar(subLevel * HALO_GAIN * 0.9);
    if (spill.current) spill.current.intensity = 5.5 * (fx.sign * 0.75 + subLevel * 0.25);
  });

  const ww = 2.5;
  const wh = ww / tex.aspectWord;
  const sw = 2.05;
  const sh = sw / tex.aspectSub;
  return (
    <group position={[SIGN_POS[0], SIGN_POS[1], SIGN_POS[2]]}>
      {/* halos first (additive, behind), tube cores over them */}
      <mesh position={[0, 0.16, -0.004]} renderOrder={1}>
        <planeGeometry args={[ww, wh]} />
        <meshBasicMaterial ref={wordHalo} map={tex.word.halo} transparent blending={AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh position={[0.06, -0.5, -0.004]} renderOrder={1}>
        <planeGeometry args={[sw, sh]} />
        <meshBasicMaterial ref={subHalo} map={tex.sub.halo} transparent blending={AdditiveBlending} depthWrite={false} fog={false} />
      </mesh>
      <mesh position={[0, 0.16, 0]} renderOrder={2}>
        <planeGeometry args={[ww, wh]} />
        <meshBasicMaterial ref={word} map={tex.word.core} transparent depthWrite={false} toneMapped={false} fog={false} />
      </mesh>
      <mesh position={[0.06, -0.5, 0]} renderOrder={2}>
        <planeGeometry args={[sw, sh]} />
        <meshBasicMaterial ref={sub} map={tex.sub.core} transparent depthWrite={false} toneMapped={false} fog={false} />
      </mesh>
      {/* raceway + hanging rods */}
      <mesh position={[0, -0.7, -0.03]} material={brass.rail}>
        <boxGeometry args={[2.3, 0.022, 0.03]} />
      </mesh>
      {[-0.95, 0.95].map((x) => (
        <mesh key={x} position={[x, 0.42, -0.03]} material={brass.rod}>
          <cylinderGeometry args={[0.006, 0.006, 2.25, 6]} />
        </mesh>
      ))}
      <pointLight ref={spill} position={[0, -0.25, 0.55]} color={C.neon} intensity={0} distance={7} decay={2} />
    </group>
  );
}
