# Prompt: start a new film

Paste into a new Claude Code session that has this repo, after filling in the brackets.

```
Make a new film in agent-cutscene-studio (this repo). Read CLAUDE.md, playbook/process.md and playbook/rules.md first,
and skim films/snow-lamp-bridge (README.md, PLAN.md, BUILD_LOG.md) as the worked example.

The film: [one or two sentences: what happens, where, who]
Length: [seconds]. Mood and references: [games, films, time of day, weather]. Ending frame: [the last image].
Anything that must be in it: [beats, props, a specific shot].

Start it with node tools/new-film.mjs [slug] "[Title]", then do Stage 0: write films/[slug]/PLAN.md (beats on one clock,
the shot list with lenses, the set in meters, characters, the fixed lights, deliverables) and ROADMAP.md, and bring me
the open questions, each with your recommended answer. After that, follow the stages in playbook/process.md and stop
only at the gates. Log every step in BUILD_LOG.md before and after. Commit only after npm test && npm run check pass.
No em dashes or en dashes anywhere. Every video gets a thumbnail checked at 320 px. Do not watch the PR.
```
