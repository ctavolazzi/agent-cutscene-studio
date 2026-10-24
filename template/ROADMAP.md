# Roadmap

The stages, in order. Each ends at a gate: stills, measurements and the open decisions go to the director. The full
process, and what each gate package contains, is in the repo's playbook/process.md.

0. **Plan.** PLAN.md: brief, beats, shot list, set, characters, lights, rules, questions.
1. **Storyboard.** A top-down map of the set with every camera and its field of view, one panel per shot, checks for
   the 180 degree line, screen direction and the bottom 120 px strip. Gate 1.
2. **Blockout.** Grey boxes for everything, every camera live, every timing live, capture working. A review round
   (`npm run review`), an independent review of the stills, and measurements behind every decision. Gate 2.
3. **Revisions** from the gate answers, one gated commit each.
4. **Look.** PS1 pass (snap, warp, colour depth, dither), textures, fog, lights tuned, glows. Key stills. Gate 3.
5. **Animation and effects.** Characters, props, particles, derived details (prints, tracks), playback UI, export,
   verify. Gate 4.
6. **Polish rounds** from notes, each with a fresh review round.
7. **Final.** Export 1080p and 4K from one build, verify both, stills, thumbnails (checked at 320 px), titled
   thumbnail, README, a review round with the "done means" list checked item by item.

Done means: fades in and ends where the brief says; no audio unless asked; every beat on screen in order; the 180
degree rule holds; the MP4 and the HTML show the same frames; readable at phone size; nothing important in the bottom
120 px of 1080.
