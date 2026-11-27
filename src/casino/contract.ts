/**
 * The casino contract: the one file every 3D part agrees on.
 *
 * Units: 1 world unit = 1 metre. Y is up. The Simp Machine stands at the
 * origin with its screen facing +Z; the player sits on the +Z side, facing -Z.
 *
 * Owners
 *   src/casino/scene/**      room, lights, post, camera director, Stage
 *   src/casino/character/**  the Keone caricature (CharacterHandle)
 *   src/games/slot/ui/**     the 3D cabinet (CabinetHandle) + the DOM HUD
 *
 * Nothing here imports three.js at runtime, so the DOM HUD can import it freely.
 */
import type { SymbolId } from "@/games/slot/config";

export type Vec3 = readonly [number, number, number];

// ── room layout ─────────────────────────────────────────────────────────────

export const ANCHORS = {
  /** where Keone appears: the entrance at the far end of the aisle */
  door: [3.2, 0, 11] as Vec3,
  /** the aisle runs from the door toward the machine */
  aisle: [[3.2, 0, 11], [2.2, 0, 6.5], [1.1, 0, 3.0], [0.55, 0, 1.55]] as readonly Vec3[],
  /** stool centre on the floor; seat top is SEAT_HEIGHT above it */
  stool: [0, 0, 0.95] as Vec3,
  /** the machine: footprint centre on the floor */
  machine: [0, 0, 0] as Vec3,
  /** lever pivot on the machine's right side (player's right) */
  lever: [0.56, 1.08, 0.38] as Vec3,
  /** centre of the reel window, for camera framing */
  reels: [0, 1.32, 0.36] as Vec3,
} as const;

export const SEAT_HEIGHT = 0.68;
/** cabinet outer size (w, h, d) */
export const CABINET_SIZE: Vec3 = [1.0, 2.05, 0.8];
/** Keone's standing height, head included (big-head vinyl toy proportions) */
export const CHARACTER_HEIGHT = 1.62;

// ── the intro, shot by shot (seconds) ───────────────────────────────────────

export type Shot = { id: string; at: number; dur: number; note: string };

export const INTRO_SHOTS: readonly Shot[] = [
  { id: "sign", at: 0, dur: 0.9, note: "the resting frame at half light; the SIMP MACHINE neon stutters on" },
  { id: "lights", at: 0.9, dur: 0.9, note: "the house lights come up in three steps, the key spot with them; spins unlock" },
];
/** seconds; the home hero paints a poster of the resting frame underneath, so the intro never starts from black */
export const INTRO_LENGTH = 1.8;

/**
 * Final resting camera on a 16:10 desktop (over the shoulder, a 50 mm lens, reels readable past his head).
 * The stage's director solves this frame per aspect and lens-shifts it above the HUD; this is the
 * landscape solution, for labs that want a fixed camera.
 */
export const PLAY_CAMERA = { position: [2.84, 2.45, 3.21] as Vec3, target: [0.0, 1.4, 0.45] as Vec3, fov: 23 };

// ── the character ───────────────────────────────────────────────────────────

export type CharacterState = "offstage" | "walking" | "standing" | "seated";

export interface CharacterHandle {
  /** the root group (feet at y=0); the director reads its world position for tracking shots */
  readonly root: import("three").Group | null;
  /** walk along floor points (y ignored) at about 1.2 m/s, turning to face travel; resolves on arrival */
  walk(path: readonly Vec3[], opts?: { speed?: number }): Promise<void>;
  /** step onto the stool from the current spot, ending seated at ANCHORS.stool facing -Z */
  sit(): Promise<void>;
  /** reach for ANCHORS.lever, pull down, release; resolves when the arm is back (≈0.9s) */
  pullLever(): Promise<void>;
  /** a short reaction while seated */
  react(kind: "loss" | "small" | "nice" | "big" | "mega"): void;
  /** jump straight to a state (skip / reduced motion) */
  snap(state: CharacterState): void;
  /** optional: a look to camera with a grin (seated he swivels the stool), back after `hold` seconds */
  glance?(hold?: number): void;
}

// ── the cabinet ─────────────────────────────────────────────────────────────

export interface CabinetHandle {
  /** start all three reels spinning (open-ended) */
  startSpin(): void;
  /** land on this grid (grid[reel][row], row 0 = top); resolves when the last reel settles */
  stop(grid: SymbolId[][], opts: { staggerMs: number; anticipationReel: number | null }): Promise<void>;
  /** show a grid with no spin (attract / after resize) */
  show(grid: SymbolId[][]): void;
  /** light winning cells; empty clears */
  highlight(cells: readonly (readonly [number, number])[], tier: "small" | "nice" | "big" | "mega" | null): void;
  /** animate the lever arm down and back (the character's hand follows ANCHORS.lever) */
  pullLever(): Promise<void>;
}

// ── quality ─────────────────────────────────────────────────────────────────

/**
 * high: shadows + full post (bloom, vignette, grain, SMAA)
 * mid:  DPR ≤ 1.5, bloom only, no shadows
 * low:  no WebGL at all → the DOM reels (also: reduced motion with no WebGL, Save-Data)
 */
export type Quality = "high" | "mid" | "low";

// ── stage ↔ game bridge ─────────────────────────────────────────────────────
// The DOM game (useSlotGame) and the 3D stage never import each other. The
// stage registers its controls here; the game calls them if present.

export type CasinoControls = {
  /** Keone pulls the lever and the cabinet's arm animates; resolves when the pull "lands" */
  pullLever(): Promise<void>;
  react(kind: "loss" | "small" | "nice" | "big" | "mega"): void;
  /** the cabinet as a reels driver */
  cabinet: CabinetHandle;
  skipIntro(): void;
};

type Listener = () => void;
let controls: CasinoControls | null = null;
let introDone = false;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

export const casino = {
  register(c: CasinoControls | null) {
    controls = c;
    emit();
  },
  get controls() {
    return controls;
  },
  setIntroDone(v: boolean) {
    introDone = v;
    emit();
  },
  get introDone() {
    return introDone;
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

/** session flag: the intro plays once per browser session */
export const INTRO_SEEN_KEY = "simp.intro.seen";
