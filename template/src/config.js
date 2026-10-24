// Every tunable value in one place. Stages change values here, not code.
export const CONFIG = {
  stage: 'look', // 'blockout' (flat grey materials, no PS1 pass: for staging) or 'look' (textures, the PS1 patch and final pass)
  res: { w: 480, h: 270 }, // internal resolution; 320x180 is the 6x option
  out: { w: 1920, h: 1080 }, // MP4 size; the upscale factor is out.w / res.w, nearest neighbour
  fps: 24,
  seed: 1, // every seeded random stream derives from this (rngFor(name) in main.js)
  playback: { quantize: true }, // HTML playback draws only on 1/fps ticks, so it shows the MP4's frames
  overlay: true, // shot number, time and lens burned into the frame (default for previews; ?overlay=0 for finals)
  background: '#05080f',
  fog: { color: '#0a0f1a', density: 0.03 }, // scene fog (FogExp2)
  near: 0.1, // camera near plane, meters
  // The PS1 look (src/ps1/): vertex snap to the internal pixel grid and affine texture warp, each 0 to 1; the final
  // pass cuts each channel to `bits` bits, with a 4x4 Bayer dither when `dither` is on.
  ps1: { snap: 1, warp: 1, bits: 5, dither: true },

  // Lights. three.js 0.186 uses physical units: spot and point intensities are candela, directional is lux.
  // Lights are created once in src/scene.js; never add or remove one after load (it recompiles every shader).
  lights: {
    hemi: { sky: '#33456b', ground: '#0b0e16', intensity: 0.6 },
    lamp: { color: '#ffb46b', intensity: 40, distance: 0, decay: 2, angleDeg: 60, penumbra: 0.5 },
  },

  // The glow card on the lamp's bulb (src/scene.js): meters across, and its opacity.
  glow: { size: 1.2, opacity: 0.55 },

  // Falling snow (src/scene.js): flake count, the box it wraps in around the lamp (meters), fall speeds (m/s), pixels.
  snow: { count: 700, box: [14, 7, 14], fall: [0.5, 0.9], sizePx: 2 },

  // Final deliverables (scripts/finals.js). lift: a curves spec applied to the thumbnails only. stills: shot number to
  // the time of its best frame (a shot not listed uses its middle). thumbs: 1280x720 candidates, the frame at t
  // upscaled `scale` times (3 or 4, nearest) and cropped around (cx, cy), fractions of the frame from the top left.
  finals: {
    lift: '0/0 0.15/0.24 0.5/0.62 1/1',
    stills: {},
    thumbs: [
      { name: 'thumb-A-lamp', t: 3, scale: 3, cx: 0.5, cy: 0.5 },
      { name: 'thumb-B-wall', t: 6, scale: 4, cx: 0.5, cy: 0.5 },
      { name: 'thumb-C-under', t: 11, scale: 4, cx: 0.5, cy: 0.45 },
    ],
  },
};

export function readParams(search = '') {
  const p = new URLSearchParams(search);
  return {
    capture: p.get('capture') === '1',
    overlay: p.has('overlay') ? p.get('overlay') !== '0' : CONFIG.overlay,
    t: p.has('t') ? Number(p.get('t')) : null,
  };
}
