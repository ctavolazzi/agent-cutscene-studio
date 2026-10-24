---
name: ship-film
description: Final export of a film in this repo - 1080p and 4K MP4s with sound from one build, verify both, per-shot stills, thumbnail candidates and a titled thumbnail checked at 320 px, README, final review notes, YouTube description. Use when a film is ready to deliver.
---

# Ship a film

Run from `films/<slug>/`. Log each step in `BUILD_LOG.md` before and after.

1. `npm test && npm run check` must pass first.
2. `npm run export` (builds once and renders `out/sound.wav` first), then `npm run verify` (frames and sound sync).
   If the image pipeline changed since the bars were set, re-measure the encoder floor and confirm the identity
   check still catches a planted one-frame offset. A silent film by brief: `--silent` on verify, no `--audio`.
3. From the same build: `node scripts/capture.js --profile 4k --audio out/sound.wav`,
   `node scripts/verify.js --profile 4k`, `npm run finals`.
4. Pick the strongest frames for `CONFIG.finals.thumbs`, rerun finals, look at `out/thumbnails/sheet-320.png`. Make the
   titled thumbnail: `python3 scripts/title-thumbnail.py out/thumbnails/<best>.png packaging/thumbnail 4 <x> <y> <size> <gap>`
   and check `packaging/thumbnail-320.png`. Every video gets a thumbnail.
5. Update `README.md` (deliverables, re-export, playback keys, config table, shot list). Run a final review round and
   check the "done means" list item by item in its `notes.md`.
6. Gate, commit, push, update the draft PR (do not watch it). Send the director both MP4s and the thumbnail as files;
   the MP4s go to a GitHub release, not git.
7. Write the YouTube title, description and chapters with `playbook/prompts/youtube.md`. No em dashes or en dashes.
