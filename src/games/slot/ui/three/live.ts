"use client";

import { useSyncExternalStore } from "react";

/**
 * The 3D cabinet's own clock, as a tiny module store the DOM page can read.
 *
 * The stage registers its controls the moment it mounts, long before its
 * scene has loaded and compiled (seconds on a cold cache or a slow GPU), and
 * its intro runs on frame time clamped to 0.1 s per frame. So on a slow or
 * busy machine the intro takes longer than its nominal length in wall time.
 * The page's intro grace is therefore measured on the same kind of clock:
 * seconds of rendered frames (each frame counted at most 0.1 s), starting with
 * the cabinet's first drawn frame. A wall-clock cap still unlocks a stage
 * that stops drawing altogether (see SlotGame).
 */

/** seconds of stage time the intro may run before spins unlock without it */
export const INTRO_GRACE_STAGE_S = 16;

type State = { live: boolean; graceOver: boolean };
let state: State = { live: false, graceOver: false };
let stageSeconds = 0;
const subs = new Set<() => void>();
const set = (next: State) => {
  state = next;
  subs.forEach((s) => s());
};

/** called by the cabinet every frame with the raw frame delta */
export function tickCabinet(delta: number) {
  if (!state.live) {
    set({ ...state, live: true });
    if (process.env.NODE_ENV !== "production") (window as unknown as { __simpLiveAt?: number }).__simpLiveAt ??= performance.now();
  }
  stageSeconds += Math.min(delta, 0.1);
  if (!state.graceOver && stageSeconds >= INTRO_GRACE_STAGE_S) set({ ...state, graceOver: true });
}

/** the cabinet unmounted: its clock starts over with the next one */
export function resetCabinet() {
  stageSeconds = 0;
  if (state.live || state.graceOver) set({ live: false, graceOver: false });
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => void subs.delete(cb);
};
const SERVER: State = { live: false, graceOver: false };

export function useCabinetClock(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER,
  );
}
