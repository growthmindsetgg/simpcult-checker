/**
 * Room brass as a real conductor (3d-metal-material): metalness 1, brass F0
 * (0.89 / 0.72 / 0.36, linear) in `color`, low roughness, and the room's
 * environment bound to it explicitly. three ignores `envMapIntensity` when a
 * material only inherits `scene.environment` (it uses the scene's intensity
 * instead), so these are tagged and <BindRoomEnv> sets `envMap` on them once
 * the drei environment has rendered.
 *
 * Direct specular from the punctual lights is capped under the bloom
 * threshold (capDirectSpecular), so a polished rail facing the key spot
 * glints without blooming; only the neon and the bulbs bloom.
 */
import { Color, LinearSRGBColorSpace, MeshStandardMaterial } from "three";
import { capDirectSpecular } from "@/games/slot/ui/three/materials";

export const ROOM_ENV = "roomEnv";

/** tag a material so <BindRoomEnv> binds the room environment to it */
export function usesRoomEnv<M extends MeshStandardMaterial>(m: M, intensity = 1): M {
  m.userData[ROOM_ENV] = true;
  m.envMapIntensity = intensity;
  return m;
}

/** brass F0, linear; `tint` < 1 darkens it toward old, tarnished brass */
export const brassF0 = (tint = 1) => new Color().setRGB(0.89 * tint, 0.72 * tint, 0.36 * tint, LinearSRGBColorSpace);

export function brassMaterial(roughness = 0.16, tint = 1) {
  return usesRoomEnv(capDirectSpecular(new MeshStandardMaterial({ color: brassF0(tint), metalness: 1, roughness })));
}
