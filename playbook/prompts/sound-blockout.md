# Prompt: a film's sound, from plan to the blockout render

Paste into a new Claude Code session that has this repo, after filling in the brackets. It runs a film's sound effects
through the same gated stages as its picture (plan, storyboard, blockout) and ends at the director's first listen: a
captioned blockout preview and the full-resolution film with the blockout sound, every planned sound a placeholder at its
exact time, place and level. Snow, Lamp, Bridge did this in Sound 0 to Sound 2 (review rounds 04 and 05); its files are
the worked example and the tools to copy.

```
Sound effects first, for the film in films/[slug] of agent-cutscene-studio (this repo). The score is parked: no music
until its own plan. Use the same workflows we use for the picture: plan the sounds, storyboard them, then do a blockout,
and stop at Sound gate 2 with the render and the questions. Do not go straight to designed sounds.

Read first: CLAUDE.md; playbook/process.md and playbook/rules.md; films/[slug]/README.md, PLAN.md, ROADMAP.md and the end
of BUILD_LOG.md. Then the worked example, films/snow-lamp-bridge: SOUND-PLAN.md (the plan, and the table in 1.2 that maps
every picture stage and artifact to its sound twin), the "Sound stages" in its ROADMAP.md (Sound 0 to Sound 6, each step
with its check), review/round-04/notes.md and review/round-05/notes.md (what each stage delivered, the rulings, the known
items, what the checkers and the panel found), and the Sound 2 part of its BUILD_LOG.md. Run npm ci and npm test in
films/[slug] for a green baseline. Tell me in three lines where the film stands, then work.

THE STAGES (copy the example's tools into films/[slug] and adapt them to this film's set and data; the template has only
the audio engine)
- Sound 0, plan: films/[slug]/SOUND-PLAN.md and the Sound stages in its ROADMAP.md. The feel, the sound arc per beat,
  the level plan (each kind of sound in dB over the background), what "sound effects" means here (backgrounds, ambiences,
  hard effects, foley), the sync reference, the listener (the camera), perspective at cuts, off-screen and hidden sounds,
  PS1 voice limits, loudness. Measure before you plan: probes that import the film's own modules. Every open question
  gets a default. My questions travel to Sound gate 2, so gates 0 and 1 run on their defaults: do not stop at them.
- Sound 1, storyboard: src/audio/cues.js, the one cue catalogue, DERIVED from the picture's data (world.js, set.js,
  shots.js, the actors, the footprints), never typed: each cue with its time, place, law, level and the data it came
  from, frozen. The checks (example: scripts/lib/sound-checks.js and scripts/sound-report.js): trace (a perturbation of
  the picture moves exactly the cues it should), on screen, the story orders, sync (onset 0 to 45 ms ahead of the first
  frame that shows its event), stereo order, perspective at cuts, approach, masking, flams, density, PS1 voices, the
  silences, phone and mono. The drawings (scripts/sound-storyboard.js and its libs): the sound map, detail maps, the
  timeline, a panel per shot, the contact sheet. Captions (scripts/lib/captions.js) and the spotting reel (the silent
  picture with a caption for every planned sound). Review round NN, notes, commit.
- Sound 2, blockout: config.audio.stage ('blockout' by default, the earlier mix kept as 'design' and byte identical)
  and config.audio.parked (['score']); placeholder layers that read only cues.js, one obviously temporary timbre per
  family, each voice its own seeded noise. Then measure (scripts/sound-review.js --measure into measure.json: the renderer
  on each cue rendered alone, sync against the picture, pan, levels, loudness series, silences, voices, density, masking
  per band, phone and mono, determinism, stems, the drift of the parked layers, the loudness target), the four options
  measured before asking (scripts/sound-options.js, with A/B clips), the audio stills and the arrangement sheet
  (--stills --sheet), the preview, my own review written down first, an independent panel, one fix round, the gate.

THE RENDER WITH SOUND (the deliverables of Sound 2)
- node scripts/sound.js --out out/round-NN/blockout.wav (the blockout at its stage's target).
- The gate preview: node scripts/capture.js --profile preview --audio out/round-NN/blockout.wav --captions <the review
  VTT> --burn-captions --out review/round-NN/preview.mp4, then node scripts/sound-preview.js --round NN (one video, one
  audio and one subtitle stream of the film's length; the audio 0 to 2 samples from its WAV; nothing drawn in the
  bottom 30 px; the soft subtitle track not the default when the captions are burned).
- The full-resolution film with the blockout sound: mux the WAV onto the published export with the video stream copied
  (its MD5 unchanged), AAC 320 kbps, into out/round-NN/, and check the lag and the loudness. Never overwrite the existing
  listening copy (out/sound.wav, out/[slug].mp4): at the blockout stage a plain npm run export would.
- Every video gets a thumbnail checked at 320 px wide: the film's titled thumbnail serves its renders; a new video gets
  its own.
- Send me the MP4s, and publish a private gate page (Artifact): the preview first, then each question with its clips and
  its default, the known items, the evidence; my answers saved so you can read them back.

HOW TO WORK (what made Snow, Lamp, Bridge's sound right)
- The same multi-agent workflows as the picture (playbook/workflows/): research, draft and critique for the plan;
  builders in parallel git worktrees (node_modules symlinked, small gated commits), each followed by an independent
  checker that re-runs everything and tries to break it, then a fix pass; for the review, reviewers by shot group with
  every lens (timing, placement, perspective, masking and density, story beats, phone and mono) plus one on the
  decisions, a skeptic per reviewer, and a completeness critic. Merge each branch yourself and gate the merged tree.
- Every check ships with a planted fault shown to fail. Nothing estimated is written as measured; a bar is the plan's
  or set from a measurement, otherwise labelled a starting value. Measure every option before asking; an A/B that
  measures under 1 dB in level or 0.1 in pan at the cue is yours to decide, not mine.
- Agents cannot hear, so every finding cites a measurement or an image: spectrograms, stems, balance, the stills.
- Measure on stems before the master: the limiter changes levels. Choose the blockout's loudness target by measurement
  (Snow, Lamp, Bridge: -23 LUFS, the loudest at which no 400 ms window loses more than 1 dB to the limiter).
- Known traps, already hit once: two placeholder voices playing one waveform in phase add coherently (start each its own
  share of a period apart); the mp4 muxer enables the first text track whatever -disposition says (clear the track's
  enabled bit when captions are burned); a renderer measure on a shared stem misses misplaced cues (read each cue
  rendered alone); notes written on a branch go stale after a later fix (mark them superseded); usage limits stop agents
  mid-task (small gated commits, resume from the worktree); tool calls time out at 10 minutes (long runs in the
  background, poll a status file); a pipe hides exit codes; pkill -f kills its own shell.
- Keep writing the rulings you make, the known items (so I do not judge them as faults), the tests you changed with
  their reasons, and what is carried to Sound 3, in review/round-NN/notes.md and findings.json.

RULES (mine, not optional): no em dashes or en dashes anywhere, in files, commits, PR text or chat; log every step in
BUILD_LOG.md before and after; commit only after npm test && npm run check pass, in small steps; never put a model name in
a commit, a file or a comment; the picture is finished and locked, so anything that would change it comes to me as a
decision; do not stop between stages unless the decision is genuinely mine; open a draft PR and never watch it or
schedule check-ins on it (if the harness subscribes you, unsubscribe); every video gets a thumbnail checked at 320 px.

Stop at Sound gate 2: the MP4s sent, the gate page published, everything committed and pushed. Then tell me in a few
lines what to watch, how, and which questions matter most, each with your default.
[Anything new: notes, the film's own sound wishes]
```
