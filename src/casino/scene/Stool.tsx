"use client";
/**
 * Brass-and-velvet stool at ANCHORS.stool; seat top at SEAT_HEIGHT. A brass
 * footring sits where Keone's seated soles land (FOOTRING in character/dims).
 */
import { useMemo } from "react";
import { Color, MeshPhysicalMaterial } from "three";
import { FOOTRING } from "../character/dims";
import { ANCHORS, SEAT_HEIGHT } from "../contract";
import { brassMaterial } from "./brass";

export function Stool({ shadows }: { shadows: boolean }) {
  const m = useMemo(
    () => ({
      brass: brassMaterial(0.14),
      // the footring is scuffed where shoes rest: a touch rougher and darker than the post
      brassWorn: brassMaterial(0.24, 0.85),
      velvet: new MeshPhysicalMaterial({
        color: "#4a1238",
        roughness: 0.78,
        sheen: 1,
        sheenColor: new Color("#8a3270"),
        sheenRoughness: 0.4,
      }),
    }),
    [],
  );
  const top = SEAT_HEIGHT;
  const cushion = 0.085;
  const ringY = FOOTRING.y;
  const ringR = FOOTRING.radius;
  const spoke = ringR - 0.03;
  return (
    <group position={[ANCHORS.stool[0], 0, ANCHORS.stool[2]]}>
      <mesh position={[0, 0.012, 0]} material={m.brass} castShadow={shadows} receiveShadow={shadows}>
        <cylinderGeometry args={[0.2, 0.23, 0.024, 40]} />
      </mesh>
      <mesh position={[0, (top - cushion) / 2, 0]} material={m.brass} castShadow={shadows}>
        <cylinderGeometry args={[0.024, 0.03, top - cushion, 16]} />
      </mesh>
      {/* footring: a fat brass hoop on four spokes, a hub collar on the post */}
      <mesh position={[0, ringY, 0]} rotation-x={Math.PI / 2} material={m.brassWorn} castShadow={shadows}>
        <torusGeometry args={[ringR, FOOTRING.tube, 10, 56]} />
      </mesh>
      <mesh position={[0, ringY, 0]} material={m.brass}>
        <cylinderGeometry args={[0.036, 0.036, 0.04, 20]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = Math.PI / 4 + (i * Math.PI) / 2;
        return (
          <mesh
            key={i}
            position={[Math.sin(a) * (0.03 + spoke / 2), ringY, Math.cos(a) * (0.03 + spoke / 2)]}
            rotation={[Math.PI / 2, a, 0, "YXZ"]}
            material={m.brass}
          >
            <cylinderGeometry args={[0.0065, 0.0065, spoke, 8]} />
          </mesh>
        );
      })}
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
