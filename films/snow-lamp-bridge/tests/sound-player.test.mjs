// Checks for sound in the player (the playback block of src/main.js, src/audio/worker.js), on the built page: the
// worker renders the same samples as the export, the Sound button starts it, and while it plays the picture follows
// the audio clock through a seek, a pause and a play. Run from the project root after npm run build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { GL_ARGS, ROOT } from '../scripts/lib/browser.mjs';
import { chromiumPath } from '../scripts/lib/raster.mjs';
import { CONFIG } from '../src/config.js';
import { SHOTS } from '../src/shots.js';
import { renderSoundtrack } from '../src/audio/index.js';

const URL = pathToFileURL(resolve(ROOT, 'dist/index.html')).href;

async function open(query = '') {
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return { browser, page, errors };
}

test('player sound: the worker renders the export\'s samples (to a float32 step); the button plays them; the picture follows the audio clock', { timeout: 600000 }, async () => {
  const { browser, page, errors } = await open('?overlay=0');
  try {
    assert.match(await page.textContent('#sound'), /^Sound off/, 'off until asked: browsers start audio only from a gesture');
    await page.waitForFunction(() => window.__sound.state === 'ready', null, { timeout: 300000 });
    // the export's samples (Node's render): one engine, one seed, two runtimes. Measured: all but 161 of 10.75 million
    // samples are bit-identical and those 161 differ by one float32 step (about -144 dBFS): Chromium's V8 and Node's
    // round the last bit of a math function differently. So: equal stats, at most one step anywhere, almost never.
    const fetch = (ch) => page.evaluate((c) => {
      const a = new Uint8Array(window.__sound[c].buffer);
      let s = '';
      for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
      return btoa(s);
    }, ch).then((b) => { const u = Buffer.from(b, 'base64'); return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4); });
    const [pl, pr] = [await fetch('left'), await fetch('right')];
    const node = renderSoundtrack(CONFIG);
    assert.deepEqual(await page.evaluate(() => ({ sr: window.__sound.sr, stats: window.__sound.stats })), { sr: node.sr, stats: node.stats });
    assert.equal(pl.length, node.left.length);
    let differ = 0, worst = 0;
    for (const [a, b] of [[pl, node.left], [pr, node.right]]) for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { differ++; worst = Math.max(worst, Math.abs(a[i] - b[i])); }
    assert.ok(worst <= 2 ** -23 && differ <= 1e-4 * 2 * pl.length, `${differ} samples differ, worst by ${worst}`);
    // control: a planted change of two float32 steps is caught
    const planted = Float32Array.from(pl); planted[1000] += 2 ** -22;
    assert.ok(Math.abs(planted[1000] - node.left[1000]) > 2 ** -23);

    await page.locator('#sound').click();
    assert.equal(await page.textContent('#sound'), 'Sound on');
    assert.equal(await page.evaluate(() => Boolean(window.__sound.src)), true, 'a source plays');
    // a seek restarts the sound where the picture lands
    const s7 = SHOTS.find((s) => s.n === 7);
    await page.locator('#shots button').nth(SHOTS.indexOf(s7)).click();
    assert.equal(await page.evaluate(() => window.__sound.o0), s7.start);
    // the picture's time is the audio clock's: it moves with ctx.currentTime, not the page's clock
    const a = await page.evaluate(() => ({ ctx: window.__sound.ctx.currentTime, run: window.__sound.ctx.state }));
    await page.waitForTimeout(1500);
    const b = await page.evaluate(() => {
      const s = window.__sound, lat = s.ctx.outputLatency || s.ctx.baseLatency || 0;
      return { ctx: s.ctx.currentTime, want: s.o0 + Math.max(0, s.ctx.currentTime - s.t0 - lat), shown: document.getElementById('time').textContent };
    });
    assert.equal(a.run, 'running');
    assert.ok(b.ctx - a.ctx > 1, `the audio clock runs (${a.ctx} to ${b.ctx})`);
    const shown = Number(b.shown.split(':')[0]) * 60 + Number(b.shown.split(':')[1]);
    assert.ok(Math.abs(shown - b.want) < 0.25, `picture at ${shown}, audio at ${b.want}`);
    // pause stops the source, play starts it again where the picture is (the button: Space would click the focused shot)
    await page.locator('#play').click();
    assert.equal(await page.evaluate(() => window.__sound.src), null);
    const held = await page.textContent('#time');
    await page.locator('#play').click();
    const o0 = await page.evaluate(() => window.__sound.o0);
    const heldT = Number(held.split(':')[0]) * 60 + Number(held.split(':')[1]);
    assert.ok(Math.abs(o0 - heldT) < 0.1, `resumed at ${o0}, paused at ${heldT}`);
    // M turns it off: the page's clock takes over from the same time
    await page.keyboard.press('KeyM');
    assert.equal(await page.textContent('#sound'), 'Sound off');
    assert.equal(await page.evaluate(() => window.__sound.src), null);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('capture mode starts no sound', { timeout: 300000 }, async () => {
  const { browser, page, errors } = await open('?capture=1');
  try {
    assert.equal(await page.evaluate(() => window.__sound), undefined);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
