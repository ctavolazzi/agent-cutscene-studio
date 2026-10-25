// Every tunable value in one place. Stages change values here, not code.
export const CONFIG = {
  stage: 'look', // 'blockout' (grey boxes, Stage 2 and 3) or 'look' (Stage 4 on: the PS1 patch and final pass)
  res: { w: 480, h: 270 }, // internal resolution; 320x180 is the 6x option
  out: { w: 1920, h: 1080 }, // MP4 size; the upscale factor is out.w / res.w, nearest neighbour
  fps: 24,
  seed: 20261021,
  playback: { quantize: true }, // HTML playback draws only on 1/fps ticks, so it shows the MP4's frames
  overlay: true, // shot number, time and lens burned into the frame (default for previews; ?overlay=0 for finals)
  background: '#05080f',
  // density: scene fog (FogExp2). cityDensity: the lighter haze the far city carries instead, so it reads as a band.
  fog: { color: '#0a0f1a', density: 0.012, cityDensity: 0.004 },
  near: 0.1, // camera near plane, meters; the closest framing (shot 14's ember) is about 1.9 m away
  // The PS1 look (src/ps1/): vertex snap to the internal pixel grid and affine texture warp, each 0 to 1; the final
  // pass cuts each channel to `bits` bits, with a 4x4 Bayer dither when `dither` is on.
  ps1: { snap: 1, warp: 1, bits: 5, dither: true },

  // Lights. three.js 0.186 uses physical units: spot and point intensities are candela, directional is lux.
  // Blockout values are rough; Stage 4 tunes them.
  lights: {
    hemi: { sky: '#33456b', ground: '#0b0e16', intensity: 0.6 },
    lamp: { color: '#ffb46b', intensity: 60, distance: 0, decay: 2, angleDeg: 70, penumbra: 0.5 },
    headlight: { color: '#e6efff', intensity: 400, distance: 0, decay: 2, angleDeg: 22, penumbra: 0.45 },
    moon: { color: '#9db8ff', intensity: 0.35 },
    lighter: { color: '#ff9a3a', intensity: 3, distance: 0, decay: 2 },
    ember: { color: '#ff5a1a', intensity: 0.25, distance: 0, decay: 2 },
  },

  // Glow and beams (src/fx/glow.js, look stage): additive cards in meters across, and faint visible cones.
  glow: {
    bulb: { size: 1.3, opacity: 0.55 },
    headlight: { size: 0.9, opacity: 0.75 },
    taillight: { size: 0.45, opacity: 0.55, color: '#ff2a12' },
    lampCone: { halfAngleDeg: 30, opacity: 0.06 },
    beamCone: { halfAngleDeg: 14, length: 14, opacity: 0.05 },
    coneEdge: 2.5, // how fast a cone fades where it turns edge-on (a power of the facing ratio)
  },

  // The cigarette (src/fx/smoke.js, look stage): sizes in meters.
  smoke: {
    flame: { color: '#ffb35a', size: 0.07, lift: 0.03, halo: 0.45, haloOpacity: 0.45 },
    ember: { color: '#ff5a1a', size: 0.03, halo: 0.09, haloOpacity: 0.45 },
    puff: { color: '#b9b4ad', opacity: 0.7, grow: 1.6 },
  },

  // Footprints (src/fx/footprints.js, look stage): packed snow, a little darker and bluer than the cover.
  footprints: { color: '#5a637a', opacity: 0.8 },
  // Tyre tracks (src/fx/tracks.js, look stage): the road's snow pressed down to wet asphalt.
  tracks: { color: '#3a3f48', opacity: 0.85 },

  // The soundtrack (src/audio/, Stage 8). Rendered in one pass at `sr`, then normalized to `targetLufs` integrated
  // with its true peak (4x oversampled) under `ceilingDb`. Bus levels in dB before normalization. The fades match the
  // picture's (seconds). The reverb is a Freeverb standing in for the PS1 SPU's reverb unit.
  audio: {
    // The sound's stage (SOUND-PLAN 4.4), as `stage` is the picture's: 'blockout' (placeholders at the cue times,
    // src/audio/layers/blockout/, Sound 2 and 3) or 'design' (the first-pass layers below, kept as they are until
    // Sound 4). `parked` names layers kept in the code and out of every render: the score, until its own plan (3.1).
    stage: 'blockout',
    parked: ['score'],
    sr: 48000,
    targetLufs: -16,
    ceilingDb: -2.0,
    masterHighpassHz: 35,
    fadeIn: 3,
    fadeOut: 1.5,
    buses: { amb: -9, fx: 0, music: -3 },
    reverb: { room: 0.8, damp: 0.5, width: 1, predelayMs: 25, returnDb: -4 },
    ambience: { windGain: 0.5, bridgeWindBoost: 0.35, cityGain: 0.06, humGain: 0.02, riverGain: 0.9 },

    // Sound 2.12's options, each an A/B against today's mix that the blockout's voices and the spatializer read
    // (ROADMAP Sound 2.12, SOUND-PLAN 3.4, 3.6, 3.7, 3.13). Every switch is off here, and off renders today's bytes;
    // scripts/sound-options.js turns one on at a time, renders it and measures it. The values beside each switch are
    // starting values, with the reason for each in review/round-05/notes-options.md.
    options: {
      // A muffle on a hidden source, the PS1 way (the SPU has no per-voice filter): mode 'volume' drops the voice's
      // volume by dropDb while the picture hides it; 'swap' crossfades it to a copy of itself through a fixed
      // lowpass at lowpassHz (two 2-pole sections), the pre-filtered sample a PS1 bank would hold; either moves over
      // rampSec. 'off' does neither. The hidden state is the picture's, handed in by the options script only.
      muffle: { mode: 'off', dropDb: 6, lowpassHz: 900, rampSec: 0.05 },
      // A narrower pan for sync foley: the pan times widthRatio for the cues of the kinds named (a family, or a
      // family and its meta.kind): the steps, the scuffs and the hands' contacts.
      syncPan: { on: false, widthRatio: 0.5, kinds: ['feet', 'scuff', 'moves.rest', 'moves.cup'] },
      // Who hears the level: 'camera' (today) or 'characters' (src/audio/listeners.js); the pan is the camera's either way.
      listener: 'camera',
    },

    // the car layer (src/audio/layers/car.js): each part's gain
    car: { level: 1.6, exhaustGain: 1, intakeGain: 1.6, tyreGain: 1, brakeGain: 2.2, settleGain: 0.16, doorGain: 0.16, keyGain: 0.16, tickGain: 0.04 },

    // the foley layer (src/audio/layers/foley.js): the layer's level and each part's gain
    foley: { level: 1, stepsBy: 'AB', stepGain: 0.8, rustleGain: 0.25, lighterGain: 0.35, dragGain: 0.2, breathGain: 0.9 },

    // the score (src/audio/layers/score.js): the layer's level and each instrument's gain
    score: { level: 0.8, padGain: 1, subGain: 0.35, bellGain: 1 },
  },

  // Stage 7 deliverables (scripts/finals.js). stills: shot number to the time of its best frame (a shot not listed
  // uses its middle). thumbs: 1280x720 candidates, each the frame at t upscaled `scale` times (3 or 4, nearest)
  // and cropped around (cx, cy), fractions of the frame from the top left; no text, room left for a title.
  finals: {
    // a gentle shadow lift for the thumbnails only (an ffmpeg curves spec): they are judged at 320 px in a bright grid
    lift: '0/0 0.15/0.24 0.5/0.62 1/1',
    stills: { 1: 4.5, 2: 11, 3: 18.5, 4: 27.5, 5: 35.6, 6: 44.5, 7: 50, 8: 57, 9: 66, 10: 74, 11: 79.3, 12: 86, 13: 92.5, 14: 98.5, 15: 108 },
    thumbs: [
      { name: 'thumb-A-moonrise', t: 74, scale: 3, cx: 0.5, cy: 0.5 }, // the crescent over two figures at the rail, the lamp's cone
      { name: 'thumb-B-lighter', t: 79.3, scale: 4, cx: 0.62, cy: 0.48 }, // A's face in the flame, B's red beanie
      { name: 'thumb-C-final-wide', t: 108, scale: 4, cx: 0.47, cy: 0.52 }, // the pair at the rail under the lamp
    ],
  },

  // The falling snow (src/fx/snow.js): flake count, the box it wraps in around the camera (meters), fall speeds (m/s),
  // flake sizes in pixels.
  snow: { count: 12000, box: [40, 18, 40], fallMin: 0.5, fallMax: 0.9, sizePx: [1, 2] },
};

export function readParams(search = '') {
  const p = new URLSearchParams(search);
  return {
    capture: p.get('capture') === '1',
    overlay: p.has('overlay') ? p.get('overlay') !== '0' : CONFIG.overlay,
    t: p.has('t') ? Number(p.get('t')) : null,
  };
}
