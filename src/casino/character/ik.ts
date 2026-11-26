import { Matrix4, Quaternion, Vector3, type Object3D } from "three";

/**
 * Analytic two-bone IK for a chain whose bones hang along their local -Y.
 *
 *   parent ── upper (joint at upper.position) ── lower (at -a on upper's Y) ── end (at -b on lower's Y)
 *
 * Writes `upper.quaternion` and `lower.quaternion` (and optionally stretches the
 * chain by moving `lower.position.y` / returning the scale for the end offset).
 * The bend plane is set by `poleWorld` (where the middle joint should point).
 * `bendSign` +1: the lower bone folds toward -Z of the upper (knee: pole in front),
 * -1: folds toward +Z (elbow: pole behind, forearm folds forward).
 *
 * No allocations: all temporaries are module scratch.
 */
const _p = new Vector3();
const _t = new Vector3();
const _d = new Vector3();
const _n = new Vector3();
const _m = new Vector3();
const _e = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _pole = new Vector3();
const _mat = new Matrix4();
const _inv = new Matrix4();
const _q = new Quaternion();
const _down = new Vector3(0, -1, 0);

export type IKResult = { stretch: number; reach: number };
const result: IKResult = { stretch: 1, reach: 0 };

/**
 * @param parent      the upper bone's parent, with an up-to-date matrixWorld
 * @param upper/lower the two bones
 * @param a/b         rest lengths (upper, lower-to-end)
 * @param targetWorld where the chain end should be (world)
 * @param poleWorld   a world-space point the middle joint should bend toward
 * @param maxStretch  allowed length multiplier when the target is out of reach
 * @param outU/outL   receive the solved local quaternions (so callers can blend)
 */
export function solveTwoBone(
  parent: Object3D,
  upper: Object3D,
  a: number,
  b: number,
  targetWorld: Vector3,
  poleWorld: Vector3,
  bendSign: 1 | -1,
  maxStretch: number,
  outU: Quaternion,
  outL: Quaternion,
): IKResult {
  _inv.copy(parent.matrixWorld).invert();
  _p.copy(upper.position);
  _t.copy(targetWorld).applyMatrix4(_inv);
  _pole.copy(poleWorld).applyMatrix4(_inv);

  _d.subVectors(_t, _p);
  let dist = _d.length();
  result.reach = dist;
  const full = a + b;
  let s = 1;
  if (dist > full * 0.999) s = Math.min(maxStretch, dist / (full * 0.999));
  const A = a * s;
  const B = b * s;
  dist = Math.min(Math.max(dist, Math.abs(A - B) + 1e-4), (A + B) * 0.9999);
  result.stretch = s;

  if (_d.lengthSq() < 1e-10) _d.set(0, -1, 0);
  _n.copy(_d).normalize();
  // pole direction, perpendicular to the reach line
  _m.subVectors(_pole, _p);
  _m.addScaledVector(_n, -_m.dot(_n));
  if (_m.lengthSq() < 1e-8) {
    _m.set(0, 0, 1).addScaledVector(_n, -_n.z);
    if (_m.lengthSq() < 1e-8) _m.set(1, 0, 0);
  }
  _m.normalize();

  const cosA = (A * A + dist * dist - B * B) / (2 * A * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _e.copy(_p).addScaledVector(_n, A * cosA).addScaledVector(_m, A * sinA);

  // upper basis: local -Y along the bone, local Z toward (knee) / away from (elbow) the pole
  _y.subVectors(_p, _e).normalize(); // +Y points back up the bone
  _z.copy(_m).multiplyScalar(bendSign);
  _z.addScaledVector(_y, -_z.dot(_y)).normalize();
  _x.crossVectors(_y, _z).normalize();
  _mat.makeBasis(_x, _y, _z);
  outU.setFromRotationMatrix(_mat);

  // lower: direction elbow→target in the upper's local frame; a pure hinge about X
  _d.subVectors(_t, _e).normalize();
  _q.copy(outU).invert();
  _d.applyQuaternion(_q);
  outL.setFromUnitVectors(_down, _d);
  return result;
}
