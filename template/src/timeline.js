// The master clock: renderAt(t) picks the shot, places the camera, updates every part, draws the frame.
// Hard cuts fall where shotAt(t) changes. Nothing here keeps state between calls.
import { cameraAt, shotAt, vfovDeg } from './shots.js';
import { T_TOTAL, fadeIn } from './world.js';

const D2R = Math.PI / 180;

// Put a three.js PerspectiveCamera where shots.js says the camera is at time t.
// Roll follows scripts/lib/math.js makeCamera: positive roll turns the right vector toward up (rotateZ, positive).
export function applyShotCamera(camera, shot, t, aspect) {
  const c = cameraAt(shot, t);
  camera.fov = vfovDeg(c.lens);
  camera.aspect = aspect;
  camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
  camera.up.set(0, 1, 0);
  camera.lookAt(c.target[0], c.target[1], c.target[2]);
  if (c.roll) camera.rotateZ(c.roll * D2R);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return c;
}

export const clampTime = (t) => Math.min(Math.max(t, 0), T_TOTAL - 1e-6);

// With `post` (the PS1 final pass, src/ps1/post.js) the scene goes through it and the fade happens there, in linear
// light, before the colour cut; without it the scene draws straight to the canvas and the HUD fades it.
export function createTimeline({ renderer, scene, camera, parts, hud, config, post = null }) {
  const aspect = config.res.w / config.res.h;
  function renderAt(tIn) {
    const t = clampTime(tIn);
    const shot = shotAt(t);
    applyShotCamera(camera, shot, t, aspect);
    for (const p of parts) p.update(t, camera);
    const fade = fadeIn(t);
    if (post) post.render(scene, camera, fade);
    else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    hud.draw(renderer, { t, shot, fade: post ? 1 : fade });
    return { t, shot: shot.n, title: shot.title, lens: shot.lens };
  }
  return { renderAt };
}
