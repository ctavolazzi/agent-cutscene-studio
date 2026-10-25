# Round 05, the measurement half: Sound 2.5 to 2.7 (branch s2-measure)

For the lead to merge into `notes.md`. Everything below is measured by `node scripts/sound-review.js --round 05
--measure` (4.4 minutes alone on this 4 CPU machine) and written to `measure.json`; a number here that is not in that
file says where it comes from. The blockout is the placeholders of SOUND-PLAN 4.4, so the measures time, place and
count; the levels and the masking are reported, not judged. An independent checker went through the first version of
this work; what it found and what changed is in "The checker's findings" below.

## What is measured, and how

One session renders everything once: the blockout raw (reverb, highpass and fades, no normalization) twice, the mix
before the master stage, one stem per voice group (30) before the master, every voiced cue alone (142; only its onset
and its group's sum are kept, and the render itself for the 18 read alone), the four bodies with reverb, and the parked
design layers' parts. The levels, pans and bands are read on the stems before the master, where a voice is exact zeros
outside the samples it plays, so nothing measured is the limiter's. The loudness series and the target are read on the
full render, raw and normalized.

| Measure | How |
|---|---|
| 1 Renderer | Each voiced cue's onset: the first sample that is not zero of the cue rendered alone, where its voice starts (every voice starts from zero, so one sample after its start), against its cue time; an unplaced background against the first sample `bedSpan` gives it, half the crossfade before t0. Each voice group's stem against the sum of its cues alone, so an onset read alone is where the stem plays it and nothing else sounds there. Any detection (`preciseOnsets` on the stem, the group's gap) outside every cue span of its group fails |
| 2 Sync | The measured onset (the renderer's) judged by `syncOf`: the film's `syncRule` (exported from `sound-report.js`, report.json byte identical) and `showingFrame` from `sound-checks.js`, the bar of check 4 |
| 3 Cue ends | `soundingEnd` from the onset to the next cue of the group (`read` stem) or on the cue alone (`read` alone: a continuous voice that follows another of its group, and the unplaced backgrounds): just after the last sample within 60 dB of the voice's loudest, and the last that is not zero |
| 4 Pan | The balance over the cue's span in its group's stem against `predictedBalanceDb` (placeAt under the cue's law) |
| 5 Level | The loudest 100 ms of the cue's own samples, against the street background measured the same way, against `hear` (the level plan's level, its law and modifiers), and against the beds in that window |
| 6 Loudness | Momentary (400 ms) and short-term (3 s), K-weighted with `loudness.js`'s own filters (`kWeighted`, now exported), every 100 ms, per shot |
| 7 Silence | Every detection on the stems of the hard and foley groups, and every continuous voice's onset, against the four bed-only windows |
| 8 Voices | Check 12's allocator on the measured spans (onset to end) |
| 9 Density | Check 11 on the stems: groups within 6 dB of the loudest over the trailing 100 ms, or with a measured onset in the last 100 ms, counted as bodies |
| 10 Masking | Third octaves (IEC 61260 nominal centres 25 Hz to 20 kHz, Butterworth order 3 per side) of the cue's loudest 100 ms against everything else sounding in it (the mix before the master minus its group) |
| 11 Phone and mono | The same window folded to mono, its side, and on a phone speaker; check 14 run on the measured bands |
| 12 Determinism | sha256 of the two raw renders |
| 13 Stems | The 30 group stems summed against the mix before the master |
| 14 Drift | The design stage with the score parked, each part rendered alone, onsets matched one to one against cues.js's enabled one-shots |
| 15 Target | The loudness sweep below |

Why the onsets are not the detector's: on a stem, the detector fires again on a tail that is still sounding, once
every minGap (its line is the -60 dBFS floor or 12 dB over the 250 ms median, and a decaying tail stays over both).
With the gap at half a group's closest cue spacing, the second re-fire lands within about a millisecond of the next
cue's time, whatever that cue's audio does. On the first version of this measure, 5 of the 93 one-shots passed with
their own audio moved 6 ms early (the checker's), and 6 committed onsets were re-fire hop times, not attacks.

## The bars and their sources

| Measure | Bar | Source |
|---|---|---|
| Renderer | every voiced cue within 5 ms; each group's stem the sum of its cues alone within 1e-6 of its peak (starting value) | ROADMAP Sound 2.6, SOUND-PLAN 4.5 (the S8.2 layers reached it; the bar is not limited to one-shots); the sum's bar is the stems' (`tests/sound-blockout.test.mjs` measured one float32 step) |
| Sync | 0 to 45 ms ahead of the first showing frame, past the named lead; after the frame fails (45 ms a starting value) | ITU-R BT.1359 via SOUND-PLAN 3.3, check 4 (secondary) |
| Pan | within 0.5 dB | SOUND-PLAN 4.5 (today's car test; S8.2 measured 0.11 dB) |
| Silence | no onset inside | SOUND-PLAN 3.11, check 13 |
| Voices | at most 24, no steal, drop or cut | psx-spx via SOUND-PLAN 3.13, check 12 |
| Density | more than 2 bodies reported, more than 3 fails (starting values) | check 11, Murch (secondary) |
| Phone and mono | a story cue only below 250 Hz or only in the side channel fails (side: 3 dB more side than mid, a starting value) | check 14 |
| Stems | within 1e-6 of the peak (starting value) | `tests/sound-blockout.test.mjs` measured one float32 step |
| Target | no 400 ms window loses more than 1 dB to the limiter (starting value) | the brief for this step |
| Level, masking, ends, loudness, drift | reported | SOUND-PLAN 4.4 and 4.5 |

The phone speaker is a model, not a measurement: a 500 Hz second-order high-pass (800 Hz for a small phone) and an
8 kHz low-pass on the mono fold-down. Its numbers, sources and their strength are written beside `PHONE_SPEAKER` in
`scripts/lib/audio-analysis.mjs`: two patents and a datasheet seen only in search excerpts, one review measurement (an
excerpt), the 3GPP TS 26.131 hands-free mask (an excerpt of a mirror) and closed-box theory from memory (secondary).
The pages themselves could not be opened from here (the proxy refused them).

## Results

| # | Measure | Status | Result |
|---|---|---|---|
| 1 | Renderer | pass | 142 of 142 voiced cues within 5 ms of their start (93 one-shots, 49 continuous): 125 read 0.021 ms after their cue time (one sample), the 12 brakes and ticks whose cue time falls between samples 0.011 to 0.031 ms, the 5 backgrounds 0 ms from bedSpan's start; 30 of 30 group stems the sum of their cues alone, the worst 8.2e-8 of its peak (the wind beds' crossfade); no onset outside its group's cues |
| 2 | Sync | fail | 119 judged, 20 off: the 12 Sound 1 found (6 scuffs, 110 ms late to 43 ms early; 6 cloth moves timed from keys, 5 to 88 ms early), and 8 below |
| 3 | Cue ends | report | end minus t1 from -653 ms (B's slide off the seat: a 50 ms knock on a 0.7 s span) to +24.9 ms (the street beds, which run half the crossfade past their t1), median -4.4 ms |
| 4 | Pan | pass | 142 cues, the worst 0.101 dB off its prediction |
| 5 | Level | report | measured minus predicted from -3.34 dB (the far ticks: the air lowpass the prediction leaves out) to +0.26 dB, median 0; the street background -30.03 dB (the rule's -30); 62 of 136 non-background cues 6 dB or more over the beds in their loudest 100 ms |
| 6 | Loudness | report | at -23 LUFS: the loudest momentary -15.41 LUFS (shot 5), short-term medians from -31.38 (shot 2, the hush before the car) to -18.30 (shot 5); per shot in measure.json |
| 7 | Silence | pass | 4 windows, no onset inside |
| 8 | Voices | pass | peak 12 voices at 34.61 s (planned 12); no steal, drop or cut; 2 crossfades (below) |
| 9 | Density | pass | peak 6 foreground streams, 3 bodies; 15 runs at 3 bodies (33.2 to 61.2 s), none over |
| 10 | Masking | report | 27 of 136 cues with no third octave 3 dB over everything else in their loudest 100 ms: the exhaust and the tyres under the intake (one body), getting out under the idle, cloth under the steps, the late ticks under the steps. Check 9 predicted 79 of the 93 one-shots under 3 dB broadband: per band the band-limited placeholders stand out where the broadband sum hid them |
| 11 | Phone and mono | fail | 9 story cues, 2 flagged: both latches "only below 250 Hz" (below). In mono the story cues change by -0.72 to 0 dB; on the phone by -16 to -0.05 dB (the run-down -3.4, the engine -1.9; the latches -15.3 and -16.0) |
| 12 | Determinism | pass | two renders, the same bytes (sha256 12c40d8d...) |
| 13 | Stems | pass | worst 9.74e-8 of the peak (about one float32 step), at 28.30 s |
| 14 | Drift | report | below |
| 15 | Target | pass | -23 LUFS, below |

The 8 sync cues off their frame that pass on their cue times: the engine's two parts and the tyres at the first light
(14.000), the engine's idle at the stop (29.000), the driver's latch (34.500) and the drawn exhale (90.000). Each
instant sits on its frame's own time, so on its cue time it is 0 ms ahead, a pass with nothing to spare; the measured
onset is the first sample that is not zero of the cue alone, one sample after its voice's start, so it reads 0.02 ms
after the frame. (The first version read the driver's latch 0.21 ms in, the detector's line inside its thump; the
detector no longer reads onsets.) I kept the plan's bar exactly and report them as fails. Each row says why, and only
when the onset trails the frame by at most the reading's lag, 1.5 samples (`readLagSec`): a cue on a frame time
played 10 ms late gets the plain "10.02 ms after its frame" (tested on the latch and the intake). Nobody can hear
0.02 ms (BT.1359's audio late threshold is about 125 ms), so for Sound 3 the choice is a one-sample lead on instants
that fall on frame times, or a bar that allows the reading's lag; that is the lead's call.

The latches: the placeholder is a 200 Hz thump plus a 6 ms click at 1.8 kHz (SOUND-PLAN 4.4, "a thump plus a click at
the latch"). In its loudest 100 ms the thump's third octaves carry it; the click's are more than 10 dB down, so the
measured band is 178 to 224 Hz and check 14 flags it. On the phone the latch loses 15 to 16 dB, 22 to 23 on a small
one: the shut doors are the story's, so the real latch at Sound 4 needs its energy in the mid band. Not a renderer
fault; the placeholders are unchanged.

## The loudness target: chosen by measurement

The rule: the loudest integrated target at which no 400 ms window loses more than 1 dB to the limiter (a click held
for a few milliseconds is not a level change; a pumped engine is). The raw blockout reads -22.19 LUFS. Normalized from
-16 down in 0.5 dB steps until nothing is limited (the hush: the run-down's end, 36.6 s, to the end of shot 6, 46 s;
both read from cues.js, carTimes and SHOTS; measure.json `hush`):

| Target | Gain dB | Worst 400 ms dB (at s) | Windows over 1 dB | Worst sample dB | Samples limited | Street in the hush (LUFS M, median) | Mix in the hush |
|---|---|---|---|---|---|---|---|
| -16 | 7.90 | 7.94 (28.3) | 232 | 11.22 | 960753 | -22.77 | -16.78 |
| -17 | 6.50 | 6.73 (28.3) | 185 | 9.82 | 820791 | -24.17 | -18.07 |
| -18 | 5.06 | 5.49 (28.3) | 137 | 8.38 | 590694 | -25.61 | -19.51 |
| -19 | 3.75 | 4.38 (28.3) | 73 | 7.08 | 366160 | -26.91 | -20.81 |
| -20 | 2.51 | 3.34 (28.1) | 39 | 5.83 | 213286 | -28.16 | -22.06 |
| -21 | 1.39 | 2.39 (28.1) | 25 | 4.71 | 129744 | -29.28 | -23.18 |
| -22 | 0.30 | 1.49 (28.1) | 12 | 3.62 | 66678 | -30.37 | -24.27 |
| -22.5 | -0.24 | 1.06 (28.1) | 5 | 3.09 | 42920 | -30.90 | -24.80 |
| **-23** | **-0.81** | **0.63 (28.1)** | **0** | **2.52** | **23145** | **-31.47** | **-25.37** |
| -24 | -1.81 | 0.35 (30.1) | 0 | 1.52 | 3471 | -32.47 | -26.37 |
| -25 | -2.81 | 0.12 (30.1) | 0 | 0.52 | 430 | -33.47 | -27.37 |
| -26 | -3.81 | 0 | 0 | 0 | 0 | -34.47 | -28.37 |

(Every half step is in measure.json; the true peak is -2.0 dBTP, the ceiling, at every target that limits.)

So the blockout's target is **-23 LUFS** (`config.audio.targetLufs.blockout`), and every quieter target meets the rule
too. The worst window is not the click the facts named before this step (11.2 dB off shot 5 at 30.4 s is the largest
loss of one sample, the driver's unlatch, 2.52 dB at -23) but the car arriving in shot 4 at full drive with the swell
(28.1 to 28.3 s): at -16 the limiter holds that engine 7.9 dB down for whole seconds. At -23 the mix sits 7 dB under
the plan's -16, the street background in the hush at -31.5 LUFS momentary; SOUND-PLAN 3.18 anchors the mix on the hush
from Sound 5 anyway, and integrated loudness stays under -16 as it asks. The design stage keeps -16, byte identical.

## The drift of the parked design layers (Sound 2.7)

Reported, not a bar. Of the 93 enabled one-shots: 72 matched, 18 missing, 3 with no design part to play them (the
handbrake and the two belts), and 102 extra onsets. An extra is any detection on a part that no cue claims; on a
design sound that is still sounding the detector fires again every 80 ms (its gap), so extras 80 ms apart can be one
sound, not separate events (the doors' four extras 81 ms after an open or a latch; the rustles' runs from 62.816,
62.895, 62.976 on). The design parts play many events each and have no per-event render, so the extras are not
split into events here.

| Part | Matched | Missing | Extra | Drift (matched) |
|---|---|---|---|---|
| A's steps | 35 | 0 | 35 | 0.5 to 20.2 ms, median 10.9: the print times against the rig's contacts (SOUND-PLAN 3.3: up to 20.3 ms) |
| B's steps | 28 | 0 | 27 | 0.2 to 20.3 ms, median 7.8 |
| Doors | 4 | 6 | 7 | 0 ms: the design's open sounds at open0 (matched to the swing open; the unlatch 60 ms before it is missing), its shut at close1; no stops, no swings shut; the hinge creak and the seal are the extras, with the re-fires 81 ms after |
| Settle | 2 | 0 | 2 | the dip 0.04 ms, the rebound +30.5 ms (the design's 0.38 s against settlePitch's deepest point) |
| Ticks | 2 | 8 | 9 | the first 0.02 ms (both start lightsOff1 + 1.1), one more 385 ms off; the design draws its own seeded spacing (its second tick at 39.557 is 626 ms from tick 02, past the 0.5 s cap) |
| Lighter | 1 | 1 | 1 | the strike +70 ms (the design at the flame, cues.js leads it by 70 ms); the release click is not detected under the flame |
| Rustles | 0 | 3 | 20 | the design's pats (62.75 + 0.72 = 63.47 for A, 62.8 + 0.7 = 63.50 for B, `RUSTLES` in `src/audio/layers/foley.js`) are not detected at all: they sit inside the two rustles that start at 62.75 and 62.8, whose envelope there swings between -35 and -21 dBFS (the peak of each 10 ms, 63.40 to 63.60 s), and the pats do not rise over it. No tolerance would match them. The part's tolerance is one number from its closest pair (the rests, 2.5 ms apart: 1.25 ms), so A's cup at 78.069 is judged within 1.25 ms too, and is missing; one part plays both people, so they cannot be told apart. The extras are the crinkles and their re-fires |
| Key | 0 | 0 | 1 | the key click, which Gate 0 removed |

A tolerance per cue (half the spacing to its own neighbours) was tried and not adopted (scratch drift-tol.mjs): it
matches A's cup to the detection at 78.052, 17.0 ms early, a crinkle of the design's third rustle (77.6 s for 0.9 s,
which has no pat). That is a false match: the design plays no cup, and the per-part tolerance says so.

## The stems

Measuring stems, one per voice group, float WAV at the level before the master: `out/round-05/stems/` (not committed;
the paths are in measure.json `groups`). Listening stems for the director, one per body, each at the mastered mix's own
gain (-0.806 dB) and unlimited. The float renders (`out/round-05/listen/*.wav`, not committed) sum to the mix before
its limiter within 9.0e-8 of its peak. The AAC files at 96 kbps in `review/round-05/stems/` do not: decoded and summed,
they differ from that mix by up to 0.380 of its peak (at 30.44 s, the driver's unlatch click), the error 13.0 dB under
the mix in power; each file aligns with its float stem at lag 0. `stems.json` has the sha256, seconds, integrated
loudness and peak of the float signal and of the AAC, each file's coding error, the sum both ways, the groups and the
cues:

| Stem | Cues | Size | Integrated (float, AAC) | Peak | AAC coding error under its float stem |
|---|---|---|---|---|---|
| night.m4a (the backgrounds and the hum) | 6 | 1.37 MB | -27.92, -27.6 LUFS | -14.7 dBFS | 9.61 dB (broadband noise at 96 kbps) |
| car.m4a | 39 | 0.42 MB | -20.50, -20.5 LUFS | +0.44 dBFS, +1.7 dBTP on the AAC | 17.59 dB |
| A.m4a | 58 | 0.61 MB | -25.67, -25.8 LUFS | -3.6 dBFS | 17.68 dB |
| B.m4a | 39 | 0.39 MB | -25.81, -25.9 LUFS | -4.8 dBFS | 15.60 dB |

The car stem goes over full scale for a few milliseconds: those are the samples the mix's limiter takes up to 2.5 dB
off, left in so the float stems add up; a player clips them. The encoder gives the same bytes for the same samples
(the m4a files are byte identical across the three runs of this round).

## measure.json, for the stills and the arrangement sheet (Sound 2.9)

The schema is written at the top of `scripts/sound-review.js`. In short: `measures` is one entry per measure in the
report.json check shape (`id, n, name, definition, bar, source, starting, status, summary, columns, rows`, every row
value a string, number, boolean or null, `cue` naming the cue; the renderer's rows have a `kind`: `onset` per cue,
`sum` per group, `stray` per detection outside its group's cues); `table` is one row per voiced cue with everything
measured on it (onset, read, end, the loudest window and its level, predicted level, balance and predicted balance;
`onset` is read alone, `read` says where the end and the window are read); `bands` holds each cue's third octaves and
its masker's at its loudest 100 ms; `series` the mastered mix's momentary and short-term loudness every 100 ms
(`lufs[k]` ends at `firstEnd + k * hopSec`); `hush` the hush's span; `groups` names each measuring stem's file. The
next steps (`--stills`, `--sheet`) join `STEPS` in `sound-review.js` and read the same session, so nothing is rendered
twice.

## The checker's findings, and what changed

| # | Finding | Disposition |
|---|---|---|
| F1 (high) | The renderer read onsets with the detector, which fires again on a sounding tail every minGap; 5 of 93 one-shots passed with their audio 6 ms early, 6 onsets were re-fires, and the 2.0 ms explanation was wrong | Fixed. Onsets read on each cue alone, each group's stem checked against the sum of its cues alone. The six onsets the detector misread (read 1.0 and 2.0 ms after their cue times for the swings open, 1.0 for B.03, 0.73 for A.13, 0.83 for A's release and 0.69 for A.02) now read 0.021 ms, one sample, like their neighbours. Measured on all 142 cues (scratch sens2.mjs): every cue played 6 ms early and late (its span, place and track) fails on its own row and no other, and every one-shot's audio moved 6 ms early in the stem alone fails its group's sum, 372 of 377 plants. The 5 not found are the three cues that start with the film (the street's wind and city beds and the lamp's hum, t0 0): an onset before the film's first sample cannot be read, and the beds start half the crossfade before t0, clipped at 0, so a shift under 25 ms either way stays at 0. The 2.0 ms is explained above and corrected in BUILD_LOG: the swings open cross -60 dBFS 0.06 and 0.08 ms after t0; 30.501 and 32.002 were re-fires after 30.471 and 31.971 |
| F2 (high) | The "onsets to the sample" control could not fail | Fixed: A.05 planted 5.5 ms late (its attack 0.77 ms into its hop, checked as the premise) reads 4.81 ms on the hop, inside the bar, and 5.58 ms to the sample, outside; the comments now say a cue 6 ms late always reads over 5 ms on the hop |
| F3 (medium) | The sync edge note had no upper bound | Fixed: only within `readLagSec` (1.5 samples); tested on the latch and the intake 10 ms late |
| F4 (medium) | The 49 continuous voices had no renderer bar | Fixed: every voiced cue is judged (a background from bedSpan's start); tested on cloth, a brake, a drag and the bridge's wind bed 30 ms late |
| F5 (medium) | The stems' sum was claimed for the AAC files | Fixed: the sum is said of the float stems, the AAC files' own error is measured and in stems.json; the float sum is tested with a body left out |
| F6 (low) | The schema left out `hush` | Fixed |
| F7 (low) | The rustles' explanation | Fixed in the drift table above; the per-cue tolerance measured and not adopted (above) |
| F8 (low) | Check 5 said nothing for a WAV from before the per-stage target | Fixed: such a sidecar is read as made at -16 (`madeAtOf`), and the note says so; tested with a planted sidecar |
| F9 (low) | Comments and SOUND.md | Fixed: EPS_T moved, the comments added, SOUND.md names the target per stage |

Where I disagree, measured:
- The checker wrote that moving a cue in the cue list (moveBy, then groupOf) leaves the stem unchanged for the later
  cue of a pair, because the blockout holds its voice. The blockout has no voice holding (events.js plays each event
  on its own), and moving B.03 6 ms early in the cue list changes B's stem from 34.59402 s, 6 ms before its attack
  (scratch time1.mjs): the stem moves; it is the detections that stayed where they were, held back by the gap. So the
  first version's plants did move audio, and its renderer missed them for the reason in F1.
- One plant that does not move audio, found here: a voice whose level follows the picture. The flame (its level
  `lighterFlicker`) moved 6 ms early by moveBy still starts at its first flame frame, so the tests plant with
  `shiftBy`, which moves the cue's span, place and track together, as a renderer playing it elsewhere would.

The checker's own note of four small error logs it left at the filesystem root (`/indep.log`, `/indep.status`,
`/sweep.log`, `/sweep.status`) is outside this worktree; I have not touched them.

## What surprised me

- The limiter's worst window is the engine, not a click: the plan's -16 would hold the car's arrival 7.9 dB down.
- Eight sync cues fail by one sample because their instants are exactly on frame times.
- Masking per band is far kinder than check 9's broadband prediction (27 at risk against 79): placeholders are narrow.
- The backgrounds' crossfade at the place change is two voices of one group for 50 ms; check 12's allocator calls that
  a cut. I count a crossfade of two unplaced beds of one family, no longer than `TIMBRE.crossfadeSec`, as intended
  (kind `crossfade`, with a planted overlap 0.1 s longer shown to fail). A ruling for the lead.
- The bridge's water bed starts 25 ms before its t0: half the crossfade, on purpose, so the renderer reads an unplaced
  bed from `bedSpan`.
- The AAC night stem reads 0.3 LU louder than its float signal, and its coding error is only 9.6 dB under it: broadband
  noise is the hardest thing for a 96 kbps coder to keep sample for sample.
- The detector cannot be trusted on a stem where voices overlap: an attack on another voice's tail can wait for the gap.
  It finds attacks on silence well, and that is all the review now asks of it (the strays, the silence windows, the
  design's drift).

## Tests changed

| Test | Change | Reason |
|---|---|---|
| `tests/audio.test.mjs`, the finished soundtrack | "-16 LUFS" read as `targetOf(CONFIG.audio)` (the default stage's target, -23 now); the 0.2 LU and -1.5 dBTP bars unchanged | the target is per stage since this step |
| `tests/audio.test.mjs`, the sidecar | one assertion added: a raw render names no target | the sidecar now names its target |
| `tests/audio.test.mjs` | new: the target per stage, with a stage the table lacks as its control | the new `targetOf` |
| `tests/audio.test.mjs` | new: check 5's target note, with a planted sidecar from before the per-stage target | F8 |
| `tests/sound-measure.test.mjs` | new, 26 tests | the tooling and the review's measures, each with its planted fault |
| `tests/sound-measure.test.mjs`, the renderer measure | its nearest-match control is gone; the ghost cue fails on the group's sum instead of on matching | the renderer no longer matches detections to cues (F1); the one-to-one tooling test keeps its nearest-match control |
| `tests/sound-measure.test.mjs`, the sync measure | the late step is planted as played (`played`, `shiftBy`), not only in the stem | the sync measure reads onsets alone now; a stem-only plant is the renderer's sum to catch |

No bar was relaxed. `onsets()` was refactored onto a shared detector; it returns the same times on all 30 voice
groups' stems (checked), and the existing onset tests pass unchanged.

## Carried forward

| Item | Where |
|---|---|
| The 12 sync misses (unchanged from Sound 1) and the 8 on-frame instants | Sound 3 |
| The latches only below 250 Hz on measured bands | Sound 4 (the real latch); check 14 stays failing until then |
| The phone model's sources are excerpts | a phone measured, if it matters at Sound 5 |
| The rustles part plays both people in one stem | Sound 4 replaces RUSTLES |
| The three cues that start with the film: an onset measure cannot see them moved earlier | the level and pan measures at their start, if it matters |
| The drift's extras are detections, not design events (re-fires 80 ms apart among them) | Sound 4 replaces the design layers |
| The template has no per-stage target | when the template gains stages |
