# Round 03: the finished film

Stills in `stills/` (first, middle and last frame of every shot, overlay on) and `contact-sheet.png`, all from the
build that made `out/snowy-bridge.mp4` and `out/snowy-bridge-4k.mp4`. Those files, the per-shot stills and the
thumbnails are not committed (`out/` is ignored; see README.md for how to rebuild them).

## Done means (ROADMAP, Stage 7), checked one by one

| Item | Result | Evidence |
|---|---|---|
| Fades in from black | yes | shot 1 fades over 3 s; frame 0 of the MP4 is black |
| Ends on the final wide | yes | shot 15, 1:40 to 1:52, the pair at the railing under the lamp |
| No audio track | yes | ffprobe: 0 audio streams, in both exports |
| Every beat on screen, in order | yes | a frame every 2 s from the MP4, and the 15 shots' first, middle and last frames here |
| The lamp lights the snow and the ground | yes | shots 1, 6, 7, 8, 15; the snow on the road, sidewalks and deck takes the pool |
| The headlights sweep the buildings and cut out | yes | shot 3 (beams on the facades before the car), cut at 36.2 s in shot 5 with both lit patches in frame |
| The moon rises and backlights | yes | shot 10, the crescent clears the city between the banks; the moonlight ramps to a cool rim |
| Railing wide, concrete, chest high, leaned on with forearms | yes | parapet 1.15 m high and 0.45 m thick; A's elbows 4 cm over the top with the forearms 4 degrees off level, B's 9 cm over at 16 degrees (rig measurements, round 2) |
| 180 degree rule, no jump cuts | yes | every bridge shot (9 to 15) has its camera west of the line; all 14 cuts pass the angle or size step (storyboard/report.json) |
| MP4 and HTML show the same frames | yes | scripts/verify.js: 32 frames matched against fresh renders and five seeks, in both exports (worst 2.50 and 2.37 mean error) |
| Readable at phone size | mostly | every beat reads at 320 px except shot 5's hold (30 to 33 s) and shot 2, which are very dark by design of the light |
| Nothing important in the bottom 120 px | one touch | B's feet in shot 7's last frame sit at 0.891 of the height, 2 px into the strip (0.889); nothing else enters it |

## Known and left as is

- Shot 5's hold is the darkest beat: little lamp light reaches the door side, and a lighter road snow made no visible
  difference. It sits between the bright arrival and the lit reveal.
- B's feet touch the progress-bar strip for the last frames of shot 7 (2 px). It shows only while the bar is up.
- Shot 5's front wheel passes through the frame at up to 5.9% while the camera turns (it was 19%); from the hold no
  gentle move can keep it out (BUILD_LOG, round 2, shot 5).
