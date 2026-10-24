# Workflow scripts

Multi-agent scripts for Claude Code's Workflow tool, kept from Snow, Lamp, Bridge as worked examples. Each starts with
a `meta` block and takes `args.film` (the film folder) and `args.scratch` (a scratch directory outside the repo).
Their prompts still describe Snow, Lamp, Bridge; keep the shape and rewrite the content for your film.

| Script | Shape | Use it for |
|---|---|---|
| `builders-with-checkers.js` | N builders, each in its own git worktree and branch, each followed by a checker that re-runs every check and tries to break the result | applying several independent gate answers at once |
| `review-with-skeptics.js` | one reviewer per lens, then one skeptic per reviewer who tries to refute each finding | reviewing a contact sheet, a cut, a review page |
| `research-draft-critique.js` | parallel readers and web research, a plan, a draft, three critics (facts, domain accuracy, usability), a revision | writing a handoff prompt or a design doc that must be right |

Lessons from running them:

- Builders can stop on usage limits mid-task. Have them commit small, and when one stops, take its worktree diff
  (`git -C <worktree> diff > patch`), apply it on the main branch, and check it yourself.
- A checker that only reads the builder's report finds little; tell it to re-run every check and to look at frames.
- Concurrency is capped by CPUs; software WebGL renders are heavy, so two builders at a time on 4 CPUs is plenty.
- Do not use a workflow where one careful pass would do. The director noticed and said so.
