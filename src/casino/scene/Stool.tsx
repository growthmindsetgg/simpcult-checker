"use client";
/** Brass-and-velvet stool at ANCHORS.stool; seat top at SEAT_HEIGHT. */
import { useMemo } from "react";
import { Color, MeshPhysicalMaterial, MeshStandardMaterial } from "three";
import { ANCHORS, SEAT_HEIGHT } from "../contract";
import { C } from "./palette";

export function Stool({ shadows }: { shadows: boolean }) {
  const m = useMemo(
    () => ({
      brass: new MeshStandardMaterial({ color: C.gold, metalness: 1, roughness: 0.26 }),
      velvet: new MeshPhysicalMaterial({
        color: "#3a0d2a",
        roughness: 0.78,
        sheen: 1,
        sheenColor: new Color(C.velvetHi),
        sheenRoughness: 0.4,
      }),
    }),
    [],
  );
  const top = SEAT_HEIGHT;
  const cushion = 0.085;
  return (
    <group position={[ANCHORS.stool[0], 0, ANCHORS.stool[2]]}>
      <mesh position={[0, 0.012, 0]} material={m.brass} castShadow={shadows} receiveShadow={shadows}>
        <cylinderGeometry args={[0.2, 0.23, 0.024, 40]} />
      </mesh>
      <mesh position={[0, (top - cushion) / 2, 0]} material={m.brass} castShadow={shadows}>
        <cylinderGeometry args={[0.024, 0.03, top - cushion, 16]} />
      </mesh>
      <mesh position={[0, 0.29, 0]} rotation-x={Math.PI / 2} material={m.brass} castShadow={shadows}>
        <torusGeometry args={[0.16, 0.011, 8, 40]} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          position={[Math.cos((i * Math.PI * 2) / 3) * 0.08, 0.29, Math.sin((i * Math.PI * 2) / 3) * 0.08]}
          rotation-y={(-i * Math.PI * 2) / 3}
          rotation-z={Math.PI / 2}
          material={m.brass}
        >
          <cylinderGeometry args={[0.006, 0.006, 0.16, 6]} />
        </mesh>
      ))}
      {/* brass collar + velvet cushion with a softened crown */}
      <mesh position={[0, top - cushion - 0.006, 0]} material={m.brass} castShadow={shadows}>
        <cylinderGeometry args={[0.205, 0.19, 0.016, 40]} />
      </mesh>
      <mesh position={[0, top - cushion / 2 - 0.01, 0]} material={m.velvet} castShadow={shadows} receiveShadow={shadows}>
        <cylinderGeometry args={[0.2, 0.205, cushion - 0.02, 40]} />
      </mesh>
      <mesh position={[0, top - 0.03, 0]} scale={[1, 0.18, 1]} material={m.velvet} castShadow={shadows}>
        <sphereGeometry args={[0.2, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
    </group>
  );
}
