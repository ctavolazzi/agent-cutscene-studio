# The process

How Snow, Lamp, Bridge was made, written so the next film can follow it. A person (the director) owns the story and
the decisions at each gate; Claude Code plans, builds, measures, reviews and reports. Each stage ends at a gate: a
short package of stills, measurements and numbered decisions with a recommended answer for each. Between gates the
work keeps moving without check-ins.

Start a film with `node tools/new-film.mjs <slug> "Title"`, then work inside `films/<slug>/`.

## Stage 0: Plan

Write `PLAN.md` (the template has the skeleton): the brief in one sentence, length and delivery, story beats on one
clock, the shot list (time, lens, framing, move, action), the set in meters, characters, the fixed list of lights,
rules, deliverables, and open questions each with a recommended answer. Write `ROADMAP.md` from the stage list below,
specific to the film. Log it in `BUILD_LOG.md`.

Gate 0 is the plan itself: the director answers the questions.

## Stage 1: Storyboard

Before any 3D, check the film on paper. Snow, Lamp, Bridge's `scripts/storyboard.js` draws a top-down map of the set
with every camera, its field of view and its move, one SVG panel per shot from the real camera math
(`scripts/lib/map.js`, `panel.js`, `checks.js`), and a report that checks the 180 degree line, screen direction across
cuts, cut angles and size steps, and whether anything important falls in the bottom 120 px of a 1080 frame (YouTube's
progress bar). Copy and adapt those files for a new set; they are the film's own because the map draws its set.

Gate 1: the map, the panels, the report and any shot that fails a check.

## Stage 2: Blockout

Everything live in grey boxes: the set from `src/set.js`, characters as capsules with a facing cue, every light
present (never added later), every timing from `src/world.js`, every camera from `src/shots.js`, the fade, the debug
overlay, stills, capture. Then a review round:

1. `npm run review -- --round 02`: first, middle and last frame of every shot at 4x, phone copies, a contact sheet.
2. An independent review of the stills: one reviewer per lens (staging, cameras and continuity, light and readability,
   story beats), each finding put to a skeptic who tries to refute it (playbook/workflows/review-with-skeptics.js).
3. Measure every decision before offering it. Snow, Lamp, Bridge's `scripts/gate2-measure.js` is the example: lamp
   reach, a wheel's share of the frame, two people's overlap, all computed from the real data, plus test renders at
   the moments in question. Two of the first options offered at Gate 2 were wrong until measured.

Gate 2: notes with every finding and its disposition, the decision frames, the measurements, the recommended set.

## Stage 3: Revisions

Apply the answers. Independent changes can run in parallel, each builder in its own git worktree with a checker
behind it (playbook/workflows/builders-with-checkers.js), then merge and gate each one. Builders can stop on usage
limits: commit small, and be ready to finish a builder's work yourself from its worktree diff.

## Stage 4: Look

The PS1 pass is already in the template (`src/ps1/`): vertex snap to the internal grid, affine texture warp, colour
cut to 5 bits a channel with a 4x4 dither, nearest upscale. Add procedural textures (`src/textures.js`, seeded,
world-space UVs), fog, tuned lights, glow cards and light cones, blob shadows. Look at key stills at full size and phone
size side by side. Gate 3.

## Stage 5: Animation and effects

Characters and props from pure functions of t; derived details computed once from the animation itself (footprints
from the rig's landings, tyre tracks from the car path) so they follow any later change; particles; the playback UI;
`npm run export` and `npm run verify`. Self-review a frame every 2 seconds from the MP4 at phone size. Gate 4.

## Stage 5.5: Sound

A film has a soundtrack unless the brief asks for silence. It is made the way the picture is: synthesized in code
(`src/audio/`), seeded, rendered in one pass over the whole film, timed by the same data that times the picture and
heard from each shot's camera. Snow, Lamp, Bridge is the worked example (its `SOUND.md`, `src/audio/layers/`,
`tests/sound-layers.test.mjs`).

1. `SOUND.md`: the feel in a paragraph, then a cue sheet built from `world.js` (every event, its time, the function it
   comes from, the layer that plays it), where each source sits, and the score as a table of times, chords and notes.
2. One layer per kind of sound in `src/audio/layers/`, each with its own block in `config.audio`, so builders never
   touch the same lines. Positions come from the functions the picture uses (`carAt`, a rig's joints, the prints);
   one-shots go through `src/audio/events.js`.
3. Measure every stem before mixing (`scripts/lib/audio-analysis.mjs`): short-term loudness per window against the
   bed, window peaks, octave bands, the spectrogram (`npm run sound -- --spectrogram`), onsets against the cue sheet,
   stereo balance against the pan the camera predicts.
4. Write the brief's balance as tests (the loud thing over the bed by so many LU, the score under it on entry), then
   set bus and layer gains to pass them. The master: -16 LUFS integrated, true peak at or under -1.5 dBTP (ffmpeg's
   ebur128 is the reference meter).
5. `npm run export` renders `out/sound.wav` and muxes it as AAC; `npm run verify` checks that the WAV is today's
   render and that the MP4's audio is in sync with it. The player renders the same samples in a worker.
6. Gate: the director listens to the 1080p MP4. Measurements say the sound is correct; only ears say it is good.

## Stage 6: Polish rounds

Notes become a numbered list with the file each touches; fix, re-run every check, a fresh review round
(`--round NN`) with notes. Repeat as needed.

## Stage 7: Final

1. `npm run export` once from a clean build (it renders the sound first); the 4K capture
   (`node scripts/capture.js --profile 4k --audio out/sound.wav`) and `npm run finals` from that same build.
2. `npm run verify` and `node scripts/verify.js --profile 4k`.
3. Thumbnails: three candidates from the strongest frames, each checked at 320 px wide; then a titled thumbnail
   (`scripts/title-thumbnail.py`) saved to `packaging/thumbnail.jpg`, checked at 320 px. Every video gets one.
4. README: deliverables, how to re-export, playback keys, every config value, the shot list with timings.
5. A final review round whose `notes.md` checks the "done means" list item by item, and names what was left as is.
6. Commit, push, update the PR. The MP4s are too big for git: attach them to a GitHub release.
7. YouTube packaging: description with chapters (YouTube needs at least 10 s a chapter, so group short shots), title,
   thumbnail (playbook/prompts/youtube.md).

## Tooling notes

- Rendering is headless Chromium with software WebGL (SwiftShader): about 100 ms a frame for a 1080p capture and
  200 ms at 4K on 4 CPUs. A 112 s film exports in about 4.5 minutes at 1080p and 9 at 4K.
- Look at frames with the Read tool; tile them with ffmpeg `hstack` and `vstack`; lift dark frames
  (`curves=all='0/0 0.25/0.6 1/1'`) to judge staging, but judge the look on the real frame.
- Everything in `out/` is rebuildable and ignored by git. Commit review stills (small), never MP4s.
