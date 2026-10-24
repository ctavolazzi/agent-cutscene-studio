export const meta = {
  name: 'gate2-page-review',
  description: 'Independent check of the Gate 2 review page: facts, corrections, function, clarity, then skeptics',
  phases: [
    { title: 'Review', detail: 'four independent reviewers, one lens each' },
    { title: 'Verify', detail: 'one skeptic per reviewer tries to refute its findings' },
  ],
}

// Gate 2 of Snow, Lamp, Bridge: four independent reviewers, one lens each (facts, corrections, function, clarity), then one skeptic per reviewer that tries to refute its findings. Adapt COMMON and the lenses to what you are reviewing (a contact sheet, a review page, a cut).
// Run with the Workflow tool in Claude Code:
//   Workflow({ scriptPath: 'playbook/workflows/review-with-skeptics.js', args: { film: '/abs/path/to/films/<slug>', scratch: '/abs/path/to/a/scratch/dir' } })
// The prompts below are the originals from Snow, Lamp, Bridge (they name its files, shots and decisions); keep the shape,
// rewrite the content for your film.
const FILM = args?.film ?? '/abs/path/to/films/snow-lamp-bridge'
const SCRATCH_DIR = args?.scratch ?? '/abs/path/to/scratch'

const P = FILM
const SCRATCH = `${SCRATCH_DIR}/wf`

const COMMON = `
Project: a three.js scene "Snow, Lamp, Bridge" in ${P}. Stage 2 (grey-box blockout) is done and waits on six decisions from the user (Gate 2).
I (the main session) built a phone review page for Gate 2 and want it checked before it is published to the user.

Files:
- The page content: ${P}/out/gate2-page/review-page.html (the viewer wraps it in doctype/head/body at publish time).
- A local wrapped copy for a browser: ${P}/out/gate2-page/_local.html (open with file://; images and video are beside it; window.claude is absent there, so the answer store is unavailable and the page falls back to local storage).
- Page generator: ${P}/scripts/blockout-page.js. Measurement script: ${P}/scripts/gate2-measure.js, output ${P}/review/round-02/measure.json.
- Gate sources: ${P}/review/round-02/notes.md (the gate notes; a "Corrections, 2026-10-22" section was added today), findings.json (28 panel findings), stills.json, preview.mp4.json, stills/, decisions/ (extra frames at decision moments, named tSSS.mmm.png), panels/.
- Data (source of truth): ${P}/src/set.js (north is -Z, east is +X), src/world.js, src/shots.js, src/actors/car.js, src/actors/people.js, src/fx/lights.js, src/config.js. Plan and log: PLAN.md, ROADMAP.md, BUILD_LOG.md.
- Helpers: ${P}/scripts/lib/math.js (makeCamera, project), scripts/stills.js (node scripts/stills.js --times 35.5,36 --outdir <dir> --scale 4 --overlay 1 renders frames from dist/index.html, which is built).
- Playwright: import { chromium } from '${P}/node_modules/playwright-core/index.mjs' and { chromiumPath } from '${P}/scripts/lib/raster.mjs'; launch with executablePath: chromiumPath(). A scratch script cannot resolve packages by name, so import by absolute path.

Rules: this is a read-only review. Do not edit, create or delete anything inside ${P} (writing renders to your own scratch dir is fine: use ${SCRATCH}/<your-lens>/). Do not commit or push. Write without em dashes or en dashes.
Report only real problems you can show with evidence (a number you recomputed, a line of code, a screenshot you looked at). Severity: high = the user could decide wrongly or the page is broken; medium = misleading, inaccurate or a noticeable defect; low = polish. If you find nothing at a level, say nothing at that level. Give each finding a short id like F1.`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string', description: 'decision number, section or file:line' },
          problem: { type: 'string' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['id', 'severity', 'where', 'problem', 'evidence', 'fix'],
      },
    },
  },
  required: ['summary', 'findings'],
}

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'unsure'] },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          reason: { type: 'string' },
        },
        required: ['id', 'verdict', 'severity', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

const LENSES = [
  {
    key: 'facts',
    prompt: `${COMMON}

Your lens: FACTS. Check every number and factual claim the page states against its sources. That includes the header facts, the "Start here" list, each of the six decision cards (body text, correction boxes, recommendation boxes, the wheel table, option details, frame captions and their times), the shot-by-shot section (titles, times, lenses, which findings are attached to which shot and with what result), the findings summary counts, the checks cards, and the footer.
Recompute independently where you can (for example: door and headlight times from src/world.js carTimes; lamp position and pool radius from src/set.js; parapet height; shot times and lenses from src/shots.js; counts from findings.json and notes.md; preview frame count and timings from preview.mp4.json; stills timing from stills.json). Check that each frame image a decision shows is the time its caption says (the overlay in each PNG prints the time; open a few with the Read tool). Check that measure.json agrees with what the page prints, and spot-check measure.json itself by re-running pieces of the maths.`,
  },
  {
    key: 'corrections',
    prompt: `${COMMON}

Your lens: TRY TO REFUTE MY CORRECTIONS. Today I changed parts of two Gate 2 decisions and two recommendations. Default to skepticism: show me where I am wrong.
1. Decision 1: I say the notes' option "move the lamp 1.5 m north" goes the wrong way, because north is -Z and the car doors are at +Z of the lamp, so the move makes the doors darker. Check the coordinate convention (set.js header, scripts/lib/math.js), the lamp base, the car stop and where each person's boot lands (world.js peopleAt at 31.8 and 33.2). Also check my claim that the headlights point north and cut at 36.2 s after both boots land, so they never light the landings (src/fx/lights.js, world.js headlights()). And check the darkness numbers (shot 5 averages 1.4 to 1.9 of 255 from 30.5 to 35.0 s): is cropping the overlay and averaging luma a fair measure? Do the frames really show nothing at normal viewing? Is my new recommendation (a courtesy light under each open door, off before the headlight cut, "so the shot still ends on lamp light only") consistent with shot 5's text in src/shots.js and PLAN.md 3.9 and the brief as PLAN.md quotes it? Is option (b) (lamp 1.5 m south) described correctly, including which shots frame the lamp?
2. Decision 4: I say the notes' option "50mm lens, camera 0.5 m further back" does not shrink the front tyre, because image size goes with focal length over distance, and that about 1.5 m back halves it. Check the wheel position I used (scripts/gate2-measure.js WHEEL vs src/actors/car.js SHAPE.wheel and the car's heading and stop), the convex-hull coverage method, and the step-back direction. Render a frame or two if useful. Is the tyre really what dominates the frame at 35 to 36 s?
3. Decision 3: I now lean toward B trailing further because the heads are closer than 0.04 of the frame from 56.1 to 58.3 s and "the two coats read as one dark shape". Check the measurement and look at decisions/t057.583.png.
4. Decision 6: I say the car still drifts right, against its direction of travel, from 0.415 to 0.623 of the frame after the pan starts. Check it.
For each item, either confirm with evidence or report a finding.`,
  },
  {
    key: 'function',
    prompt: `${COMMON}

Your lens: DOES THE PAGE WORK. Drive ${P}/out/gate2-page/_local.html in headless Chromium with Playwright, at 390x844 and 1280x900, with colorScheme dark and light. Look at your screenshots with the Read tool (crop tall full-page shots into pieces). Check:
- No horizontal page scroll at either width; nothing overlaps or clips; text contrast is readable in both themes (buttons, chips, the "Recommended" tag, the selected option).
- The Lift switch in the sticky bar (#lift) and the per-card "Lift shadows" buttons: every frame image with data-lift swaps to its lift/ copy and back, the preview video switches to lift/preview.mp4 and keeps its time, and every lifted file exists. Look at one lifted frame from shot 5 to confirm the staging becomes visible.
- "Play the preview from" buttons seek the video to the stated time.
- The lightbox opens on a frame tap and closes.
- Answers without a store (window.claude absent): picking options updates "N of 6 answered" and the status line; notes save; Copy answers produces correct text (the clipboard may refuse in headless; the fallback textarea must then show the right text).
- Answers with a store: use page.addInitScript to define window.claude = { use: async (name) => name === 'db' ? mockDb : null } where mockDb has doc(path).set(body) recording writes and returning a promise, and collection(path).onSnapshot(next, err) that you can drive. Check that picking an option writes answers/dN once with the right choice and label, that rapid changes never run two writes to one document at the same time, that a snapshot from elsewhere sets the radio and note, and that a rejected set with code invalid_argument shows a useful status. The real store API is in the artifact-capabilities skill (db.d.ts) (doc snapshots have id, exists, data()).
- Any console error or page error.`,
  },
  {
    key: 'clarity',
    prompt: `${COMMON}

Your lens: CAN THE USER DECIDE. Read the page the way the user will: on a phone, not an engineer on this code, wanting to answer six decisions quickly. Use the page text (review-page.html) and look at the frames each decision shows (open them with Read; the shot 5 frames are nearly black, so also open the lifted copies under ${P}/out/gate2-page/lift/decisions/).
For each decision: can it be answered from its card alone? Are the options distinct, accurately described, with the consequence of each stated? Is any recommendation justified by what the card shows? Is anything the user needs missing compared with the original six decisions in ${P}/review/round-02/notes.md (section "Decisions for Gate 2") and the corrections section? For example, decision 2 originally asked whether 1.30 m came from the brief: is that question still clear? Flag jargon that will confuse a non-engineer (for example "-Z", "sx", "set.js", "the look stage", "4.8") where plainer words would do, wording that misleads, sentences that are hard to parse, and anything that reads as filler. Also check the "Start here" list and the reply hint ("go", or numbers and letters) match the options that exist.`,
  },
]

phase('Review')
const results = await pipeline(
  LENSES,
  (l) => agent(l.prompt, { label: `review:${l.key}`, phase: 'Review', schema: FINDINGS }),
  (rev, l) => {
    if (!rev || !rev.findings || rev.findings.length === 0) return { lens: l.key, summary: rev ? rev.summary : 'no result', findings: [], verdicts: [] }
    const list = rev.findings.map((f) => `- ${f.id} [${f.severity}] at ${f.where}: ${f.problem}\n  evidence: ${f.evidence}\n  proposed fix: ${f.fix}`).join('\n')
    return agent(`${COMMON}

You are a skeptic. Another reviewer (lens: ${l.key}) reported the findings below about the Gate 2 review page. For EACH one, try to refute it by checking the actual files, code and images yourself. Default to "refuted" when the evidence does not hold up, "confirmed" only when you reproduced it, "unsure" when you could not check. Re-rate severity (high, medium, low) for confirmed ones.

Findings:
${list}`, { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICTS })
      .then((v) => ({ lens: l.key, summary: rev.summary, findings: rev.findings, verdicts: v ? v.verdicts : [] }))
  },
)

const out = results.filter(Boolean)
for (const r of out) {
  const c = r.verdicts.filter((v) => v.verdict === 'confirmed').length
  log(`${r.lens}: ${r.findings.length} findings, ${c} confirmed`)
}
return out
