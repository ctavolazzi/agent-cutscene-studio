// Boot: build the scene once, expose the capture API, and (unless ?capture=1) run real-time playback.
// This file holds the only clock in the project (the playback loop). See src/CONTRACT.md.
import * as THREE from 'three';
import { CONFIG, readParams } from './config.js';
import { createTimeline, applyShotCamera, clampTime } from './timeline.js';
import { createHud } from './hud.js';
import { mulberry32, hashString } from './prng.js';
import { SHOTS, shotAt } from './shots.js';
import { T_TOTAL } from './world.js';
import { buildScene } from './scene.js';
import { createPs1Uniforms, patchScene } from './ps1/material.js';
import { createPost } from './ps1/post.js';

const params = readParams(location.search);
const W = CONFIG.res.w, H = CONFIG.res.h;

const canvas = document.getElementById('view');
canvas.width = W;
canvas.height = H;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.background);
scene.fog = new THREE.FogExp2(CONFIG.fog.color, CONFIG.fog.density);
const camera = new THREE.PerspectiveCamera(37.8, W / H, CONFIG.near, 3000);

const ctx = { THREE, scene, config: CONFIG, rngFor: (name) => mulberry32((CONFIG.seed ^ hashString(name)) >>> 0) };
const parts = buildScene(ctx); // src/scene.js: every part of the picture, each { update(t, camera) }
const hud = createHud(THREE, CONFIG, { overlay: params.overlay });
// the look stage: every Lambert and Basic material gets the PS1 patch, and frames go through the final pass
const look = CONFIG.stage === 'look';
if (look) patchScene(THREE, scene, createPs1Uniforms(THREE, CONFIG));
const post = look ? createPost(THREE, renderer, CONFIG) : null;
const timeline = createTimeline({ renderer, scene, camera, parts, hud, config: CONFIG, post });

// compile every program before frame 0, so no frame pays for a shader compile
applyShotCamera(camera, SHOTS[0], 0, W / H);
renderer.compile(scene, camera);
if (post) post.compile();

// ---- capture API (see src/CONTRACT.md)
const gl = renderer.getContext();
const rgba = new Uint8Array(W * H * 4);
const rgb = new Uint8Array(W * H * 3);
function frameRGB(t) {
  const info = timeline.renderAt(t);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, rgba); // same task as the render, so no preserveDrawingBuffer needed
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  let s = '';
  for (let i = 0; i < rgb.length; i += 0x8000) s += String.fromCharCode.apply(null, rgb.subarray(i, i + 0x8000));
  return { info, b64: btoa(s) };
}
const probe = new THREE.PerspectiveCamera();
function project(p, t) {
  const tt = clampTime(t);
  applyShotCamera(probe, shotAt(tt), tt, W / H);
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(probe.matrixWorldInverse);
  if (v.z >= -CONFIG.near) return null; // behind the camera
  v.applyMatrix4(probe.projectionMatrix);
  return [0.5 + v.x / 2, 0.5 - v.y / 2];
}
window.__info = { fps: CONFIG.fps, total: T_TOTAL, res: CONFIG.res, out: CONFIG.out, shots: SHOTS.map((s) => ({ n: s.n, start: s.start, end: s.end, title: s.title, lens: s.lens })) };
window.renderAt = (t) => timeline.renderAt(t);
window.__frameRGB = frameRGB;
window.__project = project;
window.__ready = true;

// ---- fit the canvas to the window, letterboxed, nearest-neighbour
function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
}
window.addEventListener('resize', fit);
fit();

// ---- real-time playback (the one clock); capture mode never starts it
if (!params.capture) {
  let playing = true;
  let offset = params.t ?? 0;
  let start = performance.now();
  let lastKey = null;
  const now = () => (playing ? offset + (performance.now() - start) / 1000 : offset) % T_TOTAL;
  // ---- controls (index.html #ui): play and pause, a scrub bar, the shot list, the overlay toggle
  const $ = (id) => document.getElementById(id);
  const ui = $('ui'), playBtn = $('play'), scrub = $('scrub'), timeEl = $('time'), titleEl = $('title'), debug = $('debug');
  const frame = 1 / CONFIG.fps;
  const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  scrub.max = String(T_TOTAL - frame);
  scrub.step = String(frame);
  const shotButtons = SHOTS.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(s.n);
    b.title = `${s.n}. ${s.title} (${clock(s.start)})`;
    b.style.width = `calc(${((s.end - s.start) / T_TOTAL) * 100}% - 1px)`;
    b.addEventListener('click', () => seek(s.start));
    $('shots').append(b);
    return b;
  });
  debug.checked = hud.overlay;
  ui.classList.add('on');

  const redraw = () => { lastKey = null; };
  const setPlaying = (on) => {
    if (on === playing) return;
    if (on) start = performance.now(); else offset = now();
    playing = on;
    playBtn.textContent = on ? 'Pause' : 'Play';
  };
  const toggle = () => setPlaying(!playing);
  // jump to t; a playing film keeps playing from there
  function seek(t) {
    offset = ((t % T_TOTAL) + T_TOTAL) % T_TOTAL;
    start = performance.now();
    redraw();
  }
  const step = (n) => { setPlaying(false); seek(Math.round(now() / frame + n) * frame); };
  const shotIndex = (t) => SHOTS.findIndex((s) => t >= s.start && t < s.end);
  const jumpShot = (d) => { const i = shotIndex(now()); seek(SHOTS[Math.min(SHOTS.length - 1, Math.max(0, i + d))].start); };
  const setOverlay = (on) => { hud.setOverlay(on); debug.checked = on; redraw(); };

  canvas.addEventListener('click', toggle);
  playBtn.addEventListener('click', toggle);
  let dragging = false;
  scrub.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  scrub.addEventListener('input', () => seek(Number(scrub.value)));
  debug.addEventListener('change', () => setOverlay(debug.checked));
  window.addEventListener('keydown', (e) => {
    if (e.target === scrub && e.code.startsWith('Arrow')) return; // the slider handles its own arrows
    if (e.code === 'Space' && e.target.closest?.('#ui') && e.target !== scrub) return; // a focused control clicks itself
    const keys = {
      Space: toggle, KeyK: toggle,
      ArrowLeft: () => step(e.shiftKey ? -CONFIG.fps : -1), ArrowRight: () => step(e.shiftKey ? CONFIG.fps : 1),
      BracketLeft: () => jumpShot(-1), BracketRight: () => jumpShot(1), Home: () => seek(0),
      KeyD: () => setOverlay(!hud.overlay),
    };
    if (keys[e.code]) { e.preventDefault(); keys[e.code](); }
  });
  // the controls fade after 2.5 s without a pointer move while the film plays
  let lastMove = performance.now();
  window.addEventListener('pointermove', () => { lastMove = performance.now(); });

  let lastShot = -1;
  const loop = () => {
    requestAnimationFrame(loop);
    const t = now();
    const key = CONFIG.playback.quantize ? Math.floor(t * CONFIG.fps + 1e-6) : t; // 1e-6: a seek to frame n lands on n
    if (key !== lastKey) {
      lastKey = key;
      const tt = CONFIG.playback.quantize ? key / CONFIG.fps : t;
      timeline.renderAt(tt);
      timeEl.textContent = clock(tt);
      if (!dragging) scrub.value = String(tt);
      const i = shotIndex(tt);
      if (i !== lastShot) {
        shotButtons[lastShot]?.classList.remove('now');
        shotButtons[i]?.classList.add('now');
        titleEl.textContent = i >= 0 ? `${SHOTS[i].n}. ${SHOTS[i].title}` : '';
        lastShot = i;
      }
    }
    ui.classList.toggle('idle', playing && performance.now() - lastMove > 2500);
  };
  requestAnimationFrame(loop);
}
