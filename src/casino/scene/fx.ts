/**
 * Per-stage mutable levels the director animates and the scene reads in
 * useFrame. A plain object, never React state: it changes every frame.
 */
export type StageFx = {
  /** "simp" neon, 0..1 */
  sign: number;
  /** "MACHINE" neon, 0..1 */
  sub: number;
  /** the key spot on the machine, 0..1 */
  key: number;
  /** practical lamps + room fill, 0..1 */
  room: number;
};

export const createFx = (): StageFx => ({ sign: 0, sub: 0, key: 0, room: 0 });

export const FX_ON: StageFx = { sign: 1, sub: 1, key: 1, room: 1 };
