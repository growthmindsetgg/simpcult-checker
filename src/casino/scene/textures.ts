/**
 * Textures drawn in code (no image files, no CDN): the tufted-velvet normal
 * map and the neon sign lettering. Everything is created lazily on the client
 * and cached for the life of the page.
 */
import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { C } from "./palette";

let tuftCache: CanvasTexture | null = null;

/**
 * Diamond tufting: deep button dimples on a diamond lattice, puffy cushions in
 * between and creases running button to button. Height field → normal map.
 */
export function tuftedNormalMap(): CanvasTexture {
  if (tuftCache) return tuftCache;
  const N = 256;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      // nearest button on the lattice (i, j) ∪ (i + .5, j + .5)
      const du1 = u - Math.round(u);
      const dv1 = v - Math.round(v);
      const du2 = u - 0.5 - Math.round(u - 0.5);
      const dv2 = v - 0.5 - Math.round(v - 0.5);
      const d = Math.sqrt(Math.min(du1 * du1 + dv1 * dv1, du2 * du2 + dv2 * dv2));
      const cushion = 1 - Math.exp(-((d / 0.2) ** 2));
      const a = u - v - Math.round(u - v);
      const b = u + v - Math.round(u + v);
      const crease = Math.exp(-((a / 0.025) ** 2)) + Math.exp(-((b / 0.025) ** 2));
      h[y * N + x] = cushion - 0.28 * Math.min(1, crease) * (1 - Math.exp(-((d / 0.12) ** 2)));
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(N, N);
  const strength = 5;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const l = h[y * N + ((x - 1 + N) % N)];
      const r = h[y * N + ((x + 1) % N)];
      const t = h[((y - 1 + N) % N) * N + x];
      const bt = h[((y + 1) % N) * N + x];
      let nx = (l - r) * strength;
      let ny = (bt - t) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * N + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  tuftCache = tex;
  return tex;
}

// ── neon lettering ──────────────────────────────────────────────────────────

const FONT = "SimpSignBodoni";
let fontPromise: Promise<boolean> | null = null;

/** Loads the self-hosted Bodoni Moda (public/casino, OFL). Resolves false on failure. */
export function loadSignFont(): Promise<boolean> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      const italic = new FontFace(FONT, "url(/casino/bodoni-moda-italic.woff2)", { style: "italic", weight: "400 900" });
      const roman = new FontFace(FONT, "url(/casino/bodoni-moda.woff2)", { style: "normal", weight: "400 900" });
      const [a, b] = await Promise.all([italic.load(), roman.load()]);
      document.fonts.add(a);
      document.fonts.add(b);
      return true;
    } catch {
      return false;
    }
  })();
  return fontPromise;
}

export type SignTextures = { word: CanvasTexture; sub: CanvasTexture; aspectWord: number; aspectSub: number };

function glowText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  passes: { blur: number; color: string; alpha: number }[],
  core: string,
) {
  for (const p of passes) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.blur;
    ctx.fillStyle = p.color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  ctx.fillStyle = core;
  ctx.fillText(text, x, y);
}

function drawWord(canvas: HTMLCanvasElement, fontOk: boolean) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const family = fontOk ? `"${FONT}", Didot, "Bodoni 72", serif` : `Didot, "Bodoni 72", Georgia, serif`;
  ctx.font = `italic 600 360px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cx = canvas.width / 2;
  const by = canvas.height * 0.7;
  glowText(
    ctx,
    "simp",
    cx,
    by,
    [
      { blur: 90, color: C.neon, alpha: 0.55 },
      { blur: 36, color: C.neon, alpha: 0.8 },
      { blur: 10, color: C.neonHot, alpha: 1 },
    ],
    "#ffe3f3",
  );
  // the swash underline, as one bent tube
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = C.neon;
  ctx.shadowColor = C.neon;
  ctx.shadowBlur = 30;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(cx - 330, by + 70);
  ctx.bezierCurveTo(cx - 120, by + 40, cx + 140, by + 104, cx + 360, by + 54);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffd6ee";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawSub(canvas: HTMLCanvasElement, fontOk: boolean) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const family = fontOk ? `"${FONT}", Didot, serif` : `Didot, Georgia, serif`;
  ctx.font = `500 120px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // letterSpacing is widely supported on canvas now; fall back to manual spacing
  const text = "MACHINE";
  const spacing = 54;
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, w) => a + w, 0) + spacing * (text.length - 1);
  let x = canvas.width / 2 - total / 2;
  const y = canvas.height / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < text.length; i++) {
    glowText(
      ctx,
      text[i],
      x,
      y,
      [
        { blur: 40, color: C.neon, alpha: 0.6 },
        { blur: 12, color: C.neonHot, alpha: 1 },
      ],
      "#ffe6f4",
    );
    x += widths[i] + spacing;
  }
}

let signCache: SignTextures | null = null;

/** Sign textures; drawn immediately with a fallback serif, redrawn once Bodoni loads. */
export function signTextures(): SignTextures {
  if (signCache) return signCache;
  const w = document.createElement("canvas");
  w.width = 1280;
  w.height = 560;
  const s = document.createElement("canvas");
  s.width = 1280;
  s.height = 200;
  drawWord(w, false);
  drawSub(s, false);
  const word = new CanvasTexture(w);
  const sub = new CanvasTexture(s);
  for (const t of [word, sub] as Texture[]) {
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
  }
  signCache = { word, sub, aspectWord: w.width / w.height, aspectSub: s.width / s.height };
  void loadSignFont().then((ok) => {
    if (!ok) return;
    drawWord(w, true);
    drawSub(s, true);
    word.needsUpdate = true;
    sub.needsUpdate = true;
  });
  return signCache;
}
