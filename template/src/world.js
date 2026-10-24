// World state as pure functions of time. Nothing here keeps state, so the same t always gives the same answer.
// Replace the example timing with your film's: who is where, which lights are on, when things happen.
import { LAMP, WALL } from './set.js';

export const T_TOTAL = 12; // seconds; the film's length
export const FPS = 24;

const clamp01 = (u) => Math.min(1, Math.max(0, u));
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };

// 0 to 1: the fade in from black at the start (applied in the final pass)
export function fadeIn(t) { return smooth(t / 2); }

// The lamp's brightness, 0.85 to 1: a slow, uneven flicker from t alone
export function lampFlicker(t) {
  return 1 - 0.15 * Math.max(0, Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1.3));
}

// Named world points the camera check compares between makeCamera and the built three.js camera (scripts/check-cameras.js)
export function landmarksAt() {
  return [
    ['lamp head', LAMP.head],
    ['lamp base', [LAMP.base[0], 0.3, LAMP.base[1]]],
    ['wall centre', [(WALL.x0 + WALL.x1) / 2, WALL.height, WALL.z]],
  ];
}
