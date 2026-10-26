# Prompt: a film's sound, from plan to the blockout render

Paste into a new Claude Code session that has this repo, after filling in the brackets. It runs a film's sound effects
through the same gated stages as its picture (plan, storyboard, blockout) and ends at the director's first listen: a
captioned blockout preview and the full-resolution film with the blockout sound, every planned sound a placeholder at its
exact time, place and level. Snow, Lamp, Bridge did this in Sound 0 to Sound 2 (review rounds 04 and 05); its files are
the worked example and the tools to copy.

Before pasting:
- The picture should be final (its Stage 7 done). If not, the session stops and asks.
- Until draft PR #1 merges, the worked example and the newer engine exist only on branch
  `claude/snow-lamp-bridge-sound`, not on `main`. The prompt tells the session to check.
- For Snow, Lamp, Bridge itself this is done (review/round-05). Continue it with `continue-film.md` and the gate answers.

```
Sound effects first, for the film in films/[slug] of agent-cutscene-studio (this repo). The score is parked: no music
until its own plan. Use the same workflows as the picture: plan the sounds, storyboard them, then do a blockout, and stop
at Sound gate 2 with the render and the questions. Do not go straight to designed sounds.

BEFORE ANYTHING
- Check the worked example is here: films/snow-lamp-bridge/SOUND-PLAN.md and template/src/audio/. If either is missing,
  git fetch origin claude/snow-lamp-bridge-sound, start your branch from it, and tell me you did.
- Read: CLAUDE.md; playbook/process.md and playbook/rules.md; films/[slug]/README.md, PLAN.md, ROADMAP.md,
  src/CONTRACT.md, the end of BUILD_LOG.md and its newest review/round-NN/notes.md. Then the example:
  films/snow-lamp-bridge/SOUND-PLAN.md (1.2 maps every picture stage and artifact to its sound twin), the "Sound stages"
  in its ROADMAP.md (Sound 0 to 6, each step with its check), review/round-04/notes.md, review/round-05/notes.md and
  findings.json (what each stage delivered, the rulings, the known items, what the checkers and the panel found), and
  its BUILD_LOG.md from "Sound stages (effects first)".
- Run npm ci, npm test and npm run check in films/[slug] for a green baseline.
- The picture must be final (its Stage 7 done, its export verified). If it is not, say so in three lines and stop:
  locking it is my decision.
- The film's 1080p export must exist before you touch src/audio or config.js: its name is DEFAULT_OUT.full in
  scripts/capture.js (out/film.mp4 in a template film; read it, do not derive it from the slug). out/ is not in git, so
  in a fresh clone run npm run export and npm run verify now, while the film still renders today's sound. Record its
  video stream MD5 and out/sound.wav's sha256 in BUILD_LOG.md: the picture every Sound 1 panel decodes, and the sound the
  'design' stage must reproduce byte for byte. Never run npm run export after the stage switch.
- Then tell me in three lines where the film stands, and work.

PORT THE TOOLS (only into films/[slug]; template/, playbook/ and CLAUDE.md stay as they are until Sound 6.5, whatever
CLAUDE.md says about engine improvements; write that choice in BUILD_LOG.md)
- The template's audio engine predates Sound 0, so the commands below fail on a template film until you port it.
  Diff each pair against films/snow-lamp-bridge and port the example's changes, keeping this film's own values (its
  DEFAULT_OUT, its layers): src/audio/index.js (stages, parking, makeContext's cues), loudness.js (targetOf, a target per
  stage), spatial.js (the axis guard), listeners.js; scripts/sound.js (--stage, --parked, the limiter report),
  capture.js with lib/captions.js (--captions, --burn-captions, the text track's enabled bit cleared when burned),
  verify.js (check 5 reads the sidecar's stage and parked), lib/audio-analysis.mjs, lib/raster.mjs; the picture's
  storyboard libs lib/draw.js, map.js, panel.js and checks.js if this film lacks them. Then copy the Sound 1 and 2
  scripts and their tests, and repoint every import of the example's picture modules (src/set/build.js, src/actors/,
  src/fx/footprints.js) at this film's. Each port is its own gated commit.
- config.audio.parked is ['score'] if the film has a score layer, otherwise [] (say so). 'design' is whatever the film
  renders today; if it has only the template's example ambience, the drift report may be empty: write that, do not
  invent layers.
- The example's scripts hard-code its rounds (04, 05), its export name, its review captions and its loud and dense
  moments (sound-preview.js LAG_WINDOWS and BAND_WINDOWS; it reads round 05's WAV and round 04's VTT whatever --round
  says). Give them flags or this film's values. Rounds continue the film's series: Sound 1 takes the next free number in
  films/[slug]/review/ and Sound 2 the one after; below they are called S1 and S2 (pass the numbers, for example 06).

THE STAGES (ROADMAP "Sound stages" in the example has every step and its check)
- Sound 0, plan: films/[slug]/SOUND-PLAN.md and the Sound stages in its ROADMAP.md. The feel, the sound arc per beat,
  what "sound effects" means here (backgrounds, ambiences, hard effects, foley), the sync reference, the listener (the
  camera), perspective at cuts, off-screen and hidden sounds, PS1 voices, loudness. The level plan sets each kind of
  sound over the background AND against the beat's lead sound: what the feel calls the loud thing stays louder than
  everything after it, and every relative rule (the idle under the drive, nothing louder than the arrival) gets its own
  measure in Sound 2, read by body from the stems. (The example set every sound only against the night, and its people
  came out louder than its car.) Measure before planning: probes that import the film's modules. Every open question
  gets a default; my questions travel to Sound gate 2, so gates 0 and 1 run on their defaults: do not stop at them.
- Sound 1, storyboard: src/audio/cues.js, the one cue catalogue, DERIVED from the picture's data (world.js, set.js,
  shots.js and whatever modules pose this film's actors and props), never typed, each cue with its time, place, law,
  level and the data it came from, frozen. A sync cue's time is the instant the picture first draws its event (a rig
  contact, the first frame a part moves), never an animation key or a speed threshold: all 12 of the example's sync
  misses came from those. A sound you are unsure of goes in as "offered" (listed, off, captioned), a sound for an action
  no earlier mix played as "new", so I take or drop them at the gate. Adding an export to a picture module so cues.js can
  read a value is allowed when the built HTML and every frame are unchanged (check:determinism, check:cameras, verify);
  never copy a picture value into cues.js by hand. Then the checks with planted faults (example: lib/sound-checks.js,
  sound-report.js, the perturbation trace), the drawings (sound-storyboard.js and its libs: map, detail maps, timeline,
  a panel per shot, contact sheet), the captions and the spotting reel (spotting-reel.js, pointed at this film's export).
  Review round S1, notes, commit.
- Sound 2, blockout: config.audio.stage ('blockout' by default; today's mix stays as 'design', byte identical) and
  config.audio.parked. Placeholder layers that read only cues.js: one obviously temporary timbre per family, each voice
  its own seeded noise, each family in a band clear of every family that sounds at the same moments (checked per third
  octave at each cue, not only by spectral centroid), every placeholder (backgrounds too) with energy between 500 Hz and
  8 kHz so it survives a phone speaker, and no two voices playing one waveform in phase. Then: measure.json (sound-review.js
  --measure: the renderer on each cue rendered alone, sync against the picture, pan, levels, loudness series, silences,
  voices, density, masking per band, phone and mono for every cue backgrounds included, determinism, stems, the drift of
  the parked layers, the loudness target, and every relative rule of your level plan); the options your plan leaves open,
  each measured before asking (rewrite sound-options.js for them; the example had a muffle on hidden sources, a narrower
  pan for sync foley, the characters as the listener, and the style-frame scene); the audio stills and the arrangement
  sheet (--stills --sheet); the preview; your own self-review written into notes.md before the panel sees anything; an
  independent panel; one fix round; the gate.

THE RENDER WITH SOUND
- node scripts/sound.js --out out/round-S2/blockout.wav (the blockout at its stage's target).
- The gate preview: node scripts/capture.js --profile preview --audio out/round-S2/blockout.wav --captions
  review/round-S1/captions/review.vtt --burn-captions --out review/round-S2/preview.mp4, then node
  scripts/sound-preview.js --round S2 --wav out/round-S2/blockout.wav (with the VTT and windows set for this film): one
  video, one audio and one subtitle stream of the film's length; the audio 0 to 2 samples from its WAV; nothing drawn in
  the bottom ninth of the frame (30 px at 480x270); the soft subtitle track not the default when the captions are burned.
- The full-resolution film with the blockout sound. scripts/mux.js replaces the file it is given and has no --out, so
  never point it at the export. Copy the export and its .json sidecar to out/round-S2/[slug]-blockout-1080p.mp4 (and
  .json), then node scripts/mux.js --file out/round-S2/[slug]-blockout-1080p.mp4 --audio out/round-S2/blockout.wav
  (video copied, its MD5 checked, AAC 320 kbps), then node scripts/verify.js --file out/round-S2/[slug]-blockout-1080p.mp4
  --audio out/round-S2/blockout.wav (the lag in three windows, loudness, true peak).
- Every video gets a thumbnail checked at 320 px wide. The preview, the reel, the clips and the blockout film are review
  copies of this film: they use its titled thumbnail, packaging/thumbnail.jpg, checked again at 320 px and named in the
  notes. If the film has none, make it first (playbook/process.md Stage 7).
- Send me the MP4s, and publish a private gate page (Artifact; adapt the picture's scripts/blockout-page.js, or write
  one, and commit the generator): the preview first, with a line to turn the volume up for the phone listen (the
  blockout plays well under YouTube's level); the known items, so I do not judge them as faults, before you ask for my
  notes; then each question in plain words (no "muffle", "sync foley", "listener", "style frame"), naming exactly which
  sounds each answer changes and what it commits to, linked questions asked together, with its clips, where to listen
  in each (seconds in) and how loud it plays against the preview, and its default; your rulings as one question, above
  all any that bends one of my rules; the evidence; my answers saved to the page's store so you can read them back.

HOW TO WORK (what made Snow, Lamp, Bridge's sound right)
- The same multi-agent workflows as the picture. playbook/workflows/ holds them as Snow, Lamp, Bridge scripts: keep the
  shape, rewrite the content. Research, draft and critique for the plan. Builders in parallel git worktrees
  (node_modules symlinked; small gated commits, each with its BUILD_LOG before and after entries and the gate's exit
  codes and counts), each followed by an independent checker that re-runs everything and tries to break it, then a fix
  pass; merge each branch yourself and gate the merged tree. For the review, restructure review-with-skeptics.js into
  reviewers by shot group with every lens (timing, placement, perspective, masking and density, story beats, phone and
  mono) plus one on the decisions and the questions, a skeptic per reviewer, and a completeness critic at the end
  (review/round-05/notes.md describes the example's panel).
- Every check ships with a planted fault shown to fail. Nothing estimated is written as measured; a bar is the plan's
  or set from a measurement, otherwise labelled a starting value (45 ms for sync is one: ITU-R BT.1359). Measure every
  option before asking: an A/B that measures under 1 dB in level or 0.1 in pan at the cue is yours to decide. Master
  each A/B pair through one static gain and no limiter, so A and B differ only by the option.
- Agents cannot hear, so every finding cites a measurement or an image. Every drawing (storyboard, stills, arrangement)
  is tested by reading back what it draws against the data, with measured and predicted kept apart, its committed images
  held to content hashes, and looked at by you at full size and at 390 px.
- Measure on stems before the master: the limiter changes levels. Choose the blockout's loudness target by measurement
  (the example: -23 LUFS, the loudest at which no 400 ms window loses more than 1 dB to the limiter) and say what binds
  it (there, one placeholder click); re-choose it when the placeholders change.
- Traps already hit: a renderer measure on a shared stem misses misplaced cues (read each cue rendered alone); a cue on a
  frame's own time reads one sample after it, so sync fails it by 0.02 ms (the example ruled within 1.5 samples on its
  frame, and said so); the sound's fades may not match the picture's (measure them); notes written on a branch go stale
  after a later fix (mark them superseded); usage limits stop agents mid-task (small commits, resume from the worktree);
  tool calls time out at 10 minutes (run long jobs in the background and poll a status file); a pipe hides exit codes;
  pkill -f kills its own shell.
- Keep writing your rulings, the known items, the tests you changed with their reasons, and what is carried to Sound 3,
  in review/round-S2/notes.md and findings.json (each finding with a verdict and a disposition).

RULES (mine, not optional): no em dashes or en dashes anywhere, in files, commits, PR text or chat; log every step in
BUILD_LOG.md before and after; commit only after npm test && npm run check pass, in small steps; never put a model name in
a commit, a file or a comment, including the co-author trailer the harness asks for: write it as
"Co-Authored-By: Claude <noreply@anthropic.com>" and give every builder, checker and reviewer that commits the same line;
the picture is locked, so anything that would change a frame comes to me as a decision; do not stop between stages unless
the decision is genuinely mine; open a draft PR and never watch it or schedule check-ins on it (if the harness subscribes
you, unsubscribe); every video gets a thumbnail checked at 320 px.

Stop at Sound gate 2: the MP4s sent, the gate page published, everything committed and pushed. Then tell me in a few
lines what to watch, how, and which questions matter most, each with your default.
[Anything new: notes, the film's own sound wishes]
```
