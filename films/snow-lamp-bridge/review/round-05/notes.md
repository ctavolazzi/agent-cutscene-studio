# Round 05: Sound 2, the blockout

(Draft. The panel's findings, the fixes and the gate questions are added below as they land.)

## Self-review, written before the panel and before any fix

From the preview, the 15 audio stills, the arrangement sheet, `measure.json` and `preview-check.json`. I cannot hear:
each point cites a number or an image.

| # | Where | What I see | Evidence | My first call |
|---|---|---|---|---|
| S1 | Shot 7 (0:46 to 0:54) | The two walkers in step are nearly as loud as the car. The plan's feel says the car is the only loud thing | Integrated per shot on the preview's audio: shot 7 -20.8 LUFS against the car's shots 4 and 5 at -19.4 and -19.1, and shot 3 (the drive) at -23.8 (`preview-check.json`). 35 steps in 8 s, each 14 dB over the bed at its law's reference distance | A level-plan question: every step is set to the foreground rule alone, and two walkers in step sum. Balance is judged at Sound 5, but "is any moment crowded" is a Sound gate 2 question, so it goes to the director with the numbers |
| S2 | Shot 3 to 4 (0:14 to 0:29), the tyres | The tyres' measured level falls well under the storyboard's prediction as the car slows | Stills 3 and 4: front median -10.6 dB, rear -11.0 under prediction in shot 4, -44.1 dB at 28.93 s | Not a renderer fault: the placeholder follows speed, as SOUND-PLAN 4.4's table asks, and the predictor holds the designed level. The storyboard predictor should read the track (Sound 3) |
| S3 | Shots 3 and 4, the engine | Measured 1 to 3 dB under predicted along the drive (median -1.1 in shot 3, -3.3 in shot 4) | Stills 3 and 4 | The level rule scales each voice on its loudest 100 ms; the prediction adds the swell on top of a flat level. Same cause family as S2: the predictor does not read the voice's own envelope. Sound 3 |
| S4 | Shots 5, 6, 9, 11, 13 | 12 foley cues off their frame | `measure.json` sync, the stills' red rings | Sound 1's misses, unchanged. Sound 3 (derive them from the first drawn motion) |
| S5 | Shot 5, the latches | Both latches live only under 250 Hz and lose 15 to 16 dB on a phone | `measure.json` phone and mono; still 5 (violet) | A placeholder's band (a 200 Hz thump under a 6 ms click). The real latch at Sound 4 needs its energy in the mid band |
| S6 | Shot 5 (0:29 to 0:40) | The densest stretch: 55 onsets in 11 s, 12 voices at 34.6 s, 3 bodies in 10 runs | Still 5, `measure.json` voices and density | Within the plan's bars (3 bodies, 12 of 24 voices). The director judges crowding by ear |
| S7 | Shot 3, the hidden engine | The intake is hidden by building SE from 14.0 to 17.875 s, and at full level only for its last 1.4 s | `decisions/decisions.json`, muffle | The muffle A/B is a gate question with its clips |
| S8 | Shots 8 to 15, the bridge wind | 1.05 dB under its prediction over its span | Still 8's lane head | Within the level plan's reporting; noted for Sound 3 |
| S9 | Everywhere silence is planned | Holds: no onset in shots 1 to 2, 10, 12, 15 | `measure.json` silence; stills 1, 2, 10, 12, 15 | Pass |
