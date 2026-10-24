# Snow, Lamp, Bridge

A silent 112-second night scene in a PlayStation 1 style, built in three.js: a street lamp in falling snow, a car
that arrives and parks, two people who walk onto a bridge, lean on the railing, light a cigarette and watch a
crescent moon rise over the river. It ends on the two of them under the lamp.

**Watch it: https://youtu.be/F02fKQvjlJQ**

Made with Claude Code between 2026-10-21 and 2026-10-23, first in a private workbench repo (the paths in PLAN.md and
the early review rounds still say `_workbench/snowy-bridge/`), then moved here as the first film of agent-cutscene-studio.
The output files keep their original names (`out/snowy-bridge.mp4`).

Every frame is a pure function of time (no clocks, no unseeded randomness; see `src/CONTRACT.md`), so the MP4 and
the HTML player show the same frames, and any frame can be rendered on its own.

## Deliverables

| File | What it is |
|---|---|
| `out/snowy-bridge.mp4` | 1920x1080, 24 fps, 112 s, H.264 `yuv420p`, BT.709 tags, faststart, no audio |
| `out/snowy-bridge-4k.mp4` | the same frames at 3840x2160 (upload this one to YouTube: 4K uploads get a better encode) |
| `out/*.mp4.json`, `out/*.mp4.verify.json` | the capture's record (ffmpeg command, probe) and the verify report |
| `dist/index.html` | the scene as one self-contained HTML file with playback controls |
| `out/stills/shot-NN.png` | one 1920x1080 still per shot, at the time set in `CONFIG.finals.stills` |
| `out/thumbnails/` | three 1280x720 thumbnail candidates (PNG and JPG), each with a 320 px check copy, and `sheet-320.png` |
| `packaging/thumbnail.jpg` | the YouTube thumbnail: the moonrise candidate with the title in pixel lettering (committed; `scripts/title-thumbnail.py` remakes it) |

`out/` is not committed (the MP4s are 40 MB and more); everything in it is rebuilt by the commands below.

## Re-export

Needs Node 20 or later, ffmpeg and ffprobe on the PATH, and a Chromium for Playwright (`scripts/lib/raster.mjs` finds
it; set `CHROMIUM_PATH` if it does not).

```
npm ci
npm test                 # unit and browser checks
npm run check            # forbidden clocks and dashes, build, determinism, cameras
npm run export           # build once, capture out/snowy-bridge.mp4
npm run verify           # probe, frame match against fresh renders, seeks, timing
npm run finals           # out/stills and out/thumbnails from the same build
node scripts/capture.js --profile 4k   # out/snowy-bridge-4k.mp4 from the same build
node scripts/verify.js --profile 4k
```

`npm run export:4k` also works but rebuilds first; capture both from one build when they must match exactly.
`npm run preview` captures a quick 480x270 MP4 with the shot overlay burned in. `npm run storyboard` redraws the
contact sheet in `storyboard/`.

The verify bar: every matched frame within a mean error of 2.5 levels and 36 dB PSNR of a fresh render, and closer to
its own render than to either neighbour's. The 4:2:0 YUV round trip of a dithered image sets a floor near 38 dB at any
crf, so 36 dB leaves margin; the identity test is what proves the right frame is in the right place (BUILD_LOG.md).

## Playback

Open `dist/index.html` (or `npm run dev`). Space or K plays and pauses; Left and Right step one frame (Shift: one
second); [ and ] jump to the previous and next shot; Home goes to the start; D toggles the overlay (shot, time, lens).
The strip at the bottom has a scrub bar and a shot list. `?t=79` starts at 79 s, `?overlay=1` turns the overlay on,
`?capture=1` is the capture mode the scripts use (no clock, no controls).

## Config (`src/config.js`)

| Value | What it does |
|---|---|
| `stage` | `'look'` draws the finished film; `'blockout'` the grey boxes of Stages 2 and 3 |
| `res` | internal resolution, 480x270; everything renders at this size |
| `out` | MP4 size; the nearest-neighbour upscale is `out.w / res.w` (4x) |
| `fps` | 24 |
| `seed` | the one seed every seeded random stream derives from (`rngFor(name)`) |
| `playback.quantize` | the HTML player draws only on 1/24 s ticks, so it shows the MP4's frames |
| `overlay` | the debug strip (shot, time, lens) burned into previews; off for finals |
| `background`, `fog` | sky colour; scene fog density, and the lighter haze on the far city so it reads as a band |
| `near` | camera near plane in meters |
| `ps1` | vertex snap and affine texture warp (0 to 1 each), colour depth in bits per channel, 4x4 Bayer dither |
| `lights` | the seven lights in physical units: hemisphere, lamp, two headlights, moon, lighter, ember |
| `glow` | additive cards on the bulb, headlights and taillights, and the faint visible cones under the lamp and ahead of the car |
| `smoke` | the lighter flame, the ember and the smoke puffs |
| `footprints` | colour and opacity of the boot prints in the snow |
| `tracks` | colour and opacity of the tyre tracks |
| `finals` | the thumbnail lift, the time of each shot's still, and the three thumbnail candidates (time, scale, crop centre) |
| `snow` | the falling snow: flake count, the box it wraps in around the camera, fall speeds, flake sizes in pixels |

The set's layout lives in `src/set.js` (meters, north is -Z, east is +X); people, car and moon timing in
`src/world.js`; the cameras in `src/shots.js`.

## Shot list

| Shot | Time | Length | Lens | Title | Action |
|---|---|---|---|---|---|
| 1 | 0:00 to 0:07 | 7 s | 50mm | The lamp | Fade in from black over 3 s. Snow swirls through the lamp light. Lamp light only. |
| 2 | 0:07 to 0:14 | 7 s | 24mm | The empty street | Nothing moves but the snow. Hold the stillness. The corner building is the dark mass at right. |
| 3 | 0:14 to 0:22 | 8 s | 35mm | Light before the car | Beams sweep the facades first. The car noses out from behind the corner building and turns north. |
| 4 | 0:22 to 0:29 | 7 s | 24mm | The car arrives | The car drives toward the camera and the lamp. Beams fill with lit snow. It stops about 6 m away. |
| 5 | 0:29 to 0:40 | 11 s | 35mm | Feet in the snow | A door opens, a boot lands, prints stay. B lands on the far side, seen under the car. Doors close. Headlights cut at 0:36. Lamp light only. |
| 6 | 0:40 to 0:46 | 6 s | 35mm | The reveal | They stand in the lamp light beside the dark car. They look north toward the bridge, off frame left. |
| 7 | 0:46 to 0:54 | 8 s | 35mm | The walk | They walk toward the bridge, through the lamp pool. Footprints trail behind. |
| 8 | 0:54 to 1:00 | 6 s | 50mm | Onto the bridge | They walk toward the camera onto the bridge. The lamp behind them is a warm rim light on lit snow. |
| 9 | 1:00 to 1:08 | 8 s | 35mm | The railing | They stop and lean forearms on the wide concrete railing. River and the city banks beyond. |
| 10 | 1:08 to 1:16 | 8 s | 85mm | Moonrise | The crescent moon rises over the river between the city banks. They are small at the railing. Moonlight grows into a cool rim. |
| 11 | 1:16 to 1:24 | 8 s | 50mm | The lighter | A turns into the lee and cups both hands. The lighter flickers orange on hands and face. The ember catches. |
| 12 | 1:24 to 1:29 | 5 s | 70mm | B looks | B glances at A, holds the look for a beat, then looks back out at the city. |
| 13 | 1:29 to 1:36 | 7 s | 35mm | Smoke and glance | A exhales. Smoke drifts through lamp light and moonlight. A glance, and the shoulders lean closer. |
| 14 | 1:36 to 1:40 | 4 s | 85mm | Ember and smoke | A quiet beat. |
| 15 | 1:40 to 1:52 | 12 s | 24mm | Under the lamp | Two people at the railing under the lamp, the moon over the river, city lights along both banks, snow drifting. |

## How it is put together

- `src/main.js` builds the scene once and exposes `renderAt(t)`; `src/timeline.js` poses every part for `t` and draws
  through the PS1 final pass (`src/ps1/`). The playback block in `main.js` is the only code allowed a clock.
- `src/set/build.js` the set (with procedural textures from `src/textures.js` and snow on the road, sidewalks and deck);
  `src/actors/car.js` and `src/actors/people.js` the car and the two rigs; `src/fx/` the lights, snow, glows, smoke,
  footprints and tyre tracks. Footprints and tracks are found by sampling the rigs and the car path once at build, so
  they follow any change to the animation.
- `scripts/capture.js` streams frames into ffmpeg; `scripts/verify.js`, `scripts/finals.js`, `scripts/stills.js` and
  the `check-*` scripts work from the built file. `BUILD_LOG.md` records every step, what was measured and what was
  wrong along the way; `PLAN.md` and `ROADMAP.md` hold the plan.
