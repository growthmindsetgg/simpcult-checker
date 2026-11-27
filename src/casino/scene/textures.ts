/**
 * Textures drawn in code (no image files, no CDN): the tufted-velvet normal
 * map and the neon sign lettering. Everything is created lazily on the client
 * and cached for the life of the page.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from "three";
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

/**
 * The sign is drawn as two layers per line, so only the tubes bloom:
 *   core  the glass tube itself: a white-hot centre with saturated pink edges.
 *         Drawn at high gain (well over the bloom threshold) and left to the
 *         bloom pass for its glow.
 *   halo  the light the tube throws on the air and the curtain behind it: wide
 *         soft pink, added at low gain under the threshold, so it reads as lit
 *         haze instead of a printed glow.
 * Canvases are 2048 wide (1.6x the 1280-unit layout below), mipmapped with
 * anisotropy 8, so the lettering holds up on a 2x screen and at an angle.
 */
export type SignLayer = "core" | "halo";
export type SignTextures = {
  word: Record<SignLayer, CanvasTexture>;
  sub: Record<SignLayer, CanvasTexture>;
  aspectWord: number;
  aspectSub: number;
};

/** layout units: the drawing code works in a 1280-wide space and is scaled to the canvas */
const UNITS = 1280;
const SIGN_W = 2048;

type Pass = { blur: number; color: string; alpha: number };

function glowText(ctx: CanvasRenderingContext2D, k: number, text: string, x: number, y: number, passes: Pass[], core?: string) {
  for (const p of passes) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.blur * k; // shadowBlur ignores the transform
    ctx.fillStyle = p.color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  if (core) {
    ctx.fillStyle = core;
    ctx.fillText(text, x, y);
  }
}

function begin(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const k = canvas.width / UNITS;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return { ctx, k, w: UNITS, h: canvas.height / k };
}

function drawWord(canvas: HTMLCanvasElement, fontOk: boolean, layer: SignLayer) {
  const { ctx, k, w, h } = begin(canvas);
  const family = fontOk ? `"${FONT}", Didot, "Bodoni 72", serif` : `Didot, "Bodoni 72", Georgia, serif`;
  ctx.font = `italic 600 360px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const cx = w / 2;
  const by = h * 0.7;
  if (layer === "halo") {
    glowText(ctx, k, "simp", cx, by, [
      { blur: 90, color: C.neon, alpha: 0.55 },
      { blur: 36, color: C.neon, alpha: 0.75 },
    ]);
  } else {
    // the tube: saturated pink edge, white-hot centre
    glowText(ctx, k, "simp", cx, by, [{ blur: 6, color: C.neonHot, alpha: 1 }], "#ffe9f6");
  }
  // the swash underline, as one bent tube
  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - 330, by + 70);
  ctx.bezierCurveTo(cx - 120, by + 40, cx + 140, by + 104, cx + 360, by + 54);
  if (layer === "halo") {
    ctx.strokeStyle = C.neon;
    ctx.shadowColor = C.neon;
    ctx.shadowBlur = 30 * k;
    ctx.lineWidth = 12;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
  } else {
    ctx.strokeStyle = C.neonHot;
    ctx.shadowColor = C.neonHot;
    ctx.shadowBlur = 5 * k;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffe0f1";
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSub(canvas: HTMLCanvasElement, fontOk: boolean, layer: SignLayer) {
  const { ctx, k, w, h } = begin(canvas);
  const family = fontOk ? `"${FONT}", Didot, serif` : `Didot, Georgia, serif`;
  ctx.font = `500 120px ${family}`;
  ctx.textBaseline = "middle";
  const text = "MACHINE";
  const spacing = 54;
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, cw) => a + cw, 0) + spacing * (text.length - 1);
  let x = w / 2 - total / 2;
  const y = h / 2;
  ctx.textAlign = "left";
  for (let i = 0; i < text.length; i++) {
    if (layer === "halo") glowText(ctx, k, text[i], x, y, [{ blur: 40, color: C.neon, alpha: 0.6 }]);
    else glowText(ctx, k, text[i], x, y, [{ blur: 5, color: C.neonHot, alpha: 1 }], "#ffeaf5");
    x += widths[i] + spacing;
  }
}

let signCache: SignTextures | null = null;

function canvasTex(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  return { c, t };
}

/** Sign textures; drawn immediately with a fallback serif, redrawn once Bodoni loads. */
export function signTextures(): SignTextures {
  if (signCache) return signCache;
  const k = SIGN_W / UNITS;
  const wordH = Math.round(560 * k);
  const subH = Math.round(200 * k);
  const layers = ["core", "halo"] as const;
  const word = Object.fromEntries(layers.map((l) => [l, canvasTex(SIGN_W, wordH)])) as Record<SignLayer, ReturnType<typeof canvasTex>>;
  const sub = Object.fromEntries(layers.map((l) => [l, canvasTex(SIGN_W, subH)])) as Record<SignLayer, ReturnType<typeof canvasTex>>;
  const draw = (fontOk: boolean) => {
    for (const l of layers) {
      drawWord(word[l].c, fontOk, l);
      drawSub(sub[l].c, fontOk, l);
      word[l].t.needsUpdate = true;
      sub[l].t.needsUpdate = true;
    }
  };
  draw(false);
  signCache = {
    word: { core: word.core.t, halo: word.halo.t },
    sub: { core: sub.core.t, halo: sub.halo.t },
    aspectWord: SIGN_W / wordH,
    aspectSub: SIGN_W / subH,
  };
  void loadSignFont().then((ok) => {
    if (ok) draw(true);
  });
  return signCache;
}
