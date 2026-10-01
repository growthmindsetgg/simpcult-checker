// dev-only visual smoke: hits every top-level page at desktop + mobile widths
// runs against `npm run dev` on http://localhost:3000
// uses system Chrome (playwright's chromium download was blocked)

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.SIMP_BASE ?? "http://localhost:3000";
const PAGES = [
  { path: "/", name: "home" },
  { path: "/checker", name: "checker" },
  { path: "/dao", name: "dao" },
  { path: "/verify", name: "verify" },
  { path: "/security", name: "security" },
];
const VIEWPORTS = [
  { w: 1440, h: 900, tag: "1440" },
  { w: 390, h: 844, tag: "390" },
];

const OUT_DIR = join(process.cwd(), "screenshots");
await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
      reducedMotion: "reduce", // stabilise for consistent screenshots
    });
    for (const p of PAGES) {
      const page = await context.newPage();
      const url = `${BASE}${p.path}`;
      const start = Date.now();
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      } catch {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      }
      // hide the Next.js dev-mode "N + Issues" overlay for cleaner shots
      await page.addStyleTag({
        content: "nextjs-portal,#__next-build-watcher{display:none!important}",
      });
      await page.waitForTimeout(400);
      // walk the page slowly so IntersectionObserver-based reveals all fire
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.35;
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y < total; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 260));
        }
        // once: true means the reveals stay on — go back to top and let
        // any in-flight transitions finish before snapping the screenshot
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 1200));
      });
      const file = join(OUT_DIR, `${p.name}-${vp.tag}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`✓ ${p.name} @ ${vp.tag}px  (${Date.now() - start}ms)`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
console.log("\nsaved to", OUT_DIR);
