"use client";

import { SYMBOL_IDS, type SymbolId } from "../../config";
import type { SymbolArtMap } from "../symbols";
import { isFace } from "../faces";
import { fontsReady } from "./textures";

/**
 * One canvas atlas for every reel symbol (4×4 cells, transparent ground; the
 * reel shader paints the cream paper underneath), plus a vertically smeared
 * twin at half resolution used while the reels are at full speed.
 *
 * Every image is same-origin (manifest tiles, committed NFT art, or the
 * /api/face proxy), so the canvas never taints and WebGL can upload it.
 *
 * Loading never blocks or throws: each image gets IMAGE_TIMEOUT_MS, then its
 * fallback source (the manifest tile behind a live face), then a drawn tile
 * with the symbol's name. So the atlas always paints, whatever the network does.
 */

export const ATLAS_COLS = 4;
/** sharp cell size: a reel cell is ~200 device px tall on a 2× phone, so 384 keeps one mip level of headroom */
export const CELL = 384;
export const ATLAS_SIZE = ATLAS_COLS * CELL;
const BLUR_CELL = CELL / 2;
export const IMAGE_TIMEOUT_MS = 4000;

/** atlas cell origin in UV space (flipY textures: v = 0 at the canvas bottom) */
export function cellOrigin(id: SymbolId): [number, number] {
  const i = SYMBOL_IDS.indexOf(id);
  const c = i % ATLAS_COLS;
  const r = Math.floor(i / ATLAS_COLS);
  return [c / ATLAS_COLS, 1 - (r + 1) / ATLAS_COLS];
}

/** how long a timed-out image may still arrive and replace its fallback tile */
const LATE_MS = 30000;

/**
 * Resolves with a decoded image, or null on error / timeout; never rejects.
 * A timed-out request is kept alive a while longer: if it does arrive (a slow
 * gateway, or a main-thread stall that made the timer fire first), `onLate`
 * gets the image so the caller can swap it in.
 */
export function loadImage(
  src: string | undefined,
  timeoutMs = IMAGE_TIMEOUT_MS,
  onLate?: (img: HTMLImageElement) => void,
): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    let timedOut = false;
    const stop = () => {
      clearTimeout(timer);
      clearTimeout(lateTimer);
      img.onload = img.onerror = null;
    };
    const finish = (v: HTMLImageElement | null) => {
      if (settled) {
        // a late arrival after the timeout
        stop();
        if (v && timedOut) onLate?.(v);
        return;
      }
      settled = true;
      if (v || !onLate || !timedOut) stop();
      if (!v && (!onLate || !timedOut)) img.src = ""; // drop a request nobody will use
      resolve(v);
    };
    let lateTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      lateTimer = setTimeout(() => {
        stop();
        img.src = "";
      }, LATE_MS);
      finish(null);
    }, timeoutMs);
    img.decoding = "async";
    img.onload = () => {
      // an SVG without intrinsic size, or a body that isn't an image, can "load" with nothing to draw
      if (!img.naturalWidth && !img.naturalHeight) return finish(null);
      img.decode().then(
        () => finish(img),
        () => finish(img.complete ? img : null),
      );
    };
    img.onerror = () => finish(null);
    img.src = src;
  });
}

const DISPLAY = '"Bodoni Moda Variable", "Bodoni 72", Didot, Georgia, serif';

/**
 * The tile shown when a symbol's art can't be had: its name set in Bodoni on
 * a small velvet plaque with a gold hairline, like the belly glass printing.
 */
export function drawFallbackTile(g: CanvasRenderingContext2D, label: string, s: number, face = false) {
  const cx = s / 2;
  const cy = s / 2;
  g.save();
  if (face) {
    g.beginPath();
    g.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
  } else {
    const w = s * 0.78;
    const h = s * 0.62;
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, s * 0.03);
  }
  const bg = g.createRadialGradient(cx, cy * 0.85, s * 0.05, cx, cy, s * 0.5);
  bg.addColorStop(0, "#4a1236");
  bg.addColorStop(1, "#2a0b1f");
  g.fillStyle = bg;
  g.fill();
  g.lineWidth = Math.max(1, s * 0.008);
  g.strokeStyle = "#d9a845";
  g.stroke();
  g.clip();

  // the name: italic Bodoni, fitted to the plaque, a diamond rule underneath
  const text = label.trim() || "?";
  let size = s * 0.16;
  g.font = `italic 600 ${size}px ${DISPLAY}`;
  const maxW = s * (face ? 0.6 : 0.64);
  const tw = g.measureText(text).width;
  if (tw > maxW) {
    size *= maxW / tw;
    g.font = `italic 600 ${size}px ${DISPLAY}`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#f1e4cc";
  g.fillText(text, cx, cy - s * 0.02);
  g.strokeStyle = "rgba(217,168,69,0.75)";
  g.lineWidth = Math.max(1, s * 0.005);
  const ry = cy + size * 0.62;
  g.beginPath();
  g.moveTo(cx - s * 0.16, ry);
  g.lineTo(cx - s * 0.03, ry);
  g.moveTo(cx + s * 0.03, ry);
  g.lineTo(cx + s * 0.16, ry);
  g.stroke();
  g.translate(cx, ry);
  g.rotate(Math.PI / 4);
  g.fillStyle = "#d9a845";
  const d = s * 0.014;
  g.fillRect(-d, -d, 2 * d, 2 * d);
  g.restore();
}

/** draw one symbol into a cell-sized context at (0,0) */
function drawSymbol(g: CanvasRenderingContext2D, id: SymbolId, img: HTMLImageElement | null, label: string) {
  const s = CELL;
  if (isFace(id)) {
    if (!img) {
      drawFallbackTile(g, label, s, true);
      return;
    }
    // cameo: circle-cropped portrait in a double gold ring
    const r = s * 0.4;
    const cx = s / 2;
    const cy = s / 2;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.closePath();
    g.fillStyle = "#2a0b1f";
    g.fill();
    g.clip();
    const iw = img.naturalWidth || s;
    const ih = img.naturalHeight || s;
    const k = Math.max((2 * r) / iw, (2 * r) / ih);
    g.drawImage(img, cx - (iw * k) / 2, cy - (ih * k) / 2, iw * k, ih * k);
    // a soft inner vignette so the edge reads as glass over the portrait
    const v = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    v.addColorStop(0, "rgba(42,11,31,0)");
    v.addColorStop(1, "rgba(42,11,31,0.45)");
    g.fillStyle = v;
    g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    g.restore();
    const ring = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    ring.addColorStop(0, "#f6dc95");
    ring.addColorStop(0.45, "#d9a845");
    ring.addColorStop(1, "#7a5418");
    g.lineWidth = s * 0.035;
    g.strokeStyle = ring;
    g.beginPath();
    g.arc(cx, cy, r + s * 0.016, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = s * 0.01;
    g.strokeStyle = "#7a5418";
    g.beginPath();
    g.arc(cx, cy, r + s * 0.04, 0, Math.PI * 2);
    g.stroke();
    return;
  }
  if (!img) {
    drawFallbackTile(g, label, s);
    return;
  }
  const iw = img.naturalWidth || s;
  const ih = img.naturalHeight || s;
  const box = s * 0.82;
  const k = Math.min(box / iw, box / ih);
  g.drawImage(img, (s - iw * k) / 2, (s - ih * k) / 2, iw * k, ih * k);
}

export type Atlas = { sharp: HTMLCanvasElement; blur: HTMLCanvasElement };

export function createAtlas(): Atlas {
  const mk = (size: number) => {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    return c;
  };
  return { sharp: mk(ATLAS_SIZE), blur: mk(BLUR_CELL * ATLAS_COLS) };
}

/** the art for one symbol: its source, then its fallback source; null when neither arrives in time */
async function loadArt(art: SymbolArtMap, id: SymbolId, onLate: (img: HTMLImageElement) => void) {
  return (
    (await loadImage(art[id].src, IMAGE_TIMEOUT_MS, onLate)) ??
    (art[id].fallback ? await loadImage(art[id].fallback, IMAGE_TIMEOUT_MS, onLate) : null)
  );
}

/**
 * (Re)draw every cell from the art map. Always resolves, within about two
 * image timeouts, and always leaves every cell painted (art or name tile).
 * Art that turns up after its timeout is painted over its tile later, and
 * `onLate` is called so the caller can re-upload the textures.
 * Returns how many cells fell back to the drawn tile.
 */
export async function paintAtlas(atlas: Atlas, art: SymbolArtMap, onLate?: () => void): Promise<number> {
  const sharp = atlas.sharp.getContext("2d");
  const blur = atlas.blur.getContext("2d");
  const cell = document.createElement("canvas");
  cell.width = CELL;
  cell.height = CELL;
  const cg = cell.getContext("2d");
  if (!sharp || !blur || !cg) return 0;

  let painted = false;
  const late = new Map<number, HTMLImageElement>();
  const [imgs] = await Promise.all([
    Promise.all(
      SYMBOL_IDS.map((id, i) =>
        loadArt(art, id, (img) => {
          // first paint not done yet: it will pick this up; otherwise paint just this cell now
          late.set(i, img);
          if (painted && paintCell(i, img)) onLate?.();
        }),
      ),
    ),
    fontsReady(),
  ]);

  /** draw one cell into both canvases; false if the image refused to draw (the name tile went in instead) */
  function paintCell(i: number, img: HTMLImageElement | null): boolean {
    const id = SYMBOL_IDS[i];
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    let ok = !!img;
    cg!.clearRect(0, 0, CELL, CELL);
    try {
      drawSymbol(cg!, id, img, art[id].label);
    } catch {
      // a decoded image that still refuses to draw: use the name tile
      ok = false;
      cg!.clearRect(0, 0, CELL, CELL);
      drawSymbol(cg!, id, null, art[id].label);
    }
    sharp!.clearRect(col * CELL, row * CELL, CELL, CELL);
    sharp!.drawImage(cell, col * CELL, row * CELL);

    // motion smear: the cell drawn at stacked vertical offsets, wrapped inside its own cell
    const x = col * BLUR_CELL;
    const y = row * BLUR_CELL;
    blur!.save();
    blur!.clearRect(x, y, BLUR_CELL, BLUR_CELL);
    blur!.beginPath();
    blur!.rect(x, y, BLUR_CELL, BLUR_CELL);
    blur!.clip();
    // many faint taps with a triangular weight read as a streak, not a ladder of copies
    const taps = 24;
    for (let t = 0; t < taps; t++) {
      const k = (t / (taps - 1)) * 2 - 1;
      blur!.globalAlpha = (1 - Math.abs(k)) * (2.2 / taps);
      blur!.drawImage(cell, x, y + k * BLUR_CELL * 0.26, BLUR_CELL, BLUR_CELL);
    }
    blur!.restore();
    return ok;
  }

  let fallbacks = 0;
  SYMBOL_IDS.forEach((_, i) => {
    if (!paintCell(i, imgs[i] ?? late.get(i) ?? null)) fallbacks++;
  });
  painted = true;
  return fallbacks;
}
