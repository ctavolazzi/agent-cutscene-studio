---
name: new-film
description: Start a new PS1-style film in this repo from the template, and write its plan (Stage 0). Use when the director describes a new film, a new scene or a new video to make.
---

# New film

1. Pick a slug (lowercase, hyphens) and a title from the director's words. Run `node tools/new-film.mjs <slug> "Title"`
   from the repo root, then `cd films/<slug> && npm ci && npm test && npm run check` for a green baseline.
2. Read `playbook/process.md` (Stage 0) and `films/snow-lamp-bridge/PLAN.md` as the model.
3. Write `films/<slug>/PLAN.md`: the brief in one sentence, length and delivery, story beats on one clock, the shot list
   (time, lens, framing, move, action), the set in meters (north is -Z, east is +X), characters, the fixed list of
   lights, deliverables, and open questions each with a recommended answer. Write `ROADMAP.md` for this film.
4. Log both in `BUILD_LOG.md` (before and after), commit after the gate (`npm test && npm run check`).
5. Bring the director the questions. That is Gate 0. No em dashes or en dashes anywhere.
