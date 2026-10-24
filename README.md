# agent-cutscene-studio

Short films in the style of PlayStation 1 game cutscenes, made in three.js by an AI coding agent (Claude Code) with
a human director. Every frame is a pure function of time, so a film renders identically in the browser and in the
exported MP4, and every step is checked by tests with planted faults. The sound is made the same way: synthesized in
code from the film's own timing, seeded, and heard from each shot's camera.

[![Snow, Lamp, Bridge](films/snow-lamp-bridge/packaging/thumbnail.jpg)](https://youtu.be/F02fKQvjlJQ)

## Films

| Film | Length | Watch | What happens |
|---|---|---|---|
| [Snow, Lamp, Bridge](films/snow-lamp-bridge/) | 1:52 | [YouTube](https://youtu.be/F02fKQvjlJQ) | A street lamp in falling snow; a car pulls up; two people walk onto a bridge, light a cigarette and watch the moon rise. |

## What is here

| Path | What it is |
|---|---|
| `films/<slug>/` | one self-contained film each: source, tests, plan, build log, review rounds, thumbnail |
| `template/` | the starter film: the whole engine (PS1 look, timeline, sound, capture, verify, stills, thumbnails, checks, playback UI) with a small example scene to replace |
| `tools/new-film.mjs` | `node tools/new-film.mjs <slug> "Title"` copies the template to `films/<slug>/` |
| `playbook/` | the process, the rules, the techniques, paste-ready prompts and multi-agent workflow scripts |
| `.claude/skills/` | Claude Code skills: `/new-film`, `/review-round`, `/ship-film` |
| `CLAUDE.md` | what a Claude Code session reads first in this repo |

## Make a film

```
node tools/new-film.mjs rain-on-the-pier "Rain on the Pier"
cd films/rain-on-the-pier
npm ci
npm test && npm run check     # green baseline
npm run dev                   # watch the example scene, then replace it
```

Then follow [playbook/process.md](playbook/process.md), or paste [playbook/prompts/new-film.md](playbook/prompts/new-film.md)
into a Claude Code session.

Needs Node 20 or later, ffmpeg and ffprobe, and Chromium for Playwright (`CHROMIUM_PATH` if it is not found). Python 3
with Pillow for the titled thumbnail.

## Videos

The MP4s are not in git (they are 40 to 75 MB). They are attached to this repo's GitHub releases, and every film can
rebuild its own with `npm run export`.
