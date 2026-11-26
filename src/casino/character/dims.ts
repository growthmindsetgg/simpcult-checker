/**
 * Keone's body measurements (metres). Standing total height = CHARACTER_HEIGHT.
 * Big-head vinyl-toy proportions: head + hair ≈ 1/3 of the height.
 */
import { SEAT_HEIGHT } from "../contract";

export const D = {
  ankleH: 0.075, // ankle joint above the sole
  shin: 0.25,
  thigh: 0.26,
  thighR: 0.068,
  shinR: 0.06,
  hipX: 0.088, // thigh joints either side of the pelvis
  hipDrop: 0.06, // thigh joints sit this far below the hips group
  spineUp: 0.07,
  chestUp: 0.15,
  shoulderX: 0.182,
  shoulderUp: 0.125,
  neckUp: 0.165,
  headUp: 0.035,
  headCenter: 0.245, // head mesh centre above the head joint
  upperArm: 0.2,
  forearm: 0.18,
  handReach: 0.06, // wrist → palm centre (the IK end)
  upperArmR: 0.046,
  forearmR: 0.043,
} as const;

/** thigh-joint height when standing relaxed (slight knee bend) */
export const STAND_HIP = D.ankleH + D.shin + D.thigh - 0.018;
/** hips-group height when standing */
export const STAND_HIPS_Y = STAND_HIP + D.hipDrop;
/** hips-group height when seated: the thighs rest on the seat top */
export const SEAT_HIPS_Y = SEAT_HEIGHT + D.thighR + D.hipDrop;

/**
 * Seated feet rest on the stool's brass footring. The ankle target is pinned in
 * root space (not hips-relative) so the lever scoot and the bounce can't slide
 * the soles off the ring. Stool.tsx builds the ring from these numbers.
 */
export const FOOT_SEATED = {
  /** ankle joint height above the floor */
  ankleY: SEAT_HIPS_Y - D.hipDrop - D.shin * 0.96,
  /** ankle forward of the stool centre (root-local +Z) */
  ankleZ: 0.15,
} as const;
/** the footring: its tube top sits under the soles (sole ≈ ankle − ankleH) */
export const FOOTRING = {
  tube: 0.012,
  y: FOOT_SEATED.ankleY - D.ankleH - 0.012,
  radius: 0.2,
} as const;

/**
 * Pull-lever timing (seconds from the call), so the cabinet's own lever arm can
 * be synced: the hand closes on the handle at GRIP, drives it down between
 * DOWN_START and DOWN_END, lets go at RELEASE, and the promise resolves at END.
 */
export const PULL_TIMING = { grip: 0.12, downStart: 0, downEnd: 0.34, release: 0.42, end: 0.8 } as const;
/**
 * The cabinet's lever (Cabinet3D): the ball sits LEVER_RADIUS from the pivot and
 * the arm rotates about X from LEVER_REST to LEVER_PULLED (smoothstep over the
 * first 0.34 s of its pullLever()); the hand follows that exact arc.
 */
export const LEVER_RADIUS = 0.19;
export const LEVER_REST = 0.18;
export const LEVER_PULLED = 2.6;
export const LEVER_DOWN = 0.34;
