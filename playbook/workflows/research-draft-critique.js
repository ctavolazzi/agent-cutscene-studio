export const meta = {
  name: 'ps1-upgrade-prompt',
  description: 'Research the current Snow, Lamp, Bridge renderer and authentic PS1 cutscene rendering, then draft and adversarially check a handoff prompt for a new chat',
  phases: [
    { title: 'Understand', detail: 'repo inventory, frame audit, PS1 hardware research, PS1 cutscene research' },
    { title: 'Plan', detail: 'gap analysis: what still reads as modern, ranked upgrade list' },
    { title: 'Draft', detail: 'write the handoff prompt' },
    { title: 'Critique', detail: 'repo-fact, PS1-authenticity and fresh-chat usability critics' },
    { title: 'Revise', detail: 'final prompt' },
  ],
}

// Four parallel readers (a code inventory, a frame audit, two web research lenses), a plan, a draft, three independent critics (repo facts, domain accuracy, usability for a fresh session) and a revision. Used to write playbook/prompts/ps1-upgrade.md (stopped early; the prompt was then written by hand). Adapt CONTEXT and the lenses.
// Run with the Workflow tool in Claude Code:
//   Workflow({ scriptPath: 'playbook/workflows/research-draft-critique.js', args: { film: '/abs/path/to/films/<slug>', scratch: '/abs/path/to/a/scratch/dir' } })
// The prompts below are the originals from Snow, Lamp, Bridge (they name its files, shots and decisions); keep the shape,
// rewrite the content for your film.
const FILM = args?.film ?? '/abs/path/to/films/snow-lamp-bridge'
const SCRATCH_DIR = args?.scratch ?? '/abs/path/to/scratch'

const ROOT = FILM
const READ_ONLY = `You are read-only: do not edit, create, commit, build into dist/, or delete anything in ${ROOT} or the git repo. You may run read-only commands (ls, cat, grep, git log, node -e that only imports and prints). Write any scratch files only under ${SCRATCH_DIR}/ps1prompt/. Never write an em dash or en dash character in your output; use commas, colons or parentheses instead.`

const CONTEXT = `Project: "Snow, Lamp, Bridge", a silent 112 s night scene rendered in three.js 0.186 with a PS1 look, in ${ROOT} (at the time a private workbench repo, branch claude/snow-lamp-bridge-scene-kyov3c). It is finished and exported (out/snowy-bridge.mp4 1080p, out/snowy-bridge-4k.mp4). Key docs: README.md, BUILD_LOG.md, PLAN.md, ROADMAP.md, src/CONTRACT.md, review/round-03/notes.md and review/round-03/stills/*.png (first, middle, last frame of all 15 shots at 4x, overlay on). The user now wants a prompt for a NEW chat that upgrades the visuals so the film really feels like a true PlayStation 1 game cutscene.`

phase('Understand')
const [inventory, audit, hardware, cutscenes] = await parallel([
  () => agent(`${CONTEXT}

${READ_ONLY}

TASK: an exact inventory of how the film is rendered today, so a new chat can upgrade it without rediscovering anything. Read src/main.js, src/timeline.js, src/config.js, src/ps1/material.js, src/ps1/post.js, src/textures.js, src/set/build.js, src/set.js, src/actors/people.js, src/actors/car.js, src/fx/*.js, src/hud.js, src/CONTRACT.md, index.html, vite.config.js, package.json, scripts/capture.js, scripts/lib/ffmpeg.mjs, scripts/verify.js, scripts/finals.js, and skim tests/*.test.mjs and scripts/check-*.js for what they pin down.

Report, with file paths and the actual numbers from the code:
1. The render pipeline end to end: internal resolution, render target type, the final pass (fade, sRGB, bit depth, dither pattern), upscale, fps, capture and encode.
2. The PS1 emulation that exists: vertex snap (how, to what grid, which materials), affine warp (how), color quantization, dither, and what is NOT emulated (for example: per-pixel vs per-vertex lighting, fog per pixel vs per vertex, texture sizes and filtering and color depth, CLUT/palettes, z-buffer vs ordering-table sorting, near-plane clipping and polygon subdivision, transparency modes, sprite filtering (LinearFilter cards), frame rate, interlacing, letterboxing, resolution 480x270 vs PS1 modes).
3. Geometry budgets: approximate triangle counts and segment counts of the people (capsules, spheres), the car, the set, the lamp; which use high-segment primitives that read as smooth.
4. Materials and lights: Lambert vs Basic vs ShaderMaterial, the fixed seven lights (and the test that asserts it), shadows (blob shadows), the snow Points shader and its GPU-vs-JS mirror test, glow/cone/smoke sprites.
5. Hard constraints a change must respect: the determinism contract (pure function of t, no Math.random/Date.now/timers outside the playback block, seeded rngFor), check:forbidden (also bans em/en dashes in every text file), check:determinism, check:cameras, tests that pin exact values (list them with what they pin, for example ps1.test.mjs checks every pixel sits on a 5-bit level; lights-snow.test.mjs pins light positions and mirrors the snow shader; set.test.mjs luminance ratios between materials; capture/verify bars), the commit gate (npm test && npm run check), BUILD_LOG.md logging rule.
6. Which config knobs already exist for the look (config.ps1, glow, smoke, footprints, tracks, finals) and where a new look stage or flag would most naturally plug in.
Return a dense, factual markdown report (no recommendations beyond noting what is missing). Cite file:line where useful.`, { label: 'inventory:renderer', phase: 'Understand' }),

  () => agent(`${CONTEXT}

${READ_ONLY}

TASK: a visual audit of the finished film against the target "a true PS1 game cutscene". Look at the images yourself with the Read tool: review/round-03/contact-sheet.png, then at least these stills at full size: shot-01-mid, shot-02-mid, shot-03-mid, shot-04-mid, shot-05-last, shot-06-mid, shot-07-mid, shot-08-mid, shot-09-mid, shot-10-mid, shot-11-mid, shot-12-mid, shot-13-mid, shot-14-mid, shot-15-mid (all in review/round-03/stills/, 1920x1080, nearest-upscaled from 480x270, overlay strip at top), plus out/thumbnails/thumb-A-moonrise.png and out/thumbnails/thumb-B-lighter.png if present. Also look at one or two of the mid-phone.png copies.

For each shot, list concretely what reads as modern or not PS1, and what already reads as PS1. Think like someone who played Metal Gear Solid, Final Fantasy VII/VIII/IX, Silent Hill, Resident Evil 2/3, Parasite Eve, Vagrant Story, Syphon Filter, Dino Crisis: in-engine cutscenes on real hardware. Typical giveaways to check: smooth round capsule people instead of chunky low-poly segmented models with texture-baked faces and clothing; smooth per-pixel light falloff instead of Gouraud per-vertex shading; soft linear-filtered glow sprites; too-fine snow particles or too many; resolution too high (480x270 vs 320x240 or 256x224 class); 16:9 full frame instead of 4:3 with letterbox bars for cutscenes; fog that is too smooth; textures too clean or too few (PS1 scenes were densely textured with small 64 to 128 px pages, baked lighting into vertex colours); missing vertex wobble visibility; dithering visible or not; colour banding; missing near-plane polygon popping and texture swimming; camera moves too smooth (PS1 cutscenes often used cuts and simple pans); character animation too smooth or too IK-perfect; missing subtitle-style or letterbox framing; frame rate (24 vs 30 or 15/20 fps character animation).
Be specific (shot number, what you see, where in the frame). Also note what is already strong and must be kept (composition, lamp, moon, snow mood, footprints, smoke). Return markdown: per-shot notes, then a ranked list of the 15 biggest "not PS1" giveaways with the shots where each is most visible.`, { label: 'audit:frames', phase: 'Understand' }),

  () => agent(`${CONTEXT}

${READ_ONLY}

TASK: research the authentic PlayStation 1 rendering pipeline precisely, so an upgrade can emulate it faithfully in three.js/WebGL rather than by vibes. Use WebSearch and WebFetch (load them with ToolSearch: query "select:WebSearch,WebFetch") and favour primary or expert sources: the psx-spx / "Everything You Have Always Wanted to Know about the Playstation" (nocash psx-spx) documentation, the PSn00bSDK docs, Sony LIBGPU/LIBGTE references, emulator developer writeups (Duckstation, Mednafen, PCSX-Redux), and well-known technical breakdowns (for example retro rendering articles on affine texture mapping, GTE precision, ordering tables).
Cover, with concrete numbers where they exist:
- Display modes and resolutions (256/320/368/512/640 x 240 or 480 interlaced), NTSC timing, 30 vs 60 fps, what cutscenes typically ran at, 24-bit vs 15-bit framebuffer.
- The GPU: 2D rasterizer only, no z-buffer (ordering tables, painter's sorting, sorting artefacts and z-fighting-like popping), no perspective-correct texturing (affine per triangle, why devs subdivided polygons), no sub-pixel precision (integer vertex coordinates, hence jitter), no texture filtering, no mipmaps, Gouraud shading per vertex, flat shading, 15-bit colour with an optional dither (the exact 4x4 dither matrix the PS1 used and its offsets), semi-transparency modes (B/2+F/2, B+F, B-F, B+F/4), texture windows, mask bit.
- Textures: VRAM 1 MB, texture pages 256x256, 4-bit and 8-bit CLUT (palette) textures and 15-bit direct, typical texture sizes in 3D games (32 to 128 px), texture colour depth and the look of palettised textures.
- The GTE: fixed point maths, 16-bit screen coordinates, perspective transform precision, depth cueing (the far colour fog done per vertex with the DQA/DQB registers), lighting per vertex (light matrix, colour matrix, ambient), near clipping behaviour (polygons dropped or popping near the camera), typical polygon budgets per frame and per character (for example how many triangles MGS or FF8 in-engine characters used).
- Output: composite video softness and dot crawl are optional post effects; note which are hardware and which are TV artefacts.
Return a structured markdown reference: each item with the hardware fact, the visible effect, and how to emulate it in three.js/WebGL (shader or geometry technique), plus a source URL for each fact. Flag anything you could not confirm.`, { label: 'research:ps1-hardware', phase: 'Understand' }),

  () => agent(`${CONTEXT}

${READ_ONLY}

TASK: research what PS1 in-engine (real-time, not FMV) cutscenes looked and felt like, so the new chat knows the art direction target. Use WebSearch and WebFetch (load with ToolSearch: "select:WebSearch,WebFetch"). Look at how cutscenes were presented in Metal Gear Solid, Final Fantasy VII, VIII and IX (field scenes), Silent Hill, Resident Evil 2 and 3, Parasite Eve, Vagrant Story, Syphon Filter, Dino Crisis, Legacy of Kain: Soul Reaver, Tomb Raider, Ape Escape, Spyro (night levels), and any snowy or night street scenes on the PS1. Also look at the modern "PS1 style" indie and homage scene (Haunted PS1, PSX-style shaders for Unity and Godot, for example "PSX shader kit", retro3d, the "Fatal Frame"-like homages) for the common checklist they use and which of those effects are authentic vs exaggerated.
Cover:
- Framing and presentation: 4:3, letterbox bars in cutscenes, title cards, subtitles style (no dialogue here, but a location card or chapter title could fit), fades and wipes, camera grammar (static shots, simple pans and dollies, cuts on action), typical lens/FOV.
- Characters: polygon counts, segmented rigid limbs vs skinned, faces as textures, hands as mittens or blocks, hair as textured shells, idle animations, animation frame rates and keyframe stepping, lip movement absent.
- Lighting and atmosphere: baked vertex colours, distance fog or depth cueing to a colour, black fog in Silent Hill vs coloured fog, glow faked with additive sprites, lamp halos, snow and rain as sprites or line particles, particle counts.
- Environment: texture density, tiled 64 to 128 px textures with visible repeats, pre-lit vertex colour gradients, skyboxes, billboard trees and props, draw distance.
- Colour and image: palettised textures, posterisation, dithering visibility, 15-bit banding, the slight softness of composite output, and what makes a frame instantly read as PS1 in a YouTube thumbnail.
Return a structured markdown guide: an art-direction target, a checklist of authentic traits ranked by how strongly they signal "PS1", and a list of common over-exaggerations to avoid, each with a source or example game.`, { label: 'research:ps1-cutscenes', phase: 'Understand' }),
])

log('Understand done: ' + [inventory, audit, hardware, cutscenes].map((x) => (x ? 'ok' : 'missing')).join(', '))

phase('Plan')
const plan = await agent(`${CONTEXT}

${READ_ONLY}

You have four reports. Build the upgrade plan the new chat will execute.

=== CURRENT RENDERER INVENTORY ===
${inventory}

=== VISUAL AUDIT OF THE FINISHED FRAMES ===
${audit}

=== PS1 HARDWARE REFERENCE ===
${hardware}

=== PS1 CUTSCENE ART DIRECTION ===
${cutscenes}

Produce:
1. A gap table: each authentic PS1 trait, what the film does today (with file), the gap, and the visible impact (high, medium, low).
2. A staged upgrade plan (stages the new chat can gate on), ordered by visible impact per unit of risk. For each item: what to change, the technique in three.js/WebGL terms, the files it touches, the config knob it should add (everything tunable lives in src/config.js), how to verify it (a measurable check and a planted-fault control in the repo's style, plus which frames to look at), and which existing tests or bars it will break and how to update them honestly (a test that pins the old design is rewritten to check the same property on the new design, never loosened silently; record why in BUILD_LOG.md).
   Consider at least: resolution and aspect (320x240 class internal resolution with 4:3 and cutscene letterbox, or keep 16:9 delivery with pillar or letterbox, and what that does to cameras, shots.js framing helpers, check:cameras, capture sizes and upscale integer factors, verify, thumbnails); per-vertex Gouraud lighting and per-vertex depth-cue fog instead of per-pixel; 15-bit colour with the authentic PS1 dither matrix instead of the current 5-bit Bayer pass; vertex snap at the true internal grid; affine warp plus polygon subdivision choices; ordering-table style sorting artefacts (optional, risky); near-plane popping; low-poly segmented character models with texture-baked faces and clothes, mitten hands, chunky silhouettes, replacing smooth capsules while keeping the rig, poses and timing in people.js; car and set re-modelled low-poly with denser, palettised 64 to 128 px textures and baked vertex-colour lighting; point/nearest-filtered glow sprites and semi-transparency modes; snow as chunky sprites; character animation stepped at 15 or 20 fps while the camera stays at the film rate (or the whole film at 30 fps); camera grammar tweaks; an optional subtle composite or CRT pass as a separate toggle (default off for the master, maybe on for thumbnails); a title or location card.
3. Risks and what must not change: the story beats, shot timing, compositions that already work, the determinism contract, the seven-light rule (or how to change it honestly), the user's rules (no em or en dashes anywhere, log every step in BUILD_LOG.md before and after, commits only on the designated branch, PR stays draft and is never watched, every video gets a thumbnail checked at 320 px).
Return markdown.`, { label: 'plan:gaps', phase: 'Plan' })

phase('Draft')
const draft = await agent(`${CONTEXT}

${READ_ONLY}

Write the handoff PROMPT the user will paste into a brand new chat (a Claude Code cloud session with the repo ctavolazzi/_workbench available) so that chat upgrades the film's visuals into a true PS1 game cutscene. The new chat starts with zero memory of this conversation, so the prompt must carry everything it needs, but it must point to files instead of pasting their contents.

Use these materials:
=== UPGRADE PLAN ===
${plan}

=== CURRENT RENDERER INVENTORY (for exact file names and numbers) ===
${inventory}

=== PS1 HARDWARE REFERENCE (for exact facts) ===
${hardware}

=== CUTSCENE ART DIRECTION ===
${cutscenes}

Requirements for the prompt:
- Opening: what the project is, where it lives (repo ctavolazzi/_workbench, folder snowy-bridge/, branch claude/snow-lamp-bridge-scene-kyov3c, draft PR #13), the state it is in (finished, exported, all checks green, last commit ddcb1a7), and the goal in one sentence.
- A "read first" list in order: README.md, src/CONTRACT.md, BUILD_LOG.md (tail sections from Stage 4 on), PLAN.md and ROADMAP.md, review/round-03/notes.md and contact-sheet.png, src/config.js, src/ps1/*.js.
- Working rules, stated exactly: commit and push only to the designated branch; keep the PR a draft; never subscribe to or watch PR activity; no em dashes or en dashes in any file or message (check:forbidden enforces it in files); log each step in BUILD_LOG.md before and after taking it; commits only after npm test && npm run check pass (a for-loop of test files does not stop on failure; that let a failing test into a commit once); never put a model name or identifier in commits or the PR; every video gets a thumbnail checked at 320 px wide; the user does not want a review stop between stages unless a decision is genuinely theirs: show progress with frames, keep building.
- The art direction target in a short paragraph, naming reference games, and the list of what must NOT change (story beats, shot list and timings, the compositions that work, footprints, smoke, the lamp and moon moments).
- The staged plan (from the upgrade plan), each stage with: the changes, the technique, the files, the config knobs, the verification (measurement plus a planted-fault control, and the specific frames to look at), and which tests or bars it will touch and how to update them honestly. Mark which items are optional or risky.
- The verification and delivery loop for the end: storyboard regenerate, review round (node scripts/blockout-review.js --round 04), npm run export, node scripts/verify.js (note the verify bars were measured for the current look; a new colour pipeline means re-measuring the encoder floor and setting the bar from the measurement, with a planted fault), 4K capture from the same build, npm run finals for stills and three thumbnails checked at 320 px, README and review notes updated, BUILD_LOG entries, commit, push, update the draft PR description.
- Practical environment notes: headless Chromium with SwiftShader (software WebGL, so renders are slow: about 100 ms a frame at 480x270, 200 ms at 4K capture), 4 CPUs, ffmpeg present, Playwright via playwright-core, scripts/lib/browser.mjs opens dist/index.html in capture mode, workflows/subagents can hit usage limits so commit work in small gated steps.
- Tone: direct, numbered, scannable. Use exact paths. No em dashes or en dashes anywhere in the prompt (use commas, colons, parentheses). Aim for something a person can paste in one go: thorough but not padded, roughly 1200 to 2200 words.
Return ONLY the prompt text, nothing before or after it.`, { label: 'draft:prompt', phase: 'Draft' })

phase('Critique')
const CRIT_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, quote: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'problem', 'fix'] } } }, required: ['verdict', 'issues'] }
const critiques = await parallel([
  () => agent(`${CONTEXT}

${READ_ONLY}

You are a skeptical fact checker. Check every factual claim this handoff prompt makes about the repository against the repository itself: file and folder paths exist, script names and npm scripts exist (package.json), config keys exist with the stated values, test names and what they pin are right, commit hash ddcb1a7 is HEAD of the branch, numbers (resolution, fps, bit depth, light count, timings, shot count, sizes) match the code. Run ls, grep, git log and node -e imports to confirm. Also check the prompt contains no em dash (U+2014) or en dash (U+2013) characters: run a check on the text (save it to the scratch dir and grep with a Python one-liner for those code points). Report every wrong or unverifiable claim with the exact quote and the fix.

=== PROMPT ===
${draft}`, { label: 'critic:repo-facts', phase: 'Critique', schema: CRIT_SCHEMA }),
  () => agent(`${CONTEXT}

${READ_ONLY}

You are a PS1 rendering expert and a skeptic. Check this handoff prompt for technical accuracy about the PlayStation 1 and for whether its plan would actually produce something that reads as a true PS1 in-engine cutscene rather than a modern "PSX shader" cliche. Verify hardware claims (resolutions, 15-bit colour, the dither matrix values and how the PS1 applied dithering, affine mapping, no z-buffer and ordering tables, GTE precision and vertex jitter, depth cueing, per-vertex Gouraud lighting, texture pages and CLUTs, semi-transparency modes, frame rates). Use WebSearch/WebFetch (ToolSearch "select:WebSearch,WebFetch") to confirm anything doubtful, preferring psx-spx/nocash and emulator sources. Flag exaggerations that would look wrong (for example jitter far stronger than hardware, wobble on a static camera, heavy CRT effects in the master), missing high-impact traits, and techniques that are wrong for WebGL/three.js 0.186. Here is the research the prompt was built from, for reference:
${hardware}

=== PROMPT ===
${draft}`, { label: 'critic:ps1-accuracy', phase: 'Critique', schema: CRIT_SCHEMA }),
  () => agent(`${CONTEXT}

${READ_ONLY}

You are a fresh Claude Code session that has just been handed this prompt with no other context, sitting in a cloud container with the repo checked out. Read the prompt, then actually open the files it points to (README.md, src/CONTRACT.md, src/config.js, src/ps1/*.js, BUILD_LOG.md tail, tests it mentions) and judge: Could you start immediately and execute stage by stage? Is anything ambiguous (which branch, what counts as done per stage, what to do when a test pins old behaviour, when to ask the user vs proceed, what the deliverables are and where they go, how big each commit should be)? Is anything missing that you would need (environment limits, how long renders take, how to view frames, the commit gate, the dash rule, the thumbnail rule, PR handling)? Is it padded or repetitive anywhere? Is the order of stages sensible for risk (cheap global look changes first, model rebuilds later)? Report concrete issues with fixes.

=== PROMPT ===
${draft}`, { label: 'critic:fresh-chat', phase: 'Critique', schema: CRIT_SCHEMA }),
])

phase('Revise')
const issues = critiques.filter(Boolean).flatMap((c, i) => (c.issues || []).map((x) => ({ critic: ['repo-facts', 'ps1-accuracy', 'fresh-chat'][i], ...x })))
log(`Critics returned ${issues.length} issues (${issues.filter((x) => x.severity === 'blocker').length} blockers, ${issues.filter((x) => x.severity === 'major').length} major)`)
const final = await agent(`${CONTEXT}

${READ_ONLY}

Revise this handoff prompt using the critics' findings. Fix every blocker and major issue; apply minor ones when they make the prompt clearer or more correct; if you reject a finding, it must be because you checked and it is wrong (you may re-check the repo or the web). Keep it direct, numbered, scannable, roughly 1200 to 2200 words, exact paths, no padding. Absolutely no em dash (U+2014) or en dash (U+2013) characters anywhere: after writing, save the text to ${SCRATCH_DIR}/ps1prompt/final.md and confirm with a Python one-liner that neither code point occurs; fix and re-save if they do.

=== DRAFT PROMPT ===
${draft}

=== CRITIC FINDINGS (JSON) ===
${JSON.stringify(issues, null, 1)}

Return ONLY the final prompt text, nothing before or after it.`, { label: 'revise:prompt', phase: 'Revise' })

return { final, issues, plan }
