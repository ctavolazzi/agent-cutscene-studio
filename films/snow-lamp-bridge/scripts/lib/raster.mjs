// Rasterize SVG or HTML files to PNG with the installed Chromium. Used for review stills only, never for the deliverables.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function chromiumPath() {
  const env = process.env.CHROMIUM_PATH;
  if (env && existsSync(env)) return env;
  for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']) if (existsSync(p)) return p;
  return undefined; // fall back to Playwright's own download
}

export async function rasterize(jobs) {
  // jobs: [{ file, out, width, height?, fullPage?, scale? }]
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox'] }); // no WebGL needed for SVG and HTML, and the software GL flags slow plain pages down
  try {
    for (const j of jobs) {
      const page = await browser.newPage({ viewport: { width: j.width, height: j.height ?? 800 }, deviceScaleFactor: j.scale ?? 1 });
      await page.goto(pathToFileURL(j.file).href);
      // fullPage on a top-level SVG document hangs Chromium; the viewport is sized to the SVG instead
      await page.screenshot({ path: j.out, fullPage: j.fullPage ?? !j.file.endsWith('.svg') });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
