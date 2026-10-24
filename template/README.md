# PS1 Film

A film made from the agent-cutscene-studio template: a three.js scene with a PlayStation 1 look, where every frame is a
pure function of time, rendered frame by frame into an MP4. The example scene (a street lamp in falling snow, three
shots, 12 seconds) is there to be replaced.

## Quick start

Needs Node 20 or later, ffmpeg and ffprobe on the PATH, and Chromium for Playwright (`scripts/lib/raster.mjs` finds
it; set `CHROMIUM_PATH` if it does not).

```
npm ci
npm run dev              # live playback in the browser (Space, arrows, [ and ], D for the overlay)
npm test                 # unit and browser checks, each with a planted-fault control
npm run check            # forbidden clocks and dashes, build, determinism, cameras
npm run review -- --round 01   # first, middle and last frame of every shot, and a contact sheet, in review/round-01/
npm run export           # build, then capture out/film.mp4 (1920x1080, 24 fps, H.264, no audio)
npm run verify           # probe, frame match against fresh renders, seeks, timing
npm run finals           # out/stills/ and three thumbnail candidates in out/thumbnails/
node scripts/capture.js --profile 4k && node scripts/verify.js --profile 4k   # 4K from the same build
python3 scripts/title-thumbnail.py <base.png> packaging/thumbnail 4 <x> <y> <size> <gap>   # title on a thumbnail
```

## Where things go

| File | What it holds |
|---|---|
| `src/set.js` | the layout in meters (+Y up, north is -Z, east is +X) |
| `src/world.js` | the film's length, the fade, every timing as a pure function of t, and the landmarks the camera check compares |
| `src/shots.js` | the shot table: times, lenses, camera keys (a target, or a frame spec that puts a point at a place in the frame) |
| `src/scene.js` | everything the camera sees: built once, posed from t (split it into `src/set/`, `src/actors/`, `src/fx/` as it grows) |
| `src/config.js` | every tunable value: resolution, PS1 look, lights, effects, deliverables |
| `src/ps1/` | the PS1 look: vertex snap and affine warp (material patch), colour depth and dither (final pass) |
| `src/CONTRACT.md` | the rules every module follows, and the window API the scripts use |
| `PLAN.md`, `ROADMAP.md`, `BUILD_LOG.md` | the plan, the stages, and the record of every step |

The process (stages, review gates, rules) is in the repo's `playbook/`.
