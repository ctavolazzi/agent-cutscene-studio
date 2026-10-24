# Techniques

The things that worked in Snow, Lamp, Bridge, with where to find them in `films/snow-lamp-bridge/`.

## The PS1 look (`src/ps1/`)

- **Vertex snap** (`material.js`): after projection, each vertex lands on the internal pixel grid
  (`floor(ndc * res / 2 + 0.5) / (res / 2)`), so edges step and shimmer as the camera moves. Applied with
  `onBeforeCompile` to every Lambert and Basic material, sharing one uniform object.
- **Affine warp** (`material.js`): texture coordinates interpolate in screen space (pass `uv * w` and `w`, divide per
  fragment), so textures bend across large polygons the way the PS1's did.
- **Colour depth and dither** (`post.js`): the scene renders to a half-float target at 480x270; one pass applies the
  fade in linear light, converts to sRGB, then cuts each channel to 5 bits with a 4x4 Bayer dither fixed to the pixel
  grid. The canvas is upscaled by an integer factor with nearest filtering (4x to 1080p, 8x to 4K).
- **Textures** (`src/textures.js`): 64 px grey detail maps from a seeded PRNG, nearest, no mipmaps, tinted by the
  material colour, with world-space UVs so every surface has the same texel size in meters.
- What is not emulated yet (the next upgrade, playbook/prompts/ps1-upgrade.md): per-vertex Gouraud lighting and
  depth-cue fog, palettised textures, the PS1's own dither matrix, low-poly characters, stepped animation.

## Cameras (`src/shots.js`)

- A key can give `frame: { P, sx, sy }` instead of a target: the camera aims so world point P lands at (sx, sy) of the
  frame. Composition survives lens and position changes.
- `ease: 'spline'` passes smoothly through inner keys with a monotone cubic (no overshoot, holds stay still).
- `scripts/check-cameras.js` proves the built three.js cameras match the math (landmarks from `world.js`), with
  planted aim and roll faults.

## Finding a camera move by search

Shot 5 needed a move that turned from a car door toward a bridge while a wheel 2.25 m away sat right between the two
views. Instead of hand-tuning: write the requirements as checks over every frame (wheel share of the frame, the
walking feet in frame and not hidden by the car, both headlight patches visible at the cut, peak pan rate, distance
from the car, camera height), score candidate keys with a cost, random search plus local refinement over four seeds,
then round the winner and look at it. Every seed found the same family of moves. The scratch scripts are described in
`BUILD_LOG.md` (S3 round 2, shot 5).

## Details derived from the animation

- **Footprints** (`src/fx/footprints.js`): sample each rig every 1/48 s once at build; a shoe that comes back down to
  standing height after being lifted makes a print at that moment, under the shoe. The first version looked for an
  ankle that stopped moving, but procedural walks slide the stance foot; landings worked.
- **Tyre tracks** (`src/fx/tracks.js`): one strip per wheel along its path, segments stamped with the time the wheel
  reaches them; the drawn part is a prefix (`setDrawRange`), so it is a pure function of t.
- **Smoke, flame, ember** (`src/fx/smoke.js`): drawn from the same timing functions as their lights, at the rig's own
  points, so the drawn flame sits where the light is.

## Snow (`src/fx/snow.js`)

A `Points` shader whose brightness comes from the lamp cone, the headlights and the moon. A JS mirror of the shader in
`tests/lights-snow.test.mjs` is compared flake by flake against GPU renders, with planted faults for each term.

## Verifying the export (`scripts/verify.js`)

Probe (size, rate, frame count, duration, codec, pixel format, BT.709 tags, no audio, faststart); decode chosen frames
in one ffmpeg pass, area-average back to the internal resolution and compare with fresh renders (mean error and PSNR);
five seeks; and an identity check (each decoded frame closer to its own render than to a differing neighbour's).
Measure the encoder floor before setting a bar: dithered pixel art sits near 38 dB at any crf.

## Sound (`src/audio/`)

- **Layers add into their own block.** A layer is `{ name, bus, reverb, process(L, R, i0, n) }`, called once per
  256-sample block from the start of the film to the end, so filters may keep state. The mixer sums layers into
  buses, feeds a reverb send, applies the master chain and normalizes the whole film at the end.
- **Hear it from the camera.** `ctx.spatializer(place, law)` pans, levels and darkens a mono voice from where its
  source is relative to the camera at t. Gains ramp across each block, so a cut moves a sound without a click. The
  physical law (6 dB a doubling) buries a car at 26 m under the night; give loud sources a gentle law (the car: 3 m,
  0.6) and intimate ones a close one (foley: 2.5 m, 0.7), the way a film mix does.
- **Derive sounds from the animation.** Footsteps are the prints (`footprintList()`), so they move when the walk does;
  the engine's rpm and throttle follow `carAt`; the flame follows the light's flicker; the paper crackles with the
  ember's level. Merge events that land together (both boots at once is one heavier step), and let a quick step roll
  onto its toe quickly, or its toe masks the next heel.
- **Check timing per source.** Detect onsets on a stem of one source (one person's steps, one part of the car) with a
  minimum gap shorter than the shortest step; a control with the schedule three frames early must fail.
- **Normalize with the limiter's loss in the loop.** Limiting a transient takes its energy out of the measurement, so
  a single pass lands short of the target: correct the gain and limit again from the unlimited signal. Limit on the
  true peak (4x oversampled), not the sample peak: snow crunches put inter-sample peaks 0.9 dB over a sample ceiling.
- **Watch the low end.** An octave-band check found 63 Hz as the loudest band (a sub-bass and an idling engine's 26 Hz
  fundamental): high-pass the fundamental out of the engine and keep the sub low; the master high-passes at 35 Hz.
- **Silence is a floor, not zero.** A filter's tail decays toward zero without reaching it; "silent" means under
  -100 dBFS.
- **The player.** Render in a worker (`?worker&inline`, so the single HTML file keeps working from disk); start audio
  from a click or key (browsers require it); while it plays, take the picture's time from the audio clock minus the
  output latency, and restart the source on every seek. Chromium and Node agree on all but a few samples, by one
  float32 step: test the player against the export to that tolerance, not byte for byte.
- **The export.** Mux the WAV as AAC-LC 48 kHz stereo trimmed to exactly the captured frames; verify it against the
  WAV by cross-correlation (lag 0, correlation over 0.99 at 320 kb/s), loudness and ffmpeg's true peak.

## Thumbnails

`npm run finals` crops three candidates from strong frames at an integer upscale (3x of 480x270 is 1440x810, cropped
to 1280x720; 4x crops tighter) with a gentle shadow lift for the thumbnails only. `scripts/title-thumbnail.py` sets a
title in pixel lettering (drawn at a quarter size without antialiasing, outlined, upscaled nearest). Judge every
candidate at 320 px wide.

## Working with agents

- Parallel builders each in their own git worktree, a checker behind each, merged one at a time behind the full gate.
- Independent reviewers with one lens each, and a skeptic per finding that tries to refute it.
- Long runs and subagents can stop on usage limits: commit small, and recover a stopped builder's work from its
  worktree diff (`git diff > patch`, `git apply` on the main branch, then check it yourself).
