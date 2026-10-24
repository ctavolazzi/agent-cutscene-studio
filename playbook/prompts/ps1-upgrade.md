# Prompt: upgrade a film to a true PS1 cutscene look

Written for Snow, Lamp, Bridge after it shipped. Paste it into a new Claude Code session that has this repo. For
another film, change the folder, the reference times and the "known issues".

```
You are taking over "Snow, Lamp, Bridge" in agent-cutscene-studio (this repo), folder films/snow-lamp-bridge/: a finished
112-second silent night scene in three.js with a PS1-inspired look. Upgrade its visuals until it reads as a true
PlayStation 1 in-engine game cutscene (think Metal Gear Solid, Final Fantasy VIII and IX field scenes, Silent Hill,
Resident Evil 2), without changing the story, the shot list or the timings. Work on the branch this session is given
and open a draft PR to main.

READ FIRST, IN ORDER
1. CLAUDE.md and playbook/rules.md (repo root)
2. films/snow-lamp-bridge/README.md, then src/CONTRACT.md, src/config.js, src/ps1/material.js and src/ps1/post.js
3. BUILD_LOG.md from Stage 4 on, review/round-03/notes.md and review/round-03/contact-sheet.png
4. PLAN.md and ROADMAP.md (skim)
Then run npm ci and npm test in films/snow-lamp-bridge for a green baseline, and render baseline stills to compare
against later:
node scripts/stills.js --times 4.5,11,18.5,27.5,35.6,44.5,50,57,66,74,79.3,86,92.5,98.5,108 --outdir out/baseline --scale 4 --overlay 0

RULES (the director's; follow them exactly)
- Commit and push only to your branch; keep the PR a draft; never subscribe to or watch PR activity.
- No em dashes or en dashes anywhere: files, commit messages, PR text, chat (check:forbidden enforces files).
- Log each step in BUILD_LOG.md before and after taking it.
- Commit only after npm test && npm run check both pass. Never loop over test files with a for-loop. Commit in small
  gated steps; long runs and subagents can stop on usage limits.
- Never put a model name or identifier in commits or the PR.
- Every video gets a thumbnail, checked at 320 px wide.
- No review stops between stages unless a decision is genuinely the director's. Show progress with frames.
- A test that pins the old design is rewritten to check the same property on the new design, never loosened
  silently; record why in BUILD_LOG.md.

CONSTRAINTS FROM THE CODE
- Every frame is a pure function of t: no Math.random, Date.now or timers in src/ outside the playback block in
  src/main.js; seeded randomness via rngFor(name). check:determinism compares bytes across draw orders and pages.
- Exactly seven lights (hemi, lamp, two headlights, moon, lighter, ember), pinned by tests/lights-snow.test.mjs. The
  snow Points shader has a JS mirror in that test, compared flake by flake against the GPU: update the mirror with any
  snow shader change.
- Tests that will break on purpose and must be rewritten honestly: tests/ps1.test.mjs (every pixel on a 5-bit level),
  tests/set.test.mjs (material luminance ratios), tests/checks.test.mjs and check:cameras (landmarks),
  tests/capture.test.mjs.
- Everything tunable lives in src/config.js. Footprints and tyre tracks are derived from the rig and the car path;
  re-check them if foot geometry or animation timing changes.

WHAT THE PS1 EMULATION DOES TODAY
480x270 into a half-float target; final pass: fade, sRGB, 5 bits a channel, 4x4 Bayer dither; nearest upscale 4x
(1080p) and 8x (4K). Vertex snap and affine warp on Lambert and Basic materials only. 64 px grey procedural textures
tinted by material colour. Not emulated: per-vertex Gouraud lighting (Lambert lights per pixel), per-vertex depth-cue
fog (FogExp2 is per pixel), palettised textures, low-poly characters (people are smooth capsules), the PS1's dither
pattern, nearest-filtered sprites (glows use LinearFilter), semi-transparency modes, stepped character animation,
near-plane popping, painter's-order sorting.

THE TARGET
A frame that instantly reads as PS1: low resolution, chunky low-poly characters with texture-baked faces and clothes
and mitten hands, per-vertex lighting that makes stepped Gouraud gradients across subdivided ground (the lamp pool a
blocky blob, not a smooth circle), depth-cue fog toward a colour, small palettised textures that visibly tile, 15-bit
colour with the PS1's own dither, stiff slightly stepped character animation, hard-pixel additive glows. Authentic, not
exaggerated: no wobble beyond integer vertex snapping at the real grid, no heavy CRT effects in the master.
Keep exactly: the 15 shots, their timings and compositions, the story beats, the lamp, moon, lighter, smoke,
footprints and tyre tracks, and the snow mood.

HARDWARE FACTS TO EMULATE (confirm against psx-spx / nocash docs or an emulator source such as Duckstation before relying on them)
- Common display modes 256x240 and 320x240 (NTSC); cutscenes typically at 30 fps or lower.
- No z-buffer: polygons sorted per frame by an ordering table on average Z. No perspective-correct texturing (affine
  per triangle; developers subdivided large polygons). Integer screen coordinates (vertex jitter).
- No texture filtering, no mipmaps; textures in 256x256 pages, usually 4-bit (16 colour) or 8-bit (256 colour) with a
  palette; typical 3D textures 32 to 128 px.
- 15-bit colour (5:5:5). Dithering adds a 4x4 matrix of signed offsets in 8-bit space before truncation to 5 bits;
  the commonly documented matrix is
  -4 +0 -3 +1 / +2 -2 +3 -1 / -3 +1 -4 +0 / +3 -1 +2 -2
  applied to shaded and blended polygons, not to everything.
- Semi-transparency modes: 0.5B + 0.5F, B + F, B minus F, B + 0.25F.
- Lighting and depth cueing per vertex in the GTE (vertex colour blended toward a far colour by depth). Polygons
  crossing the near plane were usually dropped (popping near the camera).

STAGED PLAN (in order, cheap global changes first; for each stage: log, implement, tests with a planted-fault control,
before and after stills at the times above plus a 384x216 phone copy, looked at yourself, gate, commit, push)
1. Image pipeline. CONFIG.res to 320x180 (the letterboxed picture of a 320x240 PS1 frame; config.js already names it
   the 6x option): output 1920x1080 at 6x and 3840x2160 at 12x, every 16:9 composition kept. Re-check framing against
   the baseline, snow pixel sizes (snow.sizePx, nearSize in src/fx/snow.js) and the overlay strip (src/hud.js);
   scripts/finals.js thumbnail crops need scale 4 or more. Replace the Bayer pass with 15-bit colour and the PS1
   dither matrix, behind a config flag. Snap at the new grid, and extend snapping to the custom shader materials
   (glow cones, smoke, snow points). Optional: a 4:3 presentation mode, off by default.
2. Per-vertex lighting and fog. Compute the seven lights per vertex (move the light loop to the vertex shader via
   onBeforeCompile, or a small custom material; fragment = texture times vertex colour); keep the light objects as the
   data source. Subdivide ground, road, sidewalks and deck to about 0.5 to 1 m. Per-vertex depth cueing toward the fog
   colour instead of FogExp2, the city keeping its own far colour. Optional: seeded baked darkening at wall bases.
3. Palettised textures: a 16-colour palette per texture instead of grey times tint, 64 or 128 px; texture door and
   window frames, the lamp post, the lantern, the car (windows, grille, lights), clothes and faces. Test that every
   texel is a palette entry.
4. Low-poly models: people as rigid 5 to 8 sided segments, blocky heads with a face texture, mitten hands, beanie and
   hair shells, A's coat a flared low-poly skirt; keep the rig, poses, timing and the object names tests and footprints
   read; a few hundred triangles a person. Car three-box low-poly with 6 to 8 sided wheels; lamp post 6 sided.
5. Animation and effects: people and car poses sampled at 12 or 15 Hz (config) while cameras and snow stay at 24 fps
   (re-check footprint and track births); nearest-filtered stepped-ring glows with additive blending; smoke as small
   textured sprites at 0.5B + 0.5F; chunky 1 to 2 px snow. Optional, off by default: near-plane popping, an
   ordering-table sort mode.
6. Optional, ask the director first: a location or title card in a pixel font; a subtle composite softness toggle,
   off for the master.

KNOWN ISSUES TO WATCH
Shot 5's hold (30 to 33 s) is very dark at phone size; per-vertex light on subdivided ground may help. B's feet touch
YouTube's bottom 120 px strip by 2 px in shot 7's last frame. Shot 5's wheel crosses up to 5.9% of the frame
(documented and accepted).

DELIVERY
npm run storyboard; npm run review:blockout -- --round 04 with review/round-04/notes.md checking the done-means list
from ROADMAP.md item by item; npm run export then npm run verify (the bars were measured for the current image:
re-measure the encoder floor on a couple of seconds of frames, set the bar from it, and confirm the identity check
still catches a planted one-frame offset); node scripts/capture.js --profile 4k and node scripts/verify.js --profile 4k
from the same build; npm run finals and a new titled thumbnail (scripts/title-thumbnail.py) checked at 320 px; README,
BUILD_LOG and config table updated; gate, commit, push, update the draft PR; send the MP4s and thumbnails as files.

ENVIRONMENT
Headless Chromium with SwiftShader (software WebGL): about 100 ms a frame at 1080p capture, 200 ms at 4K, 4 CPUs.
ffmpeg and ffprobe installed; scripts/lib/browser.mjs opens dist/index.html in capture mode. out/ is ignored by git.
Look at frames with the Read tool on PNGs; tile them with ffmpeg hstack and vstack to compare.
```
