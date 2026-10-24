---
name: review-round
description: Run a review round on a film in this repo - stills of every shot, a contact sheet, an independent look at the frames, and notes with findings and decisions. Use at a gate, after a batch of changes, or when the director asks how the film looks.
---

# Review round

Run from `films/<slug>/`.

1. `npm run build`, then the review set: `node scripts/blockout-review.js --round NN` (first, middle and last frame of
   every shot at 4x, phone copies, `review/round-NN/contact-sheet.png`). Use the next free NN.
2. Look at the contact sheet and every middle still yourself with the Read tool, at full size and phone size. Lift dark
   frames to judge staging (`ffmpeg -i in.png -vf "curves=all='0/0 0.25/0.6 1/1'" out.png`).
3. For a gate, get an independent read: reviewers with one lens each and a skeptic per finding
   (`playbook/workflows/review-with-skeptics.js`), only if the director wants that depth.
4. Measure every problem you report (a share of the frame, a distance, a screen position) with `scripts/lib/math.js`
   `makeCamera(cameraAt(shot, t), 960, 540).project(p)`, and render the frames at the moment in question.
5. Write `review/round-NN/notes.md`: findings with evidence, what you fixed, what is left and why, decisions with a
   recommended answer. Log in `BUILD_LOG.md`, gate, commit. No em dashes or en dashes.
