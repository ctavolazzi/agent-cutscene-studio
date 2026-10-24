// Checks for the playback controls (index.html #ui, the playback block of src/main.js), on the built page.
// Run from the project root after npm run build: node --test tests/playback.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { GL_ARGS, ROOT } from '../scripts/lib/browser.mjs';
import { chromiumPath } from '../scripts/lib/raster.mjs';
import { SHOTS } from '../src/shots.js';
import { CONFIG } from '../src/config.js';

const URL = pathToFileURL(resolve(ROOT, 'dist/index.html')).href;
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

async function open(query = '') {
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${URL}${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  return { browser, page, errors };
}
const timeIs = (page, text) => page.waitForFunction((x) => document.getElementById('time').textContent === x, text, { timeout: 30000 });

test('controls: pause, shot list, frame step, next shot, overlay toggle', { timeout: 300000 }, async () => {
  const { browser, page, errors } = await open('?overlay=0');
  try {
    assert.equal(await page.evaluate(() => document.getElementById('ui').classList.contains('on')), true);
    assert.equal(await page.locator('#shots button').count(), SHOTS.length, 'one button per shot');
    await page.keyboard.press('Space');
    assert.equal(await page.textContent('#play'), 'Play', 'Space pauses');
    const s5 = SHOTS[1]; // the second shot: there is one after it for the next-shot key
    await page.locator('#shots button').nth(SHOTS.indexOf(s5)).click();
    await timeIs(page, clock(s5.start));
    assert.match(await page.textContent('#title'), new RegExp(`^${s5.n}\\. ${s5.title}$`));
    await page.waitForTimeout(400);
    assert.equal(await page.textContent('#time'), clock(s5.start), 'paused stays put');
    await page.keyboard.press('ArrowRight');
    await timeIs(page, clock(s5.start + 1 / CONFIG.fps));
    await page.keyboard.press('BracketRight');
    await timeIs(page, clock(SHOTS[SHOTS.indexOf(s5) + 1].start));
    assert.equal(await page.isChecked('#debug'), false);
    await page.keyboard.press('KeyD');
    assert.equal(await page.isChecked('#debug'), true, 'D turns the overlay on');
    await page.locator('#play').click();
    assert.equal(await page.textContent('#play'), 'Pause', 'the button plays');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('capture mode shows no controls', { timeout: 300000 }, async () => {
  const { browser, page, errors } = await open('?capture=1');
  try {
    assert.equal(await page.isVisible('#ui'), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
