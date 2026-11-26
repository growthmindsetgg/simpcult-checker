/** "Velvet room at 3am" palette, shared with the DOM (see casino art direction). */
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
} as const;

/** Fog density (exp2). Tuned so the far end of the aisle (≈12 m) is mostly haze. */
export const FOG_DENSITY = 0.055;
