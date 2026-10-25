# Round 05: Sound 2.12, the options measured before asking (branch s2-options)

ROADMAP Sound 2.12: the muffle on the hidden engine done the PS1 way, a narrower pan for sync foley, the second listener
model, and the style-frame scene, each measured before it becomes a question at Sound gate 2. This file is for the lead
to merge into `notes.md`. Every number below is in `decisions/decisions.json`, made by
`node scripts/sound-options.js --round 05` (about 5 minutes with the clips, 2 without: `--no-clips`), unless it is
marked as a test's measurement. These are placeholders: what each can and cannot show is said under each option. An
independent checker went through the first version; what it found and what changed is at the end.

## How each A/B was made

- **A** is every switch off: today's blockout. **B** is one switch on at its starting values. The switches live in
  `config.audio.options` (all off), read by the blockout's voices (`layers/blockout/voices.js`) and the spatializer
  (`spatial.js placeAt`). The picture's hidden state reaches the render only as `makeContext`'s `occlusion`, which only
  the options script builds (from Sound 1's own screen states and blockers); src/ never imports scripts/. A switch set
  to a value it does not know (a misspelt listener, a muffle mode, a sync pan kind that names no foley cue) is refused,
  so a typo cannot render A while it is reported as B.
- **Measured per cue, before the master.** Each cue is rendered alone through its own voice and the real spatializer,
  so a difference is the option's, not the limiter's or another cue's (`scripts/lib/sound-options-lib.js renderCue`).
  A cue's level is in dB over the street background (the level rule's unit); "its loudest 100 ms" is the level plan's
  measure of a voice.
- **What each switch moves.** Every placed voice rendered under A and B; the cues that differ against the cues the
  option names, written from its definition and not from its code; and the whole mix before the master compared outside
  the named cues' samples.

  | Switch | Named | Moved | Moved, not named | Named, not moved | Mix samples changed outside the named cues |
  |---|---|---|---|---|---|
  | muffle by the set, volume and swap | 14 | 14 | 0 | 0 | 0 |
  | muffle by Sound 1's rule, volume and swap | 19 | 19 | 0 | 0 | 0 |
  | narrower pan | 74 | 74 | 0 | 0 | 0 |
  | characters' listener | 125 | 115 | 0 | 10 (both listeners give them the same gain throughout: inside the law's refDist) | 0 |

- **Byte identity, every switch off.** The default render (`node scripts/sound.js`) is sha256 `6f9c4925...cb7` before
  and after; the design stage with the score unparked is the S8.3 `f80b1542...1da` before and after.
- **The clips.** 7 s each (a starting value: long enough to run from the engine's first hidden frame to the car in
  view), `capture.js --profile preview`, the overlay on, each with the capture's own sidecar (ffprobe facts). The video
  of every clip at one moment decodes to the same frames; only the audio differs. Each option's set of mixes (A and its
  Bs) is mastered together, so at every sample B over A is the option and nothing else, and nothing passes the -2 dB
  ceiling:
  - **muffle and pan: A's gain and one limiter curve,** from the loudest mix of the set at each sample. `a.wav`, A
    through its own master, has the default render's sha256, and wherever no B is louder than A at a peak, the set's A
    is that master. Where a B is louder, the shared curve turns A down too. Measured in 10 ms windows inside the clips,
    against the default master: the engine clip 0 of 700 windows 1 dB or more down (worst -0.02 dB), the car clip 2
    (worst -1.11 dB), the pan clip 0 (worst -0.22 dB).
  - **the characters' listener: one static gain, no limiter.** Its B runs up to 10 dB hotter than A at the steps, so a
    shared curve would turn A down in step with B's steps: measured, it would take 1 dB or more off A in 107 of the
    clip's 700 10 ms windows, 3 dB or more in 55, down to -8.68 dB, a pumping today's master does not have. So the set
    goes through A's gain lowered by 12.01 dB, the most any mix of the set passes the ceiling at A's gain (the B mix
    at 34.501 s, in shot 5, on the limiter's true-peak estimate), and nothing is limited anywhere. Both listener clips
    are mastered 12.01 dB under the preview's gain; the A clip is today's mix at that lower gain, without today's
    limiter, which takes 1 dB or more off A in 11 of the clip's 700 10 ms windows (3 dB or more in 2, at most
    4.45 dB). Over the clip the A clip measures 11.81 dB under the preview's audio.
- **The audibility bar** (ROADMAP 2.12, starting values): 1 dB in level or 0.1 in pan at the cue. All three A/Bs measure
  over it, so all three are "ask the director". The style frame is a question by the gate table.

## Option 1: the muffle on the hidden engine

**Definition.** While the picture hides a placed cue's source (its rendered point through the frame's camera, a blocker
between them), its voice is muffled, the PS1 way, since the SPU has no per-voice filter:

- **volume:** the voice's volume drops by 6 dB;
- **swap:** the voice crossfades to a copy of itself through a fixed lowpass, the pre-filtered sample a PS1 bank would
  hold, playing in step from the onset (two voices while the cue lives).

The hidden state is read every block (256 samples) and the muffle follows it over 50 ms, from where it stands at the
onset. It names every cue hidden on any frame. **What counts as hiding** is measured both ways:

- **by the set (B, the plan's muffle):** a building, a parapet, the deck, a bank, or another body; a car's own body does
  not hide its own sounds. The cabin and getting out stay hidden by the car, as sounds inside it.
- **by Sound 1's rule (for comparison):** the storyboard's onScreen check 2, which asks whether the point is seen, so it
  also hides the exhaust behind its own rear bumper and the passenger door behind the car.

| Starting value | Why |
|---|---|
| dropDb 6 | One tier of the level plan (SOUND-PLAN 1.3: foreground at least 6 dB over the background, midground 0 to 6): a hidden sound steps down by the gap between the two |
| lowpassHz 900, two 2-pole sections | An octave under the darkest the air law reaches with distance (`SPATIAL.minAirHz`, 1800 Hz), so it reads as something in the way, not far away; built as the placeholders build their bands |
| rampSec 0.05 | The backgrounds' crossfade at the place change (`TIMBRE.crossfadeSec`): no click. A change of state is read at the next block, at most 5.3 ms after its frame, so the muffle has moved fully about 55 ms after it |

**Which cues, when.** By the set, 14 voiced cues:

| Shot | Cues | Hidden by | Hidden frames |
|---|---|---|---|
| 3 | the intake (14.000 to 17.875), the exhaust (14.000 to 18.625), the tyres (to 17.917 and 18.458) | building SE | 93, 111, 94, 107 |
| 5 | handbrake, both belts, getting out (A and B, slide and rise), B's walk and two turns (cloth) | the car body | all or most of their frames |

Sound 1's rule adds 6 cues' frames, all behind a car's own body: the exhaust's 229 frames from 18.625 to 29.000 s
(340 of its 360 in all) and the passenger door's five cues (unlatch, swing open, stop, swing shut, latch: 38 frames).
The set's hidden state is Sound 1's less exactly those frames (tested frame for frame).

**Measured at the cue** (level while hidden, B against A; the set's rows, and the parts only Sound 1's rule hides):

| Cue | A while hidden (dB over the bed) | Volume | Swap | Swap's centroid |
|---|---|---|---|---|
| intake, behind building SE | -0.35 | -6.00 | -1.91 | 628 to 570 Hz (-0.14 oct) |
| exhaust, behind building SE | -2.28 | -6.00 | -1.92 | 628 to 571 Hz (-0.14 oct) |
| exhaust, behind its own body (Sound 1's rule only) | +3.52 | -5.98 | -1.95 | |
| tyres, front and rear | -8.14, -7.71 | -6.00 | -6.05, -6.13 | -0.20 oct |
| cabin (handbrake, belts) | -3.3 to -4.4 | -6.00 | -56.7 to -58.8 | 6.0 kHz to 2.0 to 2.2 kHz |
| getting out (4) | -3.3 to -8.1 | -6.00 | -2.97 to -2.98 | 0 |
| cloth (B's walk and turns) | -0.04 to +1.69 | -6.00 | -12.6 to -12.8 | -0.46 to -0.50 oct |
| passenger door (Sound 1's rule only) | -6.9 to +11.4 | -6.00 | -0.03 to -21.62 | 0 to -0.37 oct |

**In the mix, the engine clip** (14.000 to 21.000 s), B against A in the mastered mixes, whole and in three parts:

| Part | By the set, volume | By the set, swap | Sound 1's rule, volume | Sound 1's rule, swap |
|---|---|---|---|---|
| the whole clip | -1.33 | -1.00 | -2.19 | -2.56 |
| the rise out of the quiet, 14.000 to 16.500 | -1.78 | -0.85 | -1.78 | -0.85 |
| the intake behind building SE at full level, 16.500 to 17.875 | -4.59 | -1.71 | -4.59 | -1.71 |
| the intake in view, 17.875 to 21.000 | -0.41 | -0.76 | -1.55 | -3.41 |

The first two parts are the plan's case and the same under both rules. In the last, the car is in plain view (its
headlights toward the camera at 19.5 s); the set still hides the exhaust and the tyres behind building SE for a few
frames (to 18.625 and 18.458 s), and Sound 1's rule goes on muffling the exhaust behind its own rear bumper.

**The car-body clip** (28.250 to 35.250 s, where the set's muffle takes the most off the other hidden cues: 10 onsets,
from the end of shot 4 into shot 5, all hidden by the car body): -0.11 dB (volume) and -0.12 dB (swap) by the set,
-0.24 and -0.34 dB by Sound 1's rule (it adds the passenger door, and the exhaust's last 0.75 s behind its own body).
The muffled cues are small sounds under the idle.

**The swap and the engine's placeholders.** The intake's and the exhaust's buzzes are the same saw from the same rpm
track, so in A they add coherently: over the engine clip the two buzzes summed have 1.90 times the sum of their powers,
all four engine cues (with the tyres, which are noise) 1.76 times. The swap's lowpass shifts a muffled buzz's phase
against the other's: by the set the pair falls to 1.71 (both are filtered until 17.875 s, the exhaust alone until
18.625 s), by Sound 1's rule to 0.95 (the exhaust filtered through 29 s). That is, by inference from those numbers,
why the swap by Sound 1's rule takes 3.41 dB off the last part while each voice's own power drops under 2 dB. A
placeholder artifact (below).

**Voices:** the swap holds two voices per muffled cue for its whole life (counted conservatively); the peak demand goes
from 12 (33.31 s) to 15 (28.38 s) of 24, by either rule.

**Clips:** at the engine, `decisions/muffle-engine-a.mp4`, `-b-volume.mp4`, `-b-swap.mp4` (by the set, the B) and
`-b-volume-all.mp4`, `-b-swap-all.mp4` (by Sound 1's rule, to hear what it adds in the last 3 s); at the car body,
`decisions/muffle-car-a.mp4`, `-b-volume.mp4`, `-b-swap.mp4` (by the set).

**What a placeholder can show:** when the muffle acts and how much level it takes off each voice. **What it cannot:**
what a real muffle sounds like. The engine's buzz sits in a band at 650 Hz, under the 900 Hz cutoff, so the swap barely
touches its level, while a recorded engine has the top end a swap removes; the cabin's 5.9 kHz clicks lose nearly
everything. The swap on the engine can only be judged at Sound 4.

**Call: ask the director** (both ways move every hidden cue by 1 dB or more: -6.00 dB, and -1.9 dB on the engine for
the swap).

**What I would recommend:** if the director wants the hidden engine heard as hidden, the volume drop by the set. It is
the plan's case and it acts where the picture hides the engine: -4.59 dB over the 1.4 s the engine is at full level
behind building SE, -1.78 dB through the rise, and -0.41 dB once the intake is in view. Otherwise no muffle, the gate's
default. Sound 1's rule is not a candidate for a muffle: with the car in plain view it takes 1.55 dB (volume) and
3.41 dB (swap) off the last 3.1 s of the clip through the exhaust's own body. The swap is measured again on the
designed engine at Sound 4. (The first version of these notes recommended against a muffle because most of what the
engine clip lost was the exhaust behind its own body; that was Sound 1's rule, not the plan's muffle.)

## Option 2: a narrower pan for sync foley

**Definition.** The pan of every foley cue of the kinds named (`syncPan.kinds`: the steps, the scuffs, the hands'
contacts: the forearms' rest on the parapet and the cup round the lighter) times 0.5, from the camera as today. Every
other cue keeps its pan.

| Starting value | Why |
|---|---|
| widthRatio 0.5 | Halfway between the physical pan (1) and the centre (0): a midpoint to find out whether narrowing is audible at all, not a designed width. The frame edge pans 0.12 to 0.33 by lens instead of 0.24 to 0.66 (SOUND-PLAN 3.4) |
| kinds | The sync foley the plan names; cloth on the walks, turns and shifts is not a contact and keeps its pan |

**Measured:** 74 cues named (63 steps, 8 scuffs, 3 contacts). **28 move by 0.1 in pan or more** at their onset (25
steps, 3 scuffs, no contact), up to -0.399; their balance in their stem windows moves up to -10.24 dB. By shot: 17 in
shot 5, 9 in shot 7, 2 in shot 9. **The four largest are B's steps off screen right in shot 5** (pan 0.68 to 0.80,
halved to 0.34 to 0.40), the steps SOUND-PLAN 3.7 keeps off screen right on purpose; the others are steps and scuffs
on screen away from the centre (x 0.21 to 0.84 of the frame) in shots 5 and 7, plus 2 off the bottom edge in shot 9.
The contacts sit near the centre and move under 0.1 (0.092 at most). Every narrowed render's balance follows the
narrowed law within 0.0001 dB.

**In the mix at the moment** (32.833 to 39.833 s): the balance moves 0.49 dB toward the centre; the level does not move.

**Clips:** `decisions/sync-pan-a.mp4`, `sync-pan-b.mp4` (32.833 to 39.833 s: where the sync foley's pan moves the most;
B walking round the car). Headphones needed.

**What a placeholder can show:** the pan itself; the spatializer pans by level alone, so a band-limited step moves
exactly as a real one would. **What it cannot:** how wide the image feels against real backgrounds and real steps, whose
top end localizes better than a 1.25 kHz band; on a phone both are mono.

**Call: ask the director** (28 cues move by 0.1 in pan or more).

**What I would recommend as the default:** the physical pan, as today. The cues it moves most are the off-screen steps
whose pan is what tells where B is; the rest are on-screen steps the narrower pan would pull away from the feet.

## Option 3: the second listener model, level from the characters

**Definition (the level listener).** The level of every placed voice by its own distance law from the characters' point:
the mean of the cloth points (each poser's root plus 1.2 m, `DESIGN.CLOTH.up`, where cues.js puts their cloth sounds)
of the people out of the car, whether or not the camera sees them (the poser's `visible` is its presence, not "on
screen"). That is A alone from 30.900 s (the poser has A out just before frame 742, A's first frame out of the car),
then the midpoint of A and B once B is out; before 30.900 s the camera's level holds. The pan, the air lowpass and the
darker sound behind the camera stay the camera's; the behind loss is not applied to the characters' level (it is the
camera's). This is the model `scripts/sound-report.js` already predicts with (`charactersAt`): the listener's point is
that point on every half frame, and the 88 one-shots it names are within 0.12 dB of its prediction at their onset.
The prediction is made at a cue's onset, so a long cue is further from it: up to 6.92 dB (B's walk onto the bridge,
44.5 to 62.0 s, whose loudest 100 ms comes long after its onset, the people having moved). Window by window against
the same model, the 37 continuous cues are within 0.024 dB (a test's measurement, in 1596 windows where the model is
steady).

| Starting value | Why |
|---|---|
| listener 'characters' | The storyboard's own characters model, so the render can be checked against what Sound 1 predicted at every cut |

**Measured:** 125 placed cues sound after 30.900 s; 115 move. The other 10 have the same gain under both listeners
throughout, both inside the law's reference distance (A's first three steps, scuff, walk and turn, A getting out, the
driver's door swinging open and stopping).
**98 move by 1 dB or more at their loudest 100 ms** (103 in their worst 100 ms window), **all louder**: no cue gets
quieter by 1 dB, since the people stand nearer their own sounds than the camera does.

| Largest movers | Loudest 100 ms, B against A |
|---|---|
| shot 8's steps (A 26 to 28, B 18 to 24), the 50 mm at about 15 m | +10.3 to +11.4 dB |
| steps in shot 6 | up to +7.4 dB |
| scuffs, cloth, drags, doors, the exhale | up to +7.05, +6.98, +6.55, +6.38, +6.23 dB |
| ticks | up to +5.16 dB |
| the lamp's hum | +3.43 at its loudest; +13.87 in its worst window (54.0 s, the pair under the lamp) |

Under the characters every step in shots 7, 8 and 9 sits at 13.9 to 14.0 dB (its planned 14 dB); under the camera they
are 10.0 to 11.0, 2.5 to 4.7 and 10.5 to 13.4 dB. So the perspective jumps at 7>8 and 8>9 that SOUND-PLAN 3.6 keeps
(they follow the picture's change of size) vanish.

**In the mix at the moment** (52.792 to 59.792 s): +6.37 dB.

**Clips:** `decisions/listener-a.mp4`, `listener-b.mp4` (52.792 to 59.792 s: where the levels move the most, the walk
onto the bridge). Both are mastered 12.01 dB under the preview's gain, through one static gain with no limiter
(above), so neither has a gain that moves in time; turn the volume up for both alike.

**What a placeholder can show:** every level change the model makes, cue by cue and at the moment the people appear.
**What it cannot:** the balance those levels make with real sounds (SOUND-PLAN 4.4: balance is reported at Sound 2, not
judged).

**Call: ask the director** (98 cues move by 1 dB or more, up to +11.4 dB).

**What I would recommend as the default:** the camera, as today. The characters' listener removes the perspective cuts
the plan keeps, lifts shot 8's far steps 10 to 11 dB (Sound 1.3 found them only 0.1 to 2.2 dB short of their margin),
and every level of the plan, set under the camera, would have to be set again; the mix also gets hotter at the steps.

## Option 4: the style-frame scene to design first in Sound 4

Candidates: runs of whole shots up to 32 s (the default's 24 s and a third, so it stays a scene heard before the rest),
picked by rule from the cues; facts from the cues and the storyboard's own density and voices checks. The film has 19
voiced families.

| Scene | Shots, time | Length | Families | Missing | Cues sounding, starting | Peak bodies, voices | Places | The hush | The densest moments |
|---|---|---|---|---|---|---|---|---|---|
| **default** | 4 to 6, 22.0 to 46.0 | 24 s | 15 | water, lighter, drag, breath | 74, 66 | 3, 12 | street | the engine dies (36.6); longest bed-only stretch 1.47 s (43.03) | both: the voices' peak (33.31) and 3 bodies |
| most families, shortest | 4 to 5, 22.0 to 40.0 | 18 s | 15 | the same | 64, 56 | 3, 12 | street | the engine dies; **no** bed-only stretch | both |
| both places | 5 to 8, 29.0 to 60.0 | 31 s | 14 | brake, tyres, lighter, drag, breath | 108, 105 | 3, 12 | street and bridge (the place change, the water) | the engine dies; 1.47 s | both |
| what the default leaves out | 11 to 13, 76.0 to 96.0 | 20 s | 9 (bg and foley only) | the car, the doors, the feet, the ticks | 19, 15 | 2, 11 | bridge | no engine; 5.20 s (shot 12, B looks) | neither |

All four use 3 categories except the last (bg and foley). **Call: ask the director** (gate 2, question 2).

**What I would recommend:** the default, shots 4 to 6. It holds every category, both densest moments, the engine dying
and 15 of 19 families. Shots 4 to 5 are 6 s shorter with the same families but no stretch where the backgrounds sound
alone, and SOUND-PLAN 3.18 sets the street background's level by ear on the style frame. Shots 5 to 8 are the choice if
the bridge's air (the water, the place change) should be in it, at the cost of the car's drive and 7 more seconds.
Shots 11 to 13 are the complement and better heard as the second scene.

## Findings beyond the options (for the lead)

1. **The intake and exhaust placeholders are phase-locked.** Both play the same saw from the same rpm track, so they add
   coherently: over 14 to 21 s the two buzzes summed have 1.90 times the sum of their powers (all four engine cues 1.76
   times, +2.4 dB; the tyres are noise, so the excess is the two buzzes). Coherent sources at two points are expected to
   image as one phantom between them rather than two sources; that is an inference, since nothing here measures
   localization. Stems by voice group measure them apart, so a per-stem level reads right while the mix is louder. A
   placeholder fix (a per-voice phase or rate offset) is cheap if the lead wants it; until then the engine is louder
   in the mix than its two planned levels' power sum.
2. **Sound 1's blocker rule hides a car's sounds behind its own body** (the exhaust 229 of 360 frames, the rear bumper
   seen from the front; the passenger door). Right for "is the point visible", wrong for "is the sound occluded": the
   muffle's B now leaves a car's own body out (`occlusionFrom`'s `ownBodies`), and `storyboard/sound/report.json`
   check 2 is unchanged.
3. **The characters' listener runs about 10 dB hotter at the steps**; at today's -16 LUFS gain its B passes the ceiling
   by 12.01 dB (34.501 s, shot 5). Relevant to s2-measure's loudness target only if the option is taken.

## Checks (tests/sound-options.test.mjs, 15 tests, each with a planted fault)

| Check | Planted fault that fails it |
|---|---|
| every switch off renders today's samples (with no options key, with an occlusion and the muffle off, with the muffle on and no occlusion); the design stage reads none | the muffle on with an occlusion hiding everything |
| each switch moves exactly the cues it names, cue by cue and in the mix, the muffle by either rule | the muffle leaking to a step, the pan to the lighter, the listener to before anyone is out |
| the volume drop is 6 dB on the 12 cues hidden on every frame (within 1e-4 dB; measured 2e-8); the swap takes 50 dB or more off the cabin (measured 56.7 to 58.8); a lowpass never raises a centroid | a 3 dB drop; a 20 kHz lowpass |
| the muffle's gain, sample by sample, on every hidden cue by either rule and through a planted toggle: settled to the drop or to 1 a block and rampSec after each change, never faster than the whole drop in rampSec; the swap equals its definition, a copy filtered on every sample (measured within 3.3e-16) | the state read once at the onset; a jump; in code, the checker's f1, f2 and f8 |
| the intake in the render: -6.000 dB while building SE hides it, its ramp within 0.05 dB of a linear one (measured 0.0017), today's samples a block and rampSec after 17.875 s | the checker's f1 and f2 |
| the narrower pan is the camera's pan times the width, and each stem's balance follows it within 0.5 dB (ROADMAP 2.6) | today's renders against the narrowed law |
| the characters' listener holds the camera's level until 30.900 s, then matches the storyboard's prediction for one-shots within 0.25 dB (measured 0.12) | a listener that hears from A alone |
| the characters' listener moves the level alone: its point is sound-report.js's on every half frame, the continuous cues follow the model within 0.25 dB in steady windows (measured 0.024), the pan, air and distance are the camera's at every block edge and each stem's balance follows the camera's pan within 0.5 dB (measured 0.0014) | a listener at the people's roots; the pan narrowed too; in code, the checker's f4 and f7 |
| a misspelt listener, muffle mode or sync pan kind is refused | in code, either check removed |
| the hidden state is Sound 1's check 2, cue for cue and frame for frame | the car's boxes left out of the blockers |
| the set's hidden state is Sound 1's less the frames a car's own body hides | the own boxes kept |
| `masterOf` replays `normalize` sample for sample; a joint master and a still master keep B over A and both under the ceiling, the still one with no curve | B normalized on its own; the still gain from A alone |
| `coherenceOf` gives 2 for one noise twice, 0 for it and its negative, 1 for two noises | a sum that ignores where a render starts |
| the style-frame candidates are the ones their rules pick | a lighter planted in shot 4 |

No existing test or bar was changed.

## The checker's findings, and what changed

| # | Finding | What I did |
|---|---|---|
| F1 | No test held the muffle's timing (f1, f2, f8 passed every test) | Two tests (above): the gain sample by sample against the hidden state and rampSec, the swap against its definition, the intake through its ramp in the render. f1 and f2 fail 2 tests, f8 fails 1 |
| F2 | The listener's pan, air and height were not guarded (f7, f4 passed) | One test (above). f4 and f7 each fail it. One disagreement, measured: the finding asks for each stem's balance to equal A's within 0.5 dB. The lamp's hum does not, legitimately: its B balance is 0.82 dB from A's over its 112 s, because the listener weights the shots differently (louder where the people are near the lamp) while its pan in each shot is the camera's. The test holds each stem's balance to the camera's pan law on its own power (within 0.0014 dB), which f7 fails by up to 23 dB |
| F3 | The listener's A clip pumped with B's steps under the shared curve | The listener set is mastered through one static gain with no limiter (12.01 dB under the preview); the pumping it would have had is measured beside it, and every clip's A is measured against today's master in 10 ms windows (above) |
| F4 | The engine clips mixed the plan's muffle with the own-body artifact | The muffle is measured, mastered and clipped by the set (its B) and by Sound 1's rule, split by blocker and the engine clip by part; the recommendation is reworded with the split (above) |
| F5 | Two comments did not match the code or the plan | The script's header describes the joint and still masters; CLIP_SEC is called a starting value |
| F6 | "Visible people" meant the people out of the car; the continuous cues' gap was not reported | Reworded here, in listeners.js, sound-report.js and decisions.json; the 6.92 dB gap and its reason are above |
| F7 | A misspelt listener or sync pan kind rendered A silently | Both are refused, as the muffle mode was; one test with planted values |
| F8 | The log had no 'before' for the notes step and no gate results | Added to BUILD_LOG.md: the first two commits' gates were re-run from `git archive` copies (both pass: 214 tests, 207 pass, 0 fail, 7 skipped; check exit 0), and the third's from the builder's own logs |
| F9 | "Images as one phantom" was written as measured | Labelled an inference; the coherence it rests on is now in decisions.json |
