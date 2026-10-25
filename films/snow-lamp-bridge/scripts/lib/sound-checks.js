// The sound storyboard's checks (SOUND-PLAN 4.3), film-generic: no film constants here, so this file can move into
// template/. The caller (a film's scripts/sound-report.js) hands in everything the film knows, and each check returns
// one report entry:
//   { id, n, name, definition, bar, starting, status: 'pass' | 'fail' | 'report', summary, columns, rows }
// Every row value is a string, number, boolean or null, and a row that names a cue keys it `cue`. A gated check passes
// or fails on its bar; a reported one ('report') lists what it measured and gates nothing.
//
// The input:
//   cues                       the catalogue (src/audio/cues.js's shape: id, category, family, source, person, shape,
//                              sync, lead, nudge, t0, t1, place(t), placement, perspective, voices, priority, enabled,
//                              rule, derivedFrom, designed)
//   fps, total, shots          the clock and the cuts ([{ n, start, end, lens }])
//   locations                  the places, [{ name, t0, t1 }]
//   listener(t), place(p, t, L, law)   the spatializer: { pos, f, r } and { pan, gain, hz, dist }
//   camera(t)                  the picture's camera at t: { pos, W, H, project(p) -> [x, y, depth] | null }
//   hear(cue, t, model)        the predicted { db, pan } of a sounding cue under a listener model (null when silent);
//   models                     the models' names, the camera's first ('camera', then 'characters' in SOUND-PLAN 3.6)
//   blockers(cue, t)           what can hide a cue's point: [{ name, box: { c, ax: [3 unit axes], h: [3 halves] }, own }];
//                              an `own` box is the cue's own body: it hides the point like any box, unless the point
//                              lies inside it (a sound from within a body heard through its own surface, by convention)
//   trace, orders, sync, stereo, steady, approach, flams, density, silence, safeBand, rendered: per check, below
//   thresholds                 { name: { v, starting, why } }: every bar's number, labelled
const EPS = 1e-9;

// ---------- small helpers ----------
const r = (x, d = 4) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const powerSum = (dbs) => (dbs.length ? 10 * Math.log10(dbs.reduce((s, d) => s + 10 ** (d / 10), 0)) : -Infinity);
const voiced = (c) => c.enabled && c.voices > 0;
const sounding = (c, t) => c.t0 <= t && t < c.t1;
const shotAt = (input, t) => input.shots.find((s) => t >= s.start && t < s.end) ?? input.shots[input.shots.length - 1];
const cuts = (input) => input.shots.slice(1).map((s) => s.start);
const placeOf = (input, t) => input.locations.find((l) => t >= l.t0 && t < l.t1) ?? input.locations[input.locations.length - 1];
const th = (input, k) => input.thresholds[k].v;
const isStarting = (input, ks) => ks.some((k) => input.thresholds[k].starting);
const label = (input, k) => `${input.thresholds[k].v}${input.thresholds[k].starting ? ' (starting value' + (input.thresholds[k].why ? `, ${input.thresholds[k].why}` : '') + ')' : input.thresholds[k].why ? ` (${input.thresholds[k].why})` : ''}`;
// the frames a cue covers, t0 <= f / fps < t1; a cue shorter than a frame gets the first frame at or after its onset
export function framesOf(c, fps, total) {
  const out = [], last = Math.min(c.t1, total);
  for (let f = Math.ceil(c.t0 * fps - EPS); f / fps < last; f++) out.push(f);
  return out.length ? out : [Math.ceil(c.t0 * fps - EPS)];
}
// one report entry; every row carries exactly the columns, a missing value as null
function entry(input, id, n, name, definition, bar, keys, status, summary, columns, rows) {
  for (const x of rows) for (const k of Object.keys(x)) if (!columns.includes(k)) throw new Error(`${id}: a row has ${k}, not a column`);
  return { id, n, name, definition, bar, starting: isStarting(input, keys), status, summary, columns, rows: rows.map((x) => Object.fromEntries(columns.map((k) => [k, x[k] ?? null]))) };
}
// memoised per input object: the screen states are shared by onScreen, storyOrder and the per-shot table
const memo = new WeakMap();
const once = (input, key, f) => { let m = memo.get(input); if (!m) memo.set(input, (m = {})); return (m[key] ??= f()); };

// A segment from a to b through an oriented box, ignoring the last `eps` meters at b (a point lying on a surface is
// not hidden by it). Slab test in the box's own axes.
export function segmentHitsBox(a, b, box, eps = 0.01) {
  const d = sub(b, a), len = Math.hypot(d[0], d[1], d[2]);
  if (len === 0) return false;
  let u0 = 0, u1 = 1;
  const o = sub(a, box.c);
  for (let k = 0; k < 3; k++) {
    const p = dot(o, box.ax[k]), q = dot(d, box.ax[k]);
    if (Math.abs(q) < 1e-12) { if (Math.abs(p) > box.h[k]) return false; continue; }
    let s0 = (-box.h[k] - p) / q, s1 = (box.h[k] - p) / q;
    if (s0 > s1) [s0, s1] = [s1, s0];
    u0 = Math.max(u0, s0); u1 = Math.min(u1, s1);
    if (u0 > u1) return false;
  }
  return u0 < 1 - eps / len;
}
// A point inside an oriented box by more than `eps` on every axis (a point on a face is not inside it).
export function insideBox(p, box, eps = 0.01) {
  const o = sub(p, box.c);
  return box.ax.every((a, k) => Math.abs(dot(o, a)) < box.h[k] - eps);
}

// Where a point is in the picture at t: 'on', 'hidden' (by a named blocker), 'off' (with the frame side it is past),
// 'behind' (the camera), or 'unplaced'. x and y are fractions of the frame from its top left.
export function screenState(input, cue, p, t) {
  if (!p) return { state: 'unplaced' };
  const cam = input.camera(t), q = cam.project(p);
  if (!q) return { state: 'behind' };
  const x = q[0] / cam.W, y = q[1] / cam.H;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    const out = { left: -x, right: x - 1, top: -y, bottom: y - 1 };
    const side = Object.keys(out).reduce((a, b) => (out[b] > out[a] ? b : a));
    return { state: 'off', side, x, y };
  }
  for (const b of input.blockers(cue, t)) if (!(b.own && insideBox(p, b.box)) && segmentHitsBox(cam.pos, p, b.box)) return { state: 'hidden', blocker: b.name, x, y };
  return { state: 'on', x, y };
}
// every placed enabled cue's state on every frame it covers: { [id]: [{ f, t, shot, ...state, pan }] }
const statesOf = (input) => once(input, 'states', () => {
  const out = {};
  for (const c of input.cues) {
    if (!c.enabled || !c.place) continue;
    out[c.id] = framesOf(c, input.fps, input.total).map((f) => {
      const t = f / input.fps, s = screenState(input, c, c.place(t), t), h = input.hear(c, t, input.models[0]);
      return { f, t, shot: shotAt(input, t).n, ...s, pan: h?.pan ?? null };
    });
  }
  return out;
});

// The hold rule (SOUND-PLAN 3.6) for a steady source: at each cut inside its life, a level change under `holdDb` (and,
// on its own, a pan change under `holdPan`) is held as an offset for the new shot, so the sound carries on unchanged;
// a larger change applies. The change is measured from what is rendered just before the cut, offset included, so
// held wobbles never add up past the threshold. Motion inside a shot follows the law. Returns rendered(t) -> { db, pan }.
export function holdRule(input, c, model = input.models[0]) {
  const raw = (t) => input.hear(c, t, model), seg = [];
  let off = { db: 0, pan: 0 };
  for (const tc of cuts(input)) {
    if (!(c.t0 < tc && tc < c.t1)) continue;
    const a = raw(tc - 1e-6), b = raw(tc);
    if (!a || !b) { seg.push({ t: tc, db: 0, pan: 0 }); off = { db: 0, pan: 0 }; continue; }
    const before = { db: a.db + off.db, pan: a.pan === null ? null : a.pan + off.pan };
    off = {
      db: Math.abs(b.db - before.db) < th(input, 'holdDb') ? before.db - b.db : 0,
      pan: b.pan !== null && before.pan !== null && Math.abs(b.pan - before.pan) < th(input, 'holdPan') ? before.pan - b.pan : 0,
    };
    seg.push({ t: tc, ...off });
  }
  return (t) => {
    const h = raw(t);
    if (!h) return null;
    let o = { db: 0, pan: 0 };
    for (const s of seg) if (t >= s.t) o = s;
    return { db: h.db + o.db, pan: h.pan === null ? null : Math.max(-1, Math.min(1, h.pan + o.pan)) };
  };
}

// ---------- 1 trace ----------
// Static: every cue has derivedFrom or a rule and names its designed fields (each a field it has, level among them).
// Perturbation (SOUND-PLAN 4.2, input.trace): `perturbations` [{ id, label, tokens, shared, person, shift, reached,
// note }] and `observed` { [id]: { [cue]: { sync, t0, t1, print, place, gone, other }, added: [snapshots] } } (time
// deltas in s, place the largest move in m, `added` the cues only the perturbed picture has, with their provenance).
// A cue that moves, or appears, must name an input of that perturbation in its derivedFrom or rule: one of its tokens,
// or, for one person's perturbation (`person`), one of its `shared` tokens on a cue of that person or of no one, unless
// narrowed to someone (PEOPLE_KEYS.B, makePoser('B') name B's alone). A cue that never moves must be rule-made or have a
// designed sync. With `expect` (cue, perturbation) -> { kind, fields, free, must, couple, label } the movement must be
// exactly that: 'moves' (somehow), 'free' (anything), or 'shift' / 'still', field by field: each time field (sync, t0,
// t1, a step's print) in `fields` moved by the perturbation's own shift (to `tol(cue)` s), every other one unchanged
// unless in `free`; the place unchanged unless in `free` (or, in `must`, required to move); for each [a, b] in `couple`,
// where a moved b must have moved too (a step whose print moves is another step, at another place); a cue gone or
// added, or its other fields (surface) changed, only if `free` names it.
const MOVE = { t: 1e-12, m: 1e-9 }; // under these a value is unchanged: float noise, far below any real move
const TIMES = ['sync', 't0', 't1', 'print'];
const movedField = (d, k) => (k === 'place' ? d.place > MOVE.m : d[k] !== null && d[k] !== undefined && Math.abs(d[k]) > MOVE.t);
function movedOf(d) {
  if (!d) return null;
  const parts = [];
  if (d.gone) parts.push('gone');
  for (const k of TIMES) if (movedField(d, k)) parts.push(`${k} ${d[k] > 0 ? '+' : ''}${r(d[k], 9)}`);
  if (movedField(d, 'place')) parts.push(`place ${r(d.place, 6)} m`);
  for (const k of d.other ?? []) parts.push(k);
  return parts.length ? parts.join(', ') : null;
}
// a shared token names everyone's input, unless narrowed to someone: followed by .X or ('X')
const sharedIn = (text, k) => new RegExp(`${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![.(]['\\w])`).test(text);
export function names(P, c) {
  const text = `${c.derivedFrom ?? ''} ${c.rule ?? ''}`;
  return P.tokens.some((k) => text.includes(k)) || (!!P.shared && (!c.person || !P.person || c.person === P.person) && P.shared.some((k) => sharedIn(text, k)));
}
const inputsOf = (P) => [...P.tokens, ...(P.shared ?? []).map((k) => (P.person ? `${k} (on ${P.person}'s cues or no one's)` : k))].join(', ');
export function trace(input) {
  const T = input.trace ?? null, rows = [];
  for (const c of input.cues) {
    const p = [];
    if (!c.derivedFrom && !c.rule) p.push('neither derivedFrom nor rule');
    if (!Array.isArray(c.designed) || !c.designed.includes('level')) p.push('its designed fields do not name level');
    else for (const f of c.designed) if (!(f in c)) p.push(`designed names ${f}, which it does not have`);
    if (p.length) rows.push({ cue: c.id, perturbation: null, moved: null, named: null, expected: null, problem: p.join('; ') });
  }
  let ran = 0;
  if (T) {
    for (const P of T.perturbations) {
      if (!P.reached) { rows.push({ perturbation: P.id, moved: null, named: null, expected: null, problem: `not reached: ${P.note ?? 'the hook did not change it'}` }); continue; }
      ran++;
      for (const x of T.observed[P.id].added ?? []) {
        const named = names(P, x), want = T.expect ? T.expect(x, P.id) : null, p = [];
        if (!named) p.push(`only the perturbed picture has it, and its provenance names none of ${inputsOf(P)}`);
        if (want && (want.kind === 'shift' || want.kind === 'still') && !(want.free ?? []).includes('added')) p.push('only the perturbed picture has it, the table does not allow it');
        rows.push({ cue: x.id, perturbation: P.id, moved: 'added', named, expected: want ? want.label ?? want.kind : null, problem: p.length ? p.join('; ') : null });
      }
    }
    for (const c of input.cues) {
      const movers = [];
      for (const P of T.perturbations) {
        if (!P.reached) continue;
        const d = T.observed[P.id][c.id], moved = movedOf(d), named = names(P, c);
        const want = T.expect ? T.expect(c, P.id) : null, p = [];
        if (!d) { rows.push({ cue: c.id, perturbation: P.id, moved: null, named, expected: null, problem: 'not observed under this perturbation' }); continue; }
        if (moved) movers.push(P.id);
        if (moved && !named) p.push(`moves, but its provenance names none of ${inputsOf(P)}`);
        if (want && want.kind === 'moves' && !moved) p.push('still, the table says it moves');
        if (want && (want.kind === 'shift' || want.kind === 'still')) {
          const tol = T.tol ? T.tol(c) : EPS, free = want.free ?? [], must = want.must ?? [], fields = want.kind === 'shift' ? want.fields : [];
          for (const k of TIMES) {
            if (k === 'print' && (d.print ?? null) === null) continue; // no print, or one that appears or goes (other)
            if (fields.includes(k)) { if ((d[k] ?? null) === null || !(Math.abs(d[k] - P.shift) <= tol)) p.push(`${k} moved ${r(d[k], 9)}, not the shift ${P.shift} (to ${tol} s)`); }
            else if (!free.includes(k) && movedField(d, k)) p.push(`${k} moved ${r(d[k], 9)}, the table says still`);
          }
          if (must.includes('place') && !movedField(d, 'place')) p.push('place still, the table says it moves');
          else if (!must.includes('place') && !free.includes('place') && movedField(d, 'place')) p.push(`place moved ${r(d.place, 6)} m, the table says still`);
          for (const [a, b] of d.gone ? [] : want.couple ?? []) if (movedField(d, a) && !movedField(d, b)) p.push(`its ${a} moved${a === 'place' ? '' : ` ${r(d[a], 9)} s`} and its ${b} did not: the ${b} does not follow the ${a}`);
          if (d.gone && !free.includes('gone')) p.push('gone, the table does not allow it');
          if ((d.other ?? []).length && !free.includes('other')) p.push(`${d.other.join(', ')} changed, the table does not allow it`);
        }
        if (moved || p.length) rows.push({ cue: c.id, perturbation: P.id, moved, named, expected: want ? want.label ?? want.kind : null, problem: p.length ? p.join('; ') : null });
      }
      if (!movers.length && ran && !c.rule && !(Array.isArray(c.designed) && c.designed.includes('sync'))) rows.push({ cue: c.id, perturbation: null, moved: null, named: null, expected: null, problem: 'never moves, and is neither rule-made nor designed' });
    }
  }
  const bad = rows.filter((x) => x.problem);
  const status = bad.length ? 'fail' : ran ? 'pass' : 'report';
  const summary = `${input.cues.length} cues; ${T ? `${ran} of ${T.perturbations.length} perturbations run, ${rows.filter((x) => x.moved).length} cue moves` : 'perturbation not run'}; ${bad.length} problems`;
  // the declared table is the film's own (its tests): applied when the caller passes it, said so when not
  const table = T?.expect ? '; against the declared table each cue moves under exactly the perturbations it reads, a pure time shift by exactly the shift' : '; the declared table of which perturbations move each family, and by how much, is applied by the film\'s trace test, not here';
  return entry(input, 'trace', 1, 'Trace', `Every cue has derivedFrom or a rule and names its designed fields; under each perturbation of the picture (SOUND-PLAN 4.2) a cue moves, or appears, only if its provenance names an input of it (one person's input only on that person's cues or no one's), and a cue that never moves is rule-made or designed${table}`, 'Exact', [], status, summary, ['cue', 'perturbation', 'moved', 'named', 'expected', 'problem'], rows);
}

// ---------- 2 onScreen ----------
export function onScreen(input) {
  const S = statesOf(input), rows = [], tally = { on: 0, hidden: 0, off: 0, behind: 0 }, blockers = new Set();
  for (const c of input.cues) {
    if (!S[c.id]) continue;
    const fs = S[c.id], first = fs[0], n = { on: 0, hidden: 0, off: 0, behind: 0 };
    for (const s of fs) { n[s.state]++; if (s.blocker) blockers.add(s.blocker); }
    tally[first.state]++;
    rows.push({ cue: c.id, t: r(c.t0), shot: first.shot, state: first.state, blocker: first.blocker ?? null, side: first.side ?? null, x: r(first.x ?? null, 3), y: r(first.y ?? null, 3), pan: r(first.pan, 3), frames: fs.length, on: n.on, hidden: n.hidden, off: n.off, behind: n.behind, by: [...new Set(fs.map((s) => s.blocker).filter(Boolean))].join(', ') || null });
  }
  const summary = `${rows.length} placed cues at their onset frame: ${tally.on} on, ${tally.hidden} hidden, ${tally.off} off, ${tally.behind} behind; blockers ${[...blockers].sort().join(', ') || 'none'}`;
  return entry(input, 'onScreen', 2, 'On screen', 'Each placed cue\'s point on every frame it covers, through the shot\'s camera: on, hidden (the blocker named), off (the frame side) or behind the camera; judged per point, so feet and body can differ. The state is the onset frame\'s; the counts cover every frame', 'Reported per cue', [], 'report', summary, ['cue', 't', 'shot', 'state', 'blocker', 'side', 'x', 'y', 'pan', 'frames', 'on', 'hidden', 'off', 'behind', 'by'], rows);
}

// ---------- 3 storyOrder ----------
// input.orders: [{ name, kind, select(cue), t, t0, t1 }]. 'notBefore': no selected enabled cue starts before t.
// 'onScreen': every selected enabled cue starting in [t0, t1) is on screen at its onset frame. 'noOnset': no selected
// enabled cue starts in [t0, t1).
export function storyOrder(input) {
  const S = statesOf(input), rows = [];
  for (const o of input.orders) {
    const sel = input.cues.filter((c) => c.enabled && o.select(c)), breach = [];
    if (o.kind === 'notBefore') for (const c of sel) { if (c.t0 < o.t - EPS) breach.push({ c, detail: `starts ${r(o.t - c.t0, 4)} s before ${r(o.t)}` }); }
    else if (o.kind === 'onScreen') for (const c of sel) { if (c.t0 >= o.t0 - EPS && c.t0 < o.t1) { const s = S[c.id]?.[0]; if (!s || s.state !== 'on') breach.push({ c, detail: s ? `${s.state}${s.blocker ? ` (${s.blocker})` : ''}${s.side ? ` (${s.side})` : ''}` : 'unplaced' }); } }
    else if (o.kind === 'noOnset') for (const c of sel) { if (c.t0 >= o.t0 - EPS && c.t0 < o.t1) breach.push({ c, detail: `starts at ${r(c.t0)}` }); }
    else throw new Error(`storyOrder: unknown kind ${o.kind}`);
    rows.push({ order: o.name, cue: null, t: null, detail: `${sel.length} cues judged, ${breach.length} breaches` });
    for (const b of breach) rows.push({ order: o.name, cue: b.c.id, t: r(b.c.t0), detail: b.detail });
  }
  const n = rows.filter((x) => x.cue).length;
  return entry(input, 'storyOrder', 3, 'Story order', `The story's orders, each judged on the enabled cues it selects: ${input.orders.map((o) => o.name).join('; ')}`, 'Any breach fails', [], n ? 'fail' : 'pass', `${input.orders.length} orders, ${n} breaches${n ? `: ${[...new Set(rows.filter((x) => x.cue).map((x) => x.order))].join('; ')}` : ''}`, ['order', 'cue', 't', 'detail'], rows);
}

// ---------- 4 sync ----------
// input.sync.rule(cue) -> { event, state(t), change, note } (judged), { reason } (not judged, and why) or null (not a
// sync cue). The picture shows the event on a frame where state(t), sampled at frame times, changes: from false to true
// (change 'rise', the default) or to any other value ('any'). The showing frame is the change nearest the cue's onset
// within syncSearch s of it, and the onset must lead that frame by 0 to syncAhead s, past its named lead. A rule's
// `note` goes on its row when the cue meets the bar (what the measure cannot tell apart).
export function showingFrame(rule, around, fps, W) {
  const f0 = Math.floor((around - W) * fps), f1 = Math.ceil((around + W) * fps);
  let prev = rule.state(f0 / fps), best = null;
  for (let f = f0 + 1; f <= f1; f++) {
    const cur = rule.state(f / fps), hit = (rule.change ?? 'rise') === 'rise' ? !prev && cur : cur !== prev;
    if (hit && (best === null || Math.abs(f / fps - around) < Math.abs(best / fps - around))) best = f;
    prev = cur;
  }
  return best;
}
export function sync(input) {
  const rows = [], W = th(input, 'syncSearch'), A = th(input, 'syncAhead');
  let judged = 0, bad = 0, skipped = 0;
  for (const c of input.cues) {
    if (!c.enabled) continue;
    const rule = input.sync.rule(c);
    if (!rule) continue;
    if (rule.reason) { skipped++; rows.push({ cue: c.id, family: c.family, event: null, t0: r(c.t0), frame: null, aheadMs: null, leadMs: r(c.lead * 1000, 2), ok: null, note: `not judged: ${rule.reason}` }); continue; }
    judged++;
    const frame = showingFrame(rule, c.t0, input.fps, W);
    const ahead = frame === null ? null : frame / input.fps - c.t0, past = ahead === null ? null : ahead - c.lead;
    const ok = past !== null && past >= -EPS && past <= A + EPS;
    let note = rule.note ?? null;
    if (!ok) { bad++; note = frame === null ? `not shown within ${W} s of its onset` : past < 0 ? `${r(-past * 1000, 2)} ms after its frame` : `${r((past - A) * 1000, 2)} ms too early`; }
    rows.push({ cue: c.id, family: c.family, event: rule.event, t0: r(c.t0), frame: frame === null ? null : r(frame / input.fps), aheadMs: ahead === null ? null : r(ahead * 1000, 2), leadMs: r(c.lead * 1000, 2), ok, note });
  }
  return entry(input, 'sync', 4, 'Sync', 'Each sync cue\'s onset against the first frame that shows its event, found by sampling the picture\'s own state functions at frame times', `Onset 0 to ${label(input, 'syncAhead')} s ahead of that frame, past its named lead`, ['syncAhead'], bad ? 'fail' : 'pass', `${judged} judged, ${bad} off their frame; ${skipped} not judged (no event the picture shows)`, ['cue', 'family', 'event', 't0', 'frame', 'aheadMs', 'leadMs', 'ok', 'note'], rows);
}

// ---------- 5 stereoOrder ----------
// input.stereo: { shots: [n], left, right, point(id, t), pointLabel }. On every frame of those shots: the right one's pan
// minus the left one's at their points. A person sounds while any enabled voiced cue of theirs in input.cues sounds.
// While both sound, a margin under 0 is an inversion (fails) and one under stereoSep is reported "not separated".
export function stereoOrder(input) {
  const S = input.stereo, sep = th(input, 'stereoSep'), rows = [];
  const own = Object.fromEntries([S.left, S.right].map((id) => [id, input.cues.filter((c) => voiced(c) && c.person === id)]));
  const heard = (id, t) => own[id].some((c) => sounding(c, t));
  let inverted = 0, close = 0;
  for (const n of S.shots) {
    const s = input.shots.find((x) => x.n === n);
    let all = Infinity, both = Infinity, at = null, frames = 0, bothFrames = 0;
    for (let f = Math.ceil(s.start * input.fps - EPS); f / input.fps < s.end; f++) {
      const t = f / input.fps, L = input.listener(t), a = S.point(S.left, t), b = S.point(S.right, t);
      if (!a || !b) continue;
      frames++;
      const m = input.place(b, t, L).pan - input.place(a, t, L).pan;
      all = Math.min(all, m);
      if (heard(S.left, t) && heard(S.right, t)) { bothFrames++; if (m < both) { both = m; at = t; } }
    }
    const verdict = !bothFrames ? 'not both sounding' : both < 0 ? 'inverted' : both < sep ? 'not separated' : 'holds';
    if (verdict === 'inverted') inverted++; else if (verdict === 'not separated') close++;
    rows.push({ shot: n, frames, bothFrames, margin: r(all === Infinity ? null : all, 3), marginBoth: r(both === Infinity ? null : both, 3), at: r(at), verdict });
  }
  const status = inverted ? 'fail' : close ? 'report' : 'pass';
  return entry(input, 'stereoOrder', 5, 'Stereo order', `Shots ${S.shots[0]} to ${S.shots[S.shots.length - 1]}: whenever both sound (a cue of theirs sounding), ${S.left} pans left of ${S.right}, at ${S.pointLabel ?? 'their points'}`, `A margin of ${label(input, 'stereoSep')} in pan; below it "not separated", under 0 an inversion, which fails`, ['stereoSep'], status, `${rows.filter((x) => x.bothFrames).length} shots with both sounding: ${inverted} inverted, ${close} not separated; margins over all frames ${r(Math.min(...rows.map((x) => x.margin ?? Infinity)), 3)} to ${r(Math.max(...rows.map((x) => x.margin ?? -Infinity)), 3)}`, ['shot', 'frames', 'bothFrames', 'margin', 'marginBoth', 'at', 'verdict'], rows);
}

// ---------- 6 cutPerspective ----------
// Every voiced source sounding across every cut: the change in level and pan under each listener model. A 'location'
// source must not change inside a place. A steady source (input.steady.select(cue), the caller's, SOUND-PLAN 3.6's hum
// and idle) follows the hold rule: what is rendered (input.rendered(cue) -> rendered(t)) must not change where the rule
// holds, and must apply the change where it does not; with no renderer passed the rendered levels are the hold rule's
// own, so those verdicts guard the renderer to come and pass by construction until it does. Everything else follows the
// camera and is reported, with jumps of jumpDb or more listed: a moving continuous source, a one-shot sounding across the
// cut, and a one-shot source's stream. A one-shot source sounds across a cut as a stream when the gap between its last
// onset before the cut and its first after it is at most cutStream times the shorter of its neighbouring gaps (its own
// rhythm carries on across the cut, whatever that rhythm is); a source with no neighbouring gap is not a stream. Its
// last cue before the cut, heard at its own place from both cameras, is the jump the next one takes.
function streamsAcross(input, tc) {
  const R = th(input, 'cutStream'), out = [];
  const one = input.cues.filter((c) => voiced(c) && c.shape === 'oneshot' && c.perspective !== 'location');
  for (const src of [...new Set(one.map((c) => c.source))]) {
    const own = one.filter((c) => c.source === src).sort((a, b) => a.t0 - b.t0), i = own.findIndex((c) => c.t0 >= tc);
    const k = (i < 0 ? own.length : i) - 1, last = own[k], next = i < 0 ? null : own[i];
    if (!last) continue;
    if (last.t1 > tc) { out.push({ c: last, next, ratio: null }); continue; }
    if (!next) continue;
    const gaps = [k > 0 ? last.t0 - own[k - 1].t0 : null, own[i + 1] ? own[i + 1].t0 - next.t0 : null].filter((g) => g !== null);
    const ratio = gaps.length ? (next.t0 - last.t0) / Math.min(...gaps) : null;
    if (ratio !== null && ratio <= R) out.push({ c: last, next, ratio });
  }
  return out;
}
export function cutPerspective(input) {
  const rows = [], models = input.models, e = 1e-6, steady = (c) => c.shape === 'continuous' && input.steady.select(c);
  let fails = 0, jumps = 0, held = 0, follow = 0;
  const steadyIds = new Set();
  for (const tc of cuts(input)) {
    const inside = placeOf(input, tc - e).name === placeOf(input, tc).name;
    const across = [...input.cues.filter((c) => voiced(c) && c.shape !== 'oneshot' && c.t0 < tc && tc < c.t1).map((c) => ({ c, next: null, ratio: null })), ...streamsAcross(input, tc)];
    for (const { c, next, ratio } of across) {
      const d = models.map((m) => { const a = input.hear(c, tc - e, m), b = input.hear(c, tc, m); return a && b ? { db: b.db - a.db, pan: a.pan === null || b.pan === null ? null : b.pan - a.pan } : null; });
      const row = { cut: r(tc, 3), cue: c.id, next: next?.id ?? null, gapRatio: r(ratio, 2), kind: null, dDb: r(d[0]?.db ?? null, 2), dPan: r(d[0]?.pan ?? null, 3) };
      models.slice(1).forEach((m, i) => { row[`dDb_${m}`] = r(d[i + 1]?.db ?? null, 2); });
      let verdict = null, dRendered = null, hold = null;
      if (c.perspective === 'location') {
        row.kind = 'location';
        verdict = !inside ? 'place change' : Math.abs(d[0]?.db ?? 0) > EPS ? 'changed inside a place' : 'steady';
        if (verdict === 'changed inside a place') fails++;
      } else if (steady(c)) {
        // the change heard is the raw level after the cut against what was rendered before it: under the threshold it
        // must be held (rendered continuous), over it applied (rendered back on the raw value)
        row.kind = 'steady';
        steadyIds.add(c.id);
        const rend = (input.rendered ?? ((x) => holdRule(input, x)))(c), a = rend(tc - e), b = rend(tc), raw = input.hear(c, tc, models[0]);
        dRendered = b.db - a.db;
        hold = Math.abs(raw.db - a.db) < th(input, 'holdDb');
        const holdPan = raw.pan !== null && a.pan !== null && Math.abs(raw.pan - a.pan) < th(input, 'holdPan');
        const tol = 1e-4; // dB and pan over the microsecond either side of the cut, while the source moves
        const leak = (hold && Math.abs(dRendered) > tol) || (holdPan && Math.abs(b.pan - a.pan) > tol);
        const stuck = (!hold && Math.abs(b.db - raw.db) > tol) || (raw.pan !== null && !holdPan && Math.abs(b.pan - raw.pan) > tol);
        verdict = leak ? 'leaks under the hold threshold' : stuck ? 'holds a change over the threshold' : hold ? (holdPan ? 'held' : 'level held, pan applied') : holdPan ? 'level applied, pan held' : 'applied';
        if (leak || stuck) fails++;
        if (hold) held++;
      } else {
        row.kind = c.shape === 'continuous' ? 'moving' : c.t1 > tc ? 'one-shot' : 'one-shot stream';
        follow++;
        verdict = Math.abs(d[0]?.db ?? 0) >= th(input, 'jumpDb') ? 'jump' : 'follows the camera';
        if (verdict === 'jump') jumps++;
      }
      rows.push({ ...row, held: hold, dRendered: r(dRendered, 2), verdict });
    }
  }
  const guard = input.rendered ? 'judged on the levels the renderer passes' : 'no renderer passed: the rendered levels are the hold rule\'s own, so these verdicts guard the renderer to come (Sound 2) and pass by construction until it is passed';
  return entry(input, 'cutPerspective', 6, 'Perspective at cuts', `Every source sounding across every cut: the change in dB and pan under each listener model (${models.join(', ')}), keyed on perspective. A 'location' source must not change inside a place. A steady source (${input.steady.label}) follows the hold rule, under ${input.thresholds.holdDb.v} dB and ${input.thresholds.holdPan.v} in pan held as an offset and larger changes applied (${guard}). Everything else follows the camera and is reported: a moving continuous source, a one-shot sounding across the cut, and a one-shot source whose gap across the cut is at most ${input.thresholds.cutStream.v} times the shorter of its neighbouring gaps (its rhythm carries on; its last cue before the cut heard from both cameras)`, `A 'location' change inside a place fails; a steady change under the hold threshold (${label(input, 'holdDb')} dB, ${label(input, 'holdPan')} pan) that leaks through, or one over it that is held, fails; jumps of ${label(input, 'jumpDb')} dB or more listed (a stream's gap at most ${label(input, 'cutStream')} times its rhythm)`, ['holdDb', 'holdPan', 'jumpDb', 'cutStream'], fails ? 'fail' : 'pass', `${cuts(input).length} cuts, ${rows.length} sources across them: ${fails} failures; steady ${[...steadyIds].join(', ') || 'none'}: ${held} changes held${input.rendered ? '' : ' (the hold rule\'s own levels, no renderer yet)'}; ${follow} following the camera, ${jumps} jumps of ${input.thresholds.jumpDb.v} dB or more`, ['cut', 'cue', 'next', 'gapRatio', 'kind', 'dDb', 'dPan', ...models.slice(1).map((m) => `dDb_${m}`), 'held', 'dRendered', 'verdict'], rows);
}

// ---------- 7 approachRises ----------
// input.approach: [{ name, point(t), level(t) -> dB or null, blockers(t) }]. On every frame where the source comes
// toward the camera (its distance to this frame's camera falls across the frame) and is on screen, runs of such frames
// (across cuts too) must never fall more than approachFall dB under their running peak.
export function approachRises(input) {
  const rows = [], fall = th(input, 'approachFall'), h = 1 / (2 * input.fps);
  let bad = 0;
  for (const A of input.approach) {
    const pseudo = { id: A.name };
    const blockersOf = { ...input, blockers: (c, t) => A.blockers(t) };
    let run = null;
    const close = () => { if (!run) return; if (run.worst > fall) bad++; rows.push({ source: A.name, t0: r(run.t0, 3), t1: r(run.t1, 3), peak: r(run.peak, 2), peakAt: r(run.peakAt, 3), worstFall: r(run.worst, 2), worstAt: r(run.worstAt, 3), ok: run.worst <= fall }); run = null; };
    for (let f = 0; f / input.fps < input.total; f++) {
      const t = f / input.fps, L = A.level(t), p = A.point(t);
      const cam = p && input.camera(t).pos, toward = p && A.point(t + h) && A.point(t - h) && dist3(A.point(t + h), cam) < dist3(A.point(t - h), cam);
      const ok = L !== null && toward && screenState(blockersOf, pseudo, p, t).state === 'on';
      if (!ok) { close(); continue; }
      if (!run) run = { t0: t, t1: t, peak: L, peakAt: t, worst: 0, worstAt: t };
      run.t1 = t;
      if (L > run.peak) { run.peak = L; run.peakAt = t; }
      if (run.peak - L > run.worst) { run.worst = run.peak - L; run.worstAt = t; }
    }
    close();
  }
  return entry(input, 'approachRises', 7, 'Approach rises', 'While a source comes toward the camera on screen, its predicted level never falls more than the bar under its running peak, cuts included', `A fall of more than ${label(input, 'approachFall')} dB fails`, ['approachFall'], bad ? 'fail' : 'pass', `${rows.length} approach runs, ${bad} falling more than ${fall} dB; the worst ${r(Math.max(0, ...rows.map((x) => x.worstFall)), 2)} dB`, ['source', 't0', 't1', 'peak', 'peakAt', 'worstFall', 'worstAt', 'ok'], rows);
}

// ---------- 8 maskingPairs ----------
// Cue c is at risk when another source's onset falls from maskBefore s before to maskAfter s after its own, and that
// cue is within maskDb of it or louder (each at its own onset, camera model).
export function maskingPairs(input) {
  const rows = [], B = th(input, 'maskBefore'), Af = th(input, 'maskAfter'), D = th(input, 'maskDb');
  const on = input.cues.filter(voiced), lvl = new Map(on.map((c) => [c.id, input.hear(c, c.t0, input.models[0])?.db ?? null]));
  for (const c of on) {
    if (c.category === 'bg' || lvl.get(c.id) === null) continue;
    for (const d of on) {
      if (d === c || d.source === c.source || lvl.get(d.id) === null) continue;
      const dt = d.t0 - c.t0;
      if (dt < -B - EPS || dt > Af + EPS) continue;
      const margin = lvl.get(c.id) - lvl.get(d.id);
      if (margin <= D) rows.push({ cue: c.id, t: r(c.t0), by: d.id, dtMs: r(dt * 1000, 1), db: r(lvl.get(c.id), 1), byDb: r(lvl.get(d.id), 1), margin: r(margin, 1) });
    }
  }
  return entry(input, 'maskingPairs', 8, 'Masking: pairs', `Cue c is at risk when another source's onset falls from ${B * 1000} ms before to ${Af * 1000} ms after it, within ${D} dB of it or louder`, `Reported; the remedy is level and timbre, never time (window ${label(input, 'maskBefore')} s before and ${label(input, 'maskAfter')} s after, ${label(input, 'maskDb')} dB)`, ['maskBefore', 'maskAfter', 'maskDb'], 'report', `${new Set(rows.map((x) => x.cue)).size} cues at risk, in ${rows.length} pairs`, ['cue', 't', 'by', 'dtMs', 'db', 'byDb', 'margin'], rows);
}

// ---------- 9 maskingBed ----------
// Each voiced one-shot's level at its onset against the loudest moment, in its first bedWindow s, of everything steady
// sounding from other sources (the backgrounds and the continuous cues), power-summed on a bedStep grid. Broadband. A
// one-shot against another one-shot is maskingPairs' (the predicted level has no envelope, so a one-shot's tail would
// count at its peak).
export function maskingBed(input) {
  const rows = [], M = th(input, 'bedMargin'), Wn = th(input, 'bedWindow'), step = th(input, 'bedStep');
  const on = input.cues.filter(voiced);
  for (const c of on) {
    if (c.shape !== 'oneshot' || c.category === 'bg') continue;
    const L = input.hear(c, c.t0, input.models[0])?.db;
    if (L === undefined || L === null) continue;
    let mask = -Infinity, by = null;
    for (let t = c.t0; t < Math.min(c.t1, c.t0 + Wn) - EPS; t += step) {
      const others = on.filter((d) => d.shape === 'continuous' && d.source !== c.source && sounding(d, t)), dbs = others.map((d) => input.hear(d, t, input.models[0])?.db).filter((x) => x !== null && x !== undefined);
      const m = powerSum(dbs);
      if (m > mask) { mask = m; by = others.reduce((a, d) => { const x = input.hear(d, t, input.models[0])?.db ?? -Infinity; return x > a.db ? { id: d.id, db: x } : a; }, { id: null, db: -Infinity }).id; }
    }
    const margin = L - mask;
    rows.push({ cue: c.id, t: r(c.t0), db: r(L, 1), bed: r(mask === -Infinity ? null : mask, 1), loudest: by, margin: r(margin === Infinity ? null : margin, 1), atRisk: margin < M });
  }
  const risk = rows.filter((x) => x.atRisk);
  return entry(input, 'maskingBed', 9, 'Masking: the bed', `Each one-shot against everything steady sounding in its first ${Wn} s, backgrounds included (one-shot against one-shot is maskingPairs\'): the broadband margin at Sound 1, per third octave on peak short-window levels from Sound 2`, `A margin under ${label(input, 'bedMargin')} dB reported`, ['bedMargin'], 'report', `${rows.length} one-shots, ${risk.length} under ${M} dB; the lowest margin ${r(Math.min(...rows.map((x) => x.margin ?? Infinity)), 1)} dB`, ['cue', 't', 'db', 'bed', 'loudest', 'margin', 'atRisk'], rows);
}

// ---------- 10 flams ----------
// input.flams.isContact(cue): one person's enabled contacts (on their sync times) closer than `flam` s must have been
// merged. Each person's closest pair is listed too.
export function flams(input) {
  const rows = [], F = th(input, 'flam');
  let bad = 0;
  const people = [...new Set(input.cues.map((c) => c.person).filter(Boolean))].sort();
  for (const id of people) {
    const own = input.cues.filter((c) => c.enabled && c.person === id && input.flams.isContact(c)).sort((a, b) => a.sync - b.sync);
    let best = null;
    for (let i = 1; i < own.length; i++) {
      const g = own[i].sync - own[i - 1].sync;
      if (g < F) { bad++; rows.push({ person: id, cue: own[i - 1].id, next: own[i].id, gapMs: r(g * 1000, 2), merged: false }); }
      if (!best || g < best.g) best = { g, a: own[i - 1], b: own[i] };
    }
    if (best) rows.push({ person: id, cue: best.a.id, next: best.b.id, gapMs: r(best.g * 1000, 2), merged: best.g >= F ? null : false, closest: true });
  }
  for (const x of rows) x.closest ??= false;
  return entry(input, 'flams', 10, 'Flams', `One person's two contacts within ${F * 1000} ms, on contact times, must be merged into one cue`, `Any unmerged pair under ${label(input, 'flam')} s fails`, ['flam'], bad ? 'fail' : 'pass', `${bad} unmerged pairs; the closest per person: ${rows.filter((x) => x.closest).map((x) => `${x.person} ${x.gapMs} ms`).join(', ')}`, ['person', 'cue', 'next', 'gapMs', 'merged', 'closest'], rows);
}

// ---------- 11 density ----------
// Every densityStep s: the foreground streams, voice groups (`source`) of input.density.select cues whose power-summed
// level is within densityDb of the loudest sounding group, or which started in the last densityRecent s. Runs over
// densityReport are listed; any moment over densityFail fails. input.density.body(cue), if given, names the body each
// voice group belongs to (a person, the car), and the foreground bodies are counted beside the streams (reported).
const densityTicks = (input) => once(input, 'density', () => {
  const step = th(input, 'densityStep'), recent = th(input, 'densityRecent'), D = th(input, 'densityDb');
  const sel = input.cues.filter((c) => voiced(c) && input.density.select(c)), out = [];
  const bodyOf = new Map(sel.map((c) => [c.source, input.density.body ? input.density.body(c) : c.source]));
  for (let k = 0; k * step < input.total; k++) {
    const t = k * step, groups = {};
    for (const c of sel) {
      const live = sounding(c, t), fresh = c.t0 <= t + EPS && c.t0 > t - recent;
      if (!live && !fresh) continue;
      const g = (groups[c.source] ??= { dbs: [], fresh: false });
      if (fresh) g.fresh = true;
      if (live) { const h = input.hear(c, t, input.models[0]); if (h) g.dbs.push(h.db); }
    }
    const lv = Object.fromEntries(Object.entries(groups).map(([k2, g]) => [k2, powerSum(g.dbs)])), loud = Math.max(-Infinity, ...Object.values(lv));
    const fg = Object.keys(groups).filter((k2) => groups[k2].fresh || lv[k2] >= loud - D).sort();
    out.push({ t, n: fg.length, fg, bodies: new Set(fg.map((g) => bodyOf.get(g))).size });
  }
  return out;
});
export function density(input) {
  const ticks = densityTicks(input), rows = [], rep = th(input, 'densityReport'), fail = th(input, 'densityFail');
  let run = null, worst = 0, worstBodies = 0;
  const close = () => { if (run) rows.push({ t0: r(run.t0, 2), t1: r(run.t1, 2), shot: shotAt(input, run.t0).n, peak: run.peak, bodies: run.bodies, streams: run.streams, fails: run.peak > fail }); run = null; };
  for (const k of ticks) {
    worst = Math.max(worst, k.n); worstBodies = Math.max(worstBodies, k.bodies);
    if (k.n <= rep) { close(); continue; }
    if (!run) run = { t0: k.t, t1: k.t, peak: 0, bodies: 0, streams: '' };
    run.t1 = k.t + th(input, 'densityStep');
    run.bodies = Math.max(run.bodies, k.bodies);
    if (k.n > run.peak) { run.peak = k.n; run.streams = k.fg.join(', '); }
  }
  close();
  const bad = rows.filter((x) => x.fails).length;
  return entry(input, 'density', 11, 'Density', `Every ${th(input, 'densityStep') * 1000} ms: the foreground streams, voice groups within ${th(input, 'densityDb')} dB of the loudest sounding or with an onset in the last ${th(input, 'densityRecent') * 1000} ms${input.density.body ? '; the bodies they belong to counted beside them' : ''}`, `More than ${label(input, 'densityReport')} reported; more than ${label(input, 'densityFail')} fails`, ['densityReport', 'densityFail', 'densityDb'], bad ? 'fail' : 'pass', `peak ${worst} foreground streams (${worstBodies} bodies); ${rows.length} runs over ${rep}, ${bad} over ${fail}`, ['t0', 't1', 'shot', 'peak', 'bodies', 'streams', 'fails'], rows);
}

// ---------- 12 voices ----------
// The PS1 count (SOUND-PLAN 3.13): a cue holds `voices` voices from t0 to t1 (a stereo bed two, a modifier none). The
// allocator, in onset order (higher priority first at a tie): a cue whose voice group still sounds retriggers that
// group's voice and cuts the older cue (an unintended cut); with no free voice it steals the lowest-priority sounding
// cue below its own priority, or is dropped. Demand is the voices asked for, allocated or not.
export function allocate(cues, limit) {
  const ev = cues.filter(voiced).sort((a, b) => a.t0 - b.t0 || b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const live = [], events = [];
  let used = 0, peak = { n: 0, t: 0 }, demand = { n: 0, t: 0 };
  const release = (t) => { for (let i = live.length - 1; i >= 0; i--) if (live[i].c.t1 <= t + EPS) { used -= live[i].c.voices; live.splice(i, 1); } };
  const all = cues.filter(voiced);
  for (const c of ev) {
    release(c.t0);
    const ask = all.filter((d) => sounding(d, c.t0)).reduce((s, d) => s + d.voices, 0);
    if (ask > demand.n) demand = { n: ask, t: c.t0 };
    const same = live.findIndex((x) => x.c.source === c.source);
    if (same >= 0) { events.push({ kind: 'cut', cue: c.id, t: c.t0, other: live[same].c.id }); used -= live[same].c.voices; live.splice(same, 1); }
    while (used + c.voices > limit) {
      const victim = live.filter((x) => x.c.priority < c.priority).sort((a, b) => a.c.priority - b.c.priority || b.c.t0 - a.c.t0)[0];
      if (!victim) break;
      events.push({ kind: 'steal', cue: c.id, t: c.t0, other: victim.c.id });
      used -= victim.c.voices; live.splice(live.indexOf(victim), 1);
    }
    if (used + c.voices > limit) { events.push({ kind: 'drop', cue: c.id, t: c.t0, other: null }); continue; }
    live.push({ c }); used += c.voices;
    if (used > peak.n) peak = { n: used, t: c.t0 };
  }
  return { peak, demand, events };
}
export function voices(input) {
  const limit = th(input, 'voiceLimit'), a = allocate(input.cues, limit);
  const rows = [{ kind: 'peak', cue: null, t: r(a.peak.t, 3), other: null, voices: a.peak.n }, { kind: 'demand', cue: null, t: r(a.demand.t, 3), other: null, voices: a.demand.n }, ...a.events.map((x) => ({ kind: x.kind, cue: x.cue, t: r(x.t, 3), other: x.other, voices: null }))];
  const bad = a.events.length || a.demand.n > limit;
  return entry(input, 'voices', 12, 'Voices', 'The PS1 count: a mono one-shot or loop is one voice from its onset to its end, a stereo background two, a voice at zero gain none; an allocator with priorities and one voice per voice group', `At most ${label(input, 'voiceLimit')}; zero steals, drops or unintended cuts`, ['voiceLimit'], bad ? 'fail' : 'pass', `peak ${a.peak.n} voices at ${r(a.peak.t, 3)} (demand ${a.demand.n}); ${a.events.filter((x) => x.kind === 'steal').length} steals, ${a.events.filter((x) => x.kind === 'drop').length} drops, ${a.events.filter((x) => x.kind === 'cut').length} cuts`, ['kind', 'cue', 't', 'other', 'voices'], rows);
}

// ---------- 13 silence ----------
// input.silence: { windows: [{ name, t0, t1 }], select(cue) }: no selected enabled cue starts inside a window.
export function silence(input) {
  const rows = [], S = input.silence;
  let bad = 0;
  for (const w of S.windows) {
    const hits = input.cues.filter((c) => c.enabled && S.select(c) && c.t0 >= w.t0 - EPS && c.t0 < w.t1);
    rows.push({ window: w.name, t0: r(w.t0, 3), t1: r(w.t1, 3), cue: null, t: null, onsets: hits.length });
    for (const c of hits) { bad++; rows.push({ window: w.name, t0: r(w.t0, 3), t1: r(w.t1, 3), cue: c.id, t: r(c.t0), onsets: null }); }
  }
  return entry(input, 'silence', 13, 'Silence', 'No hard-effect or foley onset inside a declared bed-only window', 'Any onset fails', [], bad ? 'fail' : 'pass', `${S.windows.length} windows (${S.windows.map((w) => `${r(w.t0, 2)} to ${r(w.t1, 2)}`).join(', ')}), ${bad} onsets inside`, ['window', 't0', 't1', 'cue', 't', 'onsets'], rows);
}

// ---------- 14 safeBand ----------
// input.safeBand: { story(cue), band(cue) -> { lo, hi, side, from } }: each story cue's band (declared by family at
// Sound 1, measured from Sound 2). A story cue that lives only below lowHz, or only in the side channel, is flagged.
export function safeBand(input) {
  const rows = [], low = th(input, 'lowHz'), B = input.safeBand;
  for (const c of input.cues) {
    if (!c.enabled || !B.story(c)) continue;
    const b = B.band(c), flag = !b ? 'no band declared' : b.hi <= low ? `only below ${low} Hz` : b.side ? 'only in the side channel' : null;
    rows.push({ cue: c.id, family: c.family, lo: b?.lo ?? null, hi: b?.hi ?? null, side: b?.side ?? null, from: b?.from ?? null, flag });
  }
  const bad = rows.filter((x) => x.flag).length, status = bad ? 'fail' : B.measured ? 'pass' : 'report';
  return entry(input, 'safeBand', 14, 'Safe band', 'Each story cue\'s band: by family at Sound 1; measured at Sound 2 through a phone simulation (mono, a high-pass near 300 Hz, a low-pass near 8 kHz) and a mono fold-down', `Flag a story cue that lives only below about ${label(input, 'lowHz')} Hz or only in the side channel`, ['lowHz'], status, `${rows.length} story cues, ${bad} flagged, on the bands ${B.measured ? 'measured' : 'declared by family (nothing to measure before Sound 2)'}`, ['cue', 'family', 'lo', 'hi', 'side', 'from', 'flag'], rows);
}

// ---------- 15 straddle ----------
// Voiced one-shots sounding across a cut, where the placement mode matters: the change at the cut, camera model.
export function straddle(input) {
  const rows = [];
  for (const tc of cuts(input)) for (const c of input.cues) {
    if (!voiced(c) || c.shape !== 'oneshot' || !(c.t0 < tc && tc < c.t1)) continue;
    const a = input.hear(c, tc - 1e-6, input.models[0]), b = input.hear(c, tc, input.models[0]);
    rows.push({ cue: c.id, cut: r(tc, 3), t0: r(c.t0), t1: r(c.t1), placement: c.placement, dDb: a && b ? r(b.db - a.db, 2) : null, dPan: a && b && a.pan !== null && b.pan !== null ? r(b.pan - a.pan, 3) : null });
  }
  return entry(input, 'straddle', 15, 'Straddles', 'One-shots sounding across a cut, where the placement mode matters', 'Reported', [], 'report', `${rows.length} one-shots across a cut`, ['cue', 'cut', 't0', 't1', 'placement', 'dDb', 'dPan'], rows);
}

// ---------- the report ----------
export const CHECKS = [trace, onScreen, storyOrder, sync, stereoOrder, cutPerspective, approachRises, maskingPairs, maskingBed, flams, density, voices, silence, safeBand, straddle];

// Per shot: onsets by category, how many start on screen, the peak voices asked for and the peak foreground streams.
function perShot(input) {
  const S = statesOf(input), ticks = densityTicks(input), on = input.cues.filter(voiced), rows = [];
  for (const s of input.shots) {
    const starts = input.cues.filter((c) => c.enabled && c.t0 >= s.start - EPS && c.t0 < s.end), by = (k) => starts.filter((c) => c.category === k).length;
    let peak = 0;
    for (const c of starts.length ? starts : []) peak = Math.max(peak, on.filter((d) => sounding(d, c.t0)).reduce((x, d) => x + d.voices, 0));
    peak = Math.max(peak, on.filter((d) => sounding(d, s.start)).reduce((x, d) => x + d.voices, 0));
    const dens = ticks.filter((k) => k.t >= s.start - EPS && k.t < s.end).reduce((m, k) => Math.max(m, k.n), 0);
    rows.push({ shot: s.n, start: s.start, end: s.end, lens: s.lens, onsets: starts.length, hard: by('hard'), foley: by('foley'), bg: by('bg'), onScreen: starts.filter((c) => S[c.id]?.[0].state === 'on').length, voices: peak, streams: dens });
  }
  return { columns: ['shot', 'start', 'end', 'lens', 'onsets', 'hard', 'foley', 'bg', 'onScreen', 'voices', 'streams'], rows };
}
// The on-screen table: each placed cue in each shot it covers, its screen x against its pan over its on-screen frames.
function onScreenTable(input) {
  const S = statesOf(input), rows = [];
  for (const c of input.cues) {
    if (!S[c.id]) continue;
    for (const n of [...new Set(S[c.id].map((s) => s.shot))]) {
      const fs = S[c.id].filter((s) => s.shot === n), on = fs.filter((s) => s.state === 'on');
      const ext = (k, f) => (on.length ? r(f(...on.map((s) => s[k])), 3) : null);
      rows.push({ cue: c.id, shot: n, frames: fs.length, on: on.length, xMin: ext('x', Math.min), xMax: ext('x', Math.max), panMin: ext('pan', Math.min), panMax: ext('pan', Math.max) });
    }
  }
  return { columns: ['cue', 'shot', 'frames', 'on', 'xMin', 'xMax', 'panMin', 'panMax'], rows };
}

export function runSoundChecks(input) {
  return {
    cues: input.cues.length,
    enabled: input.cues.filter((c) => c.enabled).length,
    checks: CHECKS.map((f) => f(input)),
    tables: { onScreen: onScreenTable(input), perShot: perShot(input) },
  };
}
