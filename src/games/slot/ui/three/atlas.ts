"use client";

import { SYMBOL_IDS, type SymbolId } from "../../config";
import type { SymbolArtMap } from "../symbols";
import { isFace } from "../faces";

/**
 * One canvas atlas for every reel symbol (4×4 cells of 256px, transparent
 * ground; the reel shader paints the cream paper underneath), plus a
 * vertically smeared twin used while the reels are at full speed.
 *
 * Every image is same-origin (manifest tiles, committed NFT art, or the
 * /api/face proxy), so the canvas never taints and WebGL can upload it.
 */

export const ATLAS_COLS = 4;
export const CELL = 256;
export const ATLAS_SIZE = ATLAS_COLS * CELL;

/** atlas cell origin in UV space (flipY textures: v = 0 at the canvas bottom) */
export function cellOrigin(id: SymbolId): [number, number] {
  const i = SYMBOL_IDS.indexOf(id);
  const c = i % ATLAS_COLS;
  const r = Math.floor(i / ATLAS_COLS);
  return [c / ATLAS_COLS, 1 - (r + 1) / ATLAS_COLS];
}

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** draw one symbol into a cell-sized context at (0,0) */
function drawSymbol(g: CanvasRenderingContext2D, id: SymbolId, img: HTMLImageElement | null) {
  const s = CELL;
  if (isFace(id)) {
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
    if (img) {
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
    }
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
  if (!img) return;
  const iw = img.naturalWidth || s;
  const ih = img.naturalHeight || s;
  const box = s * 0.82;
  const k = Math.min(box / iw, box / ih);
  g.drawImage(img, (s - iw * k) / 2, (s - ih * k) / 2, iw * k, ih * k);
}

export type Atlas = { sharp: HTMLCanvasElement; blur: HTMLCanvasElement };

export function createAtlas(): Atlas {
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = ATLAS_SIZE;
    c.height = ATLAS_SIZE;
    return c;
  };
  return { sharp: mk(), blur: mk() };
}

/** (re)draw every cell from the art map; resolves once both canvases are painted */
export async function paintAtlas(atlas: Atlas, art: SymbolArtMap): Promise<void> {
  const imgs = await Promise.all(SYMBOL_IDS.map((id) => load(art[id].src)));
  const sharp = atlas.sharp.getContext("2d");
  const blur = atlas.blur.getContext("2d");
  if (!sharp || !blur) return;
  sharp.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  blur.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  const cell = document.createElement("canvas");
  cell.width = CELL;
  cell.height = CELL;
  const cg = cell.getContext("2d");
  if (!cg) return;

  SYMBOL_IDS.forEach((id, i) => {
    const x = (i % ATLAS_COLS) * CELL;
    const y = Math.floor(i / ATLAS_COLS) * CELL;
    cg.clearRect(0, 0, CELL, CELL);
    drawSymbol(cg, id, imgs[i]);
    sharp.drawImage(cell, x, y);

    // motion smear: the cell drawn at stacked vertical offsets, wrapped inside its own cell
    blur.save();
    blur.beginPath();
    blur.rect(x, y, CELL, CELL);
    blur.clip();
    // many faint taps with a triangular weight read as a streak, not a ladder of copies
    const taps = 28;
    for (let t = 0; t < taps; t++) {
      const k = (t / (taps - 1)) * 2 - 1;
      blur.globalAlpha = (1 - Math.abs(k)) * (2.2 / taps);
      blur.drawImage(cell, x, y + k * CELL * 0.26);
    }
    blur.restore();
  });
}
