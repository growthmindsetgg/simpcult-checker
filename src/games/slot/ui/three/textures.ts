"use client";

/**
 * Canvas-drawn signage for the cabinet: the topper's neon sign and the belly
 * glass. Local fonts only (Bodoni Moda from @fontsource, loaded before we
 * draw); nothing comes from a CDN.
 */

const DISPLAY = '"Bodoni Moda Variable", "Bodoni 72", Didot, Georgia, serif';

export async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`italic 600 120px "Bodoni Moda Variable"`),
      document.fonts.load(`600 60px "Bodoni Moda Variable"`),
    ]);
  } catch {
    /* fall back to a system serif */
  }
}

/**
 * The neon sign. The canvas holds a luminance mask (white core, soft glow);
 * the material tints it pink and pushes it past 1.0 so bloom picks it up.
 */
export function drawSign(c: HTMLCanvasElement) {
  c.width = 1024;
  c.height = 320;
  const g = c.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, c.width, c.height);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const x = c.width / 2;
  const y = c.height / 2 + 6;
  g.font = `italic 600 150px ${DISPLAY}`;
  const fit = Math.min(1, (c.width * 0.9) / g.measureText("Simp Machine").width);
  g.font = `italic 600 ${Math.round(150 * fit)}px ${DISPLAY}`;
  g.lineJoin = "round";
  g.lineCap = "round";

  // outer glow (tube light spilling), then the tube, then the hot core
  g.shadowColor = "rgba(255,255,255,0.9)";
  g.shadowBlur = 28;
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 16;
  g.strokeText("Simp Machine", x, y);
  g.shadowBlur = 10;
  g.strokeStyle = "rgba(255,255,255,0.75)";
  g.lineWidth = 7;
  g.strokeText("Simp Machine", x, y);
  g.shadowBlur = 0;
  g.strokeStyle = "#ffffff";
  g.lineWidth = 2.5;
  g.strokeText("Simp Machine", x, y);
}

/** The belly glass: printed art behind glass, softly backlit. */
export function drawBelly(c: HTMLCanvasElement) {
  c.width = 1024;
  c.height = 480;
  const g = c.getContext("2d");
  if (!g) return;
  const W = c.width;
  const H = c.height;

  const bg = g.createRadialGradient(W / 2, H * 0.55, 20, W / 2, H * 0.55, W * 0.62);
  bg.addColorStop(0, "#4a1236");
  bg.addColorStop(0.6, "#2a0b1f");
  bg.addColorStop(1, "#14050f");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // deco sunburst from the bottom centre
  g.save();
  g.translate(W / 2, H * 1.02);
  for (let i = 0; i < 25; i++) {
    const a = -Math.PI + (i / 24) * Math.PI;
    g.rotate(0);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a - 0.03) * W, Math.sin(a - 0.03) * W);
    g.lineTo(Math.cos(a + 0.03) * W, Math.sin(a + 0.03) * W);
    g.closePath();
    g.fillStyle = i % 2 ? "rgba(217,168,69,0.07)" : "rgba(217,168,69,0.035)";
    g.fill();
  }
  g.restore();

  // double gold border with stepped deco corners
  const gold = g.createLinearGradient(0, 0, W, H);
  gold.addColorStop(0, "#f6dc95");
  gold.addColorStop(0.5, "#d9a845");
  gold.addColorStop(1, "#7a5418");
  g.strokeStyle = gold;
  g.lineWidth = 6;
  g.strokeRect(18, 18, W - 36, H - 36);
  g.lineWidth = 2;
  g.strokeRect(34, 34, W - 68, H - 68);
  g.fillStyle = gold;
  for (const [cx, cy] of [
    [34, 34],
    [W - 34, 34],
    [34, H - 34],
    [W - 34, H - 34],
  ]) {
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.PI / 4);
    g.fillRect(-9, -9, 18, 18);
    g.restore();
  }

  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.fillStyle = gold;
  g.font = `600 30px ${DISPLAY}`;
  spaced(g, "PAYS ON FIVE LINES", W / 2, 118, 9);

  g.font = `italic 600 92px ${DISPLAY}`;
  g.fillStyle = "#f1e4cc";
  g.fillText("devotion, returned", W / 2, 236);

  g.strokeStyle = "rgba(217,168,69,0.8)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W / 2 - 230, 278);
  g.lineTo(W / 2 - 18, 278);
  g.moveTo(W / 2 + 18, 278);
  g.lineTo(W / 2 + 230, 278);
  g.stroke();
  g.save();
  g.translate(W / 2, 278);
  g.rotate(Math.PI / 4);
  g.fillStyle = gold;
  g.fillRect(-6, -6, 12, 12);
  g.restore();

  g.fillStyle = gold;
  g.font = `600 34px ${DISPLAY}`;
  g.fillText("SIMP  250×     ·     MONAD  100×     ·     FACES  40×", W / 2, 352);
  g.font = `italic 500 28px ${DISPLAY}`;
  g.fillStyle = "rgba(241,228,204,0.7)";
  g.fillText("every spin settled on the server, every spin checkable", W / 2, 408);
}

function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number) {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width + track);
  const total = widths.reduce((a, b) => a + b, 0) - track;
  let cx = x - total / 2;
  g.textAlign = "left";
  chars.forEach((ch, i) => {
    g.fillText(ch, cx, y);
    cx += widths[i];
  });
  g.textAlign = "center";
}
