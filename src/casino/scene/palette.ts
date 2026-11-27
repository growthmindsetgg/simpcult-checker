/**
 * Scene palette. "Velvet room, house lights up": the velvet and brass stay,
 * the void around them becomes plum, and the Monad brand colours light it
 * (lavender overhead, Monad purple wash, a cyan kicker, amber practicals).
 * Pink stays the neon and the win colour.
 */
export const C = {
  ink: "#0a0610",
  velvet: "#2a0b1f",
  velvetHi: "#4a1236",
  neon: "#ff3fae",
  neonHot: "#ff8fd6",
  gold: "#d9a845",
  goldHi: "#f6dc95",
  goldLo: "#7a5418",
  monad: "#6e54ff",
  paper: "#f1e4cc",
  /** the room's base: background and the far end of the aisle */
  plum: "#29133a",
  /** the haze the room recedes into */
  fog: "#3a1d52",
  /** Monad lavender: the overhead light */
  lavender: "#ddd7fe",
  /** Monad cyan: the cool kicker on chrome and brass edges */
  cyan: "#85e6ff",
  /** Monad amber: the practical lamps */
  amber: "#ffae45",
  /** Monad hot pink: the curtain wash */
  pinkHot: "#ff8ee4",
} as const;

/** Fog density (exp2). Lighter than before: the aisle recedes into plum haze, not into black. */
export const FOG_DENSITY = 0.04;
