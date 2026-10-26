// The traceability control (SOUND-PLAN 4.2, Sound 1.5): makeCues against a perturbed picture, one input family at a
// time, each in a child process where a module hook (perturb-hooks.mjs) serves a patched copy of world.js, set.js,
// shots.js or actors/car.js to every importer. So people.js and footprints.js, which import world.js themselves, see
// the change, and footprintList()'s module cache starts fresh. No picture file changes on disk.
//   Parent: await perturbAll({ only, extra }) -> { perturbations, observed, base } for sound-checks.js's trace check.
//   Child:  node scripts/lib/perturb.mjs --child <id | none> [--extra <file url>] prints a snapshot of the cues.
// Each perturbation names the inputs it changes (`tokens`, as a cue's derivedFrom would name them), a probe that
// proves the hook reached its constant, and its time shift where it is one. Only node built-ins are imported at the
// top, so the child registers the hook before any picture module loads.
import { spawn } from 'node:child_process';
import { register } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const url = (p) => pathToFileURL(resolve(ROOT, p)).href;
const WORLD_JS = url('src/world.js'), SET_JS = url('src/set.js'), SHOTS_JS = url('src/shots.js'), CAR_JS = url('src/actors/car.js');
// a top-level `const NAME = value;` (exported or not) moved by d
const shiftConst = (name, d) => ({ find: `^((?:export )?const ${name} = )([^;\\n]+);`, with: `$1($2) + ${d};` });
// the first instant f(t) > 0 on [0, 1000], by bisection to 1e-12 s (a probe for a ramp's start)
const firstPositive = (f) => { let lo = 0, hi = 1000; if (f(lo) > 0) return lo; while (hi - lo > 1e-12) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; } return hi; };

// The perturbations: times first, then places. `place` is filled in from the unperturbed LOCATIONS: the first shot of
// the second place, whose start is the place change. The people's keys move by 1/8 s, not the plan's 0.1 s: 1/8 s is a
// whole number of the rig's table steps (1/120 s), print steps (1/48 s) and audio samples, exactly in floating point,
// so a pure time shift of the rig is bit exact. Measured with 0.1 s: A's ankle moves by up to 25 um round 40.4 s (a
// table sample lands on a key time on one side of the rounding and not the other) and step A.16 by one sample less.
// One person's keys name that person's inputs (`tokens`, for any cue) and the people's shared ones (`shared`, which
// count only for a cue of that person or of no one), so a cue of A's that reads B's keys is caught by the report too.
export function makePerturbations({ placeShot }) {
  const people = ['PEOPLE_KEYS', 'makePoser', 'footprintList'];
  const keys = (id) => ({ id: `keys.${id}`, label: `PEOPLE_KEYS.${id} +0.125 s`, shift: 0.125, person: id, tokens: [`PEOPLE_KEYS.${id}`, `makePoser('${id}')`], shared: people, patches: [{ url: WORLD_JS, append: `for (const k of PEOPLE_KEYS.${id}) k.t += 0.125;` }], probe: (W) => W.PEOPLE_KEYS[id][0].t, want: (b) => b + 0.125 });
  const door = (tag) => ({ id: `doors.${tag}`, label: `carTimes.doors.${tag} +0.5 s`, shift: 0.5, tokens: [`carTimes.doors.${tag}`, 'carTimes.doors open0', 'doorOpen'], patches: [{ url: WORLD_JS, append: `for (const k of ['open0', 'open1', 'close0', 'close1']) carTimes.doors.${tag}[k] += 0.5;` }], probe: (W) => W.carTimes.doors[tag].open0, want: (b) => b + 0.5 });
  return [
    keys('A'), keys('B'),
    { id: 'car.start', label: 'carTimes.start +0.5 s (the drive with it; the stop stays)', shift: 0.5, tokens: ['carTimes.start', 'carTimes.brake', 'turn0', 'turn1', 'carAt', 'headlights', 'steerDeg'], patches: [{ url: WORLD_JS, replace: [shiftConst('T_START', 0.5)] }], probe: (W) => W.carTimes.start, want: (b) => b + 0.5 },
    { id: 'car.stop', label: 'carTimes.stop +0.5 s', shift: 0.5, tokens: ['carTimes.stop', 'carAt', 'settlePitch', 'SETTLE'], patches: [{ url: WORLD_JS, replace: [shiftConst('T_CAR_STOP', 0.5)] }], probe: (W) => W.carTimes.stop, want: (b) => b + 0.5 },
    door('driver'), door('passenger'),
    { id: 'car.lights', label: 'carTimes.lightsOff0 and lightsOff1 +0.5 s', shift: 0.5, tokens: ['lightsOff', 'idleLift', 'headlights'], patches: [{ url: WORLD_JS, append: 'carTimes.lightsOff0 += 0.5; carTimes.lightsOff1 += 0.5;' }], probe: (W) => W.carTimes.lightsOff0, want: (b) => b + 0.5 },
    { id: 'lighter', label: 'LIGHTER +0.3 s', shift: 0.3, tokens: ['LIGHTER', 'lighterOn', 'lighterFlicker'], patches: [{ url: WORLD_JS, append: 'LIGHTER.t0 += 0.3; LIGHTER.t1 += 0.3;' }], probe: (W) => W.LIGHTER.t0, want: (b) => b + 0.3 },
    { id: 'ember', label: 'EMBER.drags +0.3 s', shift: 0.3, tokens: ['EMBER', 'emberLevel'], patches: [{ url: WORLD_JS, append: 'EMBER.drags = EMBER.drags.map((d) => d + 0.3);' }], probe: (W) => W.EMBER.drags[0], want: (b) => b + 0.3 },
    { id: 'exhale', label: 'EXHALE.t +0.3 s', shift: 0.3, tokens: ['EXHALE'], patches: [{ url: WORLD_JS, append: 'EXHALE.t += 0.3;' }], probe: (W) => W.EXHALE.t, want: (b) => b + 0.3 },
    { id: 'moonlight', label: 'the moonlight ramp +0.5 s', shift: 0.5, tokens: ['moonlight'], patches: [{ url: WORLD_JS, replace: [{ find: '^export function moonlight\\(t\\) \\{', with: 'export function moonlight(t) { t -= 0.5;' }] }], probe: (W) => firstPositive(W.moonlight), want: (b) => b + 0.5 },
    { id: 'place', label: `the place change (shot ${placeShot}'s start) +0.5 s`, shift: 0.5, tokens: ['LOCATIONS', 'SHOTS'], patches: [{ url: SHOTS_JS, append: `{ const i = SHOTS.findIndex((s) => s.n === ${placeShot}); SHOTS[i - 1].end += 0.5; SHOTS[i].start += 0.5; }` }], probe: (W, M) => M.LOCATIONS[1].t0, want: (b) => b + 0.5 },
    { id: 'car.dims', label: 'CAR x1.1', shift: null, tokens: ['CAR.length', 'CAR.width', 'CAR.height'], patches: [{ url: WORLD_JS, append: 'for (const k of Object.keys(CAR)) CAR[k] *= 1.1;' }], probe: (W) => W.CAR.length, want: (b) => b * 1.1 },
    // every length in SHAPE; its angles (maxDeg), counts (segments) and the shadow's fraction (inner) stay
    { id: 'car.shape', label: 'SHAPE (the car\'s parts) x1.1', shift: null, tokens: ['SHAPE'], patches: [{ url: CAR_JS, append: "{ const keep = new Set(['maxDeg', 'segments', 'inner']); for (const part of Object.values(SHAPE)) for (const k of Object.keys(part)) if (!keep.has(k) && typeof part[k] === 'number') part[k] *= 1.1; }" }], probe: (W) => W.SHAPE.door.front, want: (b) => b * 1.1 },
    { id: 'lamp', label: 'LAMP.head +0.5 m in x', shift: null, tokens: ['LAMP.head'], patches: [{ url: SET_JS, append: 'LAMP.head[0] += 0.5;' }], probe: (W) => W.LAMP.head[0], want: (b) => b + 0.5 },
    { id: 'bridge', label: 'BRIDGE z0 and z1 +1 m', shift: null, tokens: ['BRIDGE', 'surfaceOf', 'footprintList', 'makePoser', 'LOCATIONS'], patches: [{ url: SET_JS, append: 'BRIDGE.z0 += 1; BRIDGE.z1 += 1;' }], probe: (W) => W.BRIDGE.z0, want: (b) => b + 1 },
    { id: 'rail', label: 'RAIL zA and zB +1 m', shift: null, tokens: ['RAIL', 'PEOPLE_KEYS', 'makePoser', 'footprintList', 'cameraAt'], patches: [{ url: SET_JS, append: 'RAIL.zA += 1; RAIL.zB += 1;' }], probe: (W) => W.RAIL.zA, want: (b) => b + 1 },
  ];
}

// A cue as plain data: its times, its print and surface, its place at its own start, middle and end, and what a cue
// only one picture has is judged by (its family, person, meta and provenance).
const snap = (c) => ({
  id: c.id, sync: c.sync, t0: c.t0, t1: c.t1, print: c.print ?? null, surface: c.surface ?? null, enabled: c.enabled,
  place: c.place ? [c.t0, (c.t0 + c.t1) / 2, c.t1 - 1e-6].map((t) => c.place(t)) : null,
  category: c.category ?? null, family: c.family ?? null, person: c.person ?? null, offered: c.offered ?? false, meta: c.meta ?? {}, derivedFrom: c.derivedFrom ?? null, rule: c.rule ?? null,
});

// ---------- the child ----------
async function child(id, extra) {
  const P = id === 'none' ? null : makePerturbations(JSON.parse(process.env.PERTURB_CTX)).find((p) => p.id === id);
  if (id !== 'none' && !P) throw new Error(`perturb: no perturbation ${id}`);
  register(pathToFileURL(resolve(ROOT, 'scripts/lib/perturb-hooks.mjs')).href, { data: { patches: P ? P.patches : [] } });
  const M = await import(url('src/audio/cues.js'));
  const probes = Object.fromEntries(makePerturbations(JSON.parse(process.env.PERTURB_CTX)).map((p) => [p.id, p.probe(M.WORLD, M)]));
  const extraCues = extra ? (await import(extra)).CUES.map(snap) : [];
  process.stdout.write(JSON.stringify({ id, probes, cues: M.CUES.map(snap), extra: extraCues }));
}

// ---------- the parent ----------
function run(id, ctx, extra) {
  return new Promise((done) => {
    const args = [fileURLToPath(import.meta.url), '--child', id, ...(extra ? ['--extra', extra] : [])];
    const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, PERTURB_CTX: JSON.stringify(ctx) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (b) => { out += b; });
    p.stderr.on('data', (b) => { err += b; });
    p.on('close', (code) => done(code === 0 ? { ok: true, data: JSON.parse(out) } : { ok: false, error: (err.split('\n').find((l) => /Error/.test(l)) ?? err).trim() }));
  });
}
async function pool(jobs, n) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
  return out;
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// the change of one cue: time deltas (its print's among them), the largest move of its place samples, the other fields
// that changed (a print that appears or goes counts there)
function delta(b, p) {
  if (!p) return { sync: null, t0: null, t1: null, print: null, place: 0, gone: true, other: [] };
  let place = 0;
  if ((b.place === null) !== (p.place === null)) place = Infinity;
  else if (b.place) b.place.forEach((q, i) => { const s = p.place[i]; place = Math.max(place, q === null && s === null ? 0 : q === null || s === null ? Infinity : dist3(q, s)); });
  const other = ['surface', 'enabled'].filter((k) => b[k] !== p[k]);
  if ((b.print === null) !== (p.print === null)) other.push('print');
  return { sync: p.sync - b.sync, t0: p.t0 - b.t0, t1: p.t1 - b.t1, print: b.print === null || p.print === null ? null : p.print - b.print, place, gone: false, other };
}

// Every perturbation (or `only` those ids) in its own child, `extra` a module URL whose CUES are snapshotted beside the
// catalogue's (a planted cue for the tests). Returns sound-checks.js's trace input.
export async function perturbAll({ only = null, extra = null } = {}) {
  const { LOCATIONS } = await import(url('src/audio/cues.js'));
  const ctx = { placeShot: LOCATIONS[1].shots[0] };
  const list = makePerturbations(ctx).filter((p) => !only || only.includes(p.id));
  const results = await pool([() => run('none', ctx, extra), ...list.map((p) => () => run(p.id, ctx, extra))], availableParallelism());
  const [base, ...rest] = results;
  if (!base.ok) throw new Error(`perturb: the unperturbed child failed: ${base.error}`);
  const all = (d) => [...d.cues, ...d.extra];
  const perturbations = [], observed = {};
  list.forEach((P, i) => {
    const res = rest[i], want = P.want(base.data.probes[P.id]);
    const reached = res.ok && Math.abs(res.data.probes[P.id] - want) <= 1e-9 * Math.max(1, Math.abs(want));
    perturbations.push({ id: P.id, label: P.label, tokens: P.tokens, shared: P.shared ?? null, person: P.person ?? null, shift: P.shift, reached, note: res.ok ? (reached ? null : `the probe reads ${res.data.probes[P.id]}, want ${want}`) : res.error });
    if (!res.ok) { observed[P.id] = { added: [] }; return; }
    const got = new Map(all(res.data).map((c) => [c.id, c])), o = {};
    for (const b of all(base.data)) o[b.id] = delta(b, got.get(b.id));
    const had = new Set(all(base.data).map((c) => c.id));
    o.added = all(res.data).filter((c) => !had.has(c.id)); // their snapshots: provenance and family, to judge them by
    observed[P.id] = o;
  });
  return { perturbations, observed, base: base.data };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv[2] === '--child') {
  const i = process.argv.indexOf('--extra');
  child(process.argv[3], i > 0 ? process.argv[i + 1] : null).catch((e) => { console.error(`Error: ${e.message}`); process.exitCode = 1; });
}
