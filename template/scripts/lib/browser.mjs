// Opens the built scene (dist/index.html) in headless Chromium in capture mode. Every script that needs frames uses this.
// Frames come back as raw RGB bytes, bottom row first (WebGL order): flip them with ffmpeg `vflip`.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromiumPath } from './raster.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// software WebGL; harmless on a machine with a GPU, needed on one without
export const GL_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

export async function openScene({ file = resolve(ROOT, 'dist/index.html'), overlay = true } = {}) {
  if (!existsSync(file)) throw new Error(`No build at ${file}. Run npm run build first.`);
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${pathToFileURL(file).href}?capture=1&overlay=${overlay ? 1 : 0}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const info = await page.evaluate(() => window.__info);
  return {
    browser,
    page,
    info, // { fps, total, res: {w,h}, out: {w,h}, shots: [{n,start,end,title,lens}] }
    errors, // page errors collected so far
    // draw time t and return { info: {t, shot, title, lens}, rgb: Buffer of res.w * res.h * 3 bytes, bottom row first }
    async frame(t) {
      const r = await page.evaluate((tt) => window.__frameRGB(tt), t);
      return { info: r.info, rgb: Buffer.from(r.b64, 'base64') };
    },
    // [sx, sy] fraction of the frame (0,0 top left) for world point p at time t, or null behind the camera
    async project(p, t) {
      return page.evaluate(([pp, tt]) => window.__project(pp, tt), [p, t]);
    },
    async close() {
      await browser.close();
    },
  };
}
