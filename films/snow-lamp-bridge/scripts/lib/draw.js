// A tiny drawing layer. Items are plain objects, so the same drawing becomes an SVG file and Excalidraw JSON.
// Item kinds: rect, poly, line, circle, text, vgrad, clip, endclip. Coordinates are pixels, y down.
import { len } from './math.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = (n) => Math.round(n * 100) / 100;

export class Draw {
  constructor(w, h, { bg = null } = {}) {
    this.w = w; this.h = h; this.bg = bg; this.items = []; this._clip = 0;
  }
  add(it) { this.items.push(it); return this; }
  rect(x, y, w, h, o = {}) { return this.add({ k: 'rect', x, y, w, h, ...o }); }
  poly(pts, o = {}) { return pts && pts.length >= 3 ? this.add({ k: 'poly', pts, ...o }) : this; }
  line(pts, o = {}) { return pts && pts.length >= 2 ? this.add({ k: 'line', pts, ...o }) : this; }
  circle(cx, cy, r, o = {}) { return this.add({ k: 'circle', cx, cy, r, ...o }); }
  text(x, y, str, o = {}) { return this.add({ k: 'text', x, y, str, size: 14, ...o }); }
  vgrad(x, y, w, h, stops) { return this.add({ k: 'vgrad', x, y, w, h, stops }); }
  clipStart(x, y, w, h) { this.add({ k: 'clip', x, y, w, h, id: `c${this._clip++}` }); return this; }
  clipEnd() { return this.add({ k: 'endclip' }); }
  // line with a filled triangular head at the last point
  arrow(pts, o = {}) {
    this.line(pts, o);
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l, s = o.head ?? 9;
    this.poly([[b[0], b[1]], [b[0] - ux * s - uy * s * 0.5, b[1] - uy * s + ux * s * 0.5], [b[0] - ux * s + uy * s * 0.5, b[1] - uy * s - ux * s * 0.5]],
      { fill: o.stroke ?? '#fff', stroke: 'none', op: o.op ?? 1 });
    return this;
  }

  toSVG() {
    const out = [];
    const defs = [];
    let glowN = 0;
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(this.w)} ${r2(this.h)}" width="${r2(this.w)}" height="${r2(this.h)}" font-family="Helvetica, Arial, sans-serif">`);
    const body = [];
    if (this.bg) body.push(`<rect width="${r2(this.w)}" height="${r2(this.h)}" fill="${this.bg}"/>`);
    let gradN = 0;
    for (const it of this.items) {
      const dash = it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : '';
      const op = it.op != null && it.op !== 1 ? ` opacity="${r2(it.op)}"` : '';
      const fo = it.fillOp != null ? ` fill-opacity="${it.fillOp}"` : '';
      const so = it.strokeOp != null ? ` stroke-opacity="${it.strokeOp}"` : '';
      const paint = `fill="${it.fill ?? 'none'}" stroke="${it.stroke ?? 'none'}" stroke-width="${it.sw ?? 1}"${fo}${so}${dash}${op}`;
      if (it.k === 'rect') body.push(`<rect x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}" ${paint}${it.rx ? ` rx="${it.rx}"` : ''}/>`);
      else if (it.k === 'poly') body.push(`<polygon points="${it.pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' ')}" ${paint} stroke-linejoin="round"/>`);
      else if (it.k === 'line') body.push(`<polyline points="${it.pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' ')}" fill="none" stroke="${it.stroke ?? '#fff'}" stroke-width="${it.sw ?? 1}"${so}${dash}${op} stroke-linecap="${it.cap ?? 'round'}" stroke-linejoin="round"/>`);
      else if (it.k === 'circle') {
        if (it.glow) {
          const id = `g${glowN++}`;
          defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${it.fill}" stop-opacity="1"/><stop offset="1" stop-color="${it.fill}" stop-opacity="0"/></radialGradient>`);
          body.push(`<circle cx="${r2(it.cx)}" cy="${r2(it.cy)}" r="${r2(it.r)}" fill="url(#${id})"${op}/>`);
        } else body.push(`<circle cx="${r2(it.cx)}" cy="${r2(it.cy)}" r="${r2(it.r)}" ${paint}/>`);
      } else if (it.k === 'text') {
        const lines = String(it.str).split('\n');
        const anchor = it.anchor ?? 'start';
        const ts = lines.map((l, i) => `<tspan x="${r2(it.x)}" dy="${i === 0 ? 0 : r2(it.size * 1.25)}">${esc(l)}</tspan>`).join('');
        const rot = it.rotate ? ` transform="rotate(${it.rotate} ${r2(it.x)} ${r2(it.y)})"` : '';
        body.push(`<text x="${r2(it.x)}" y="${r2(it.y)}" font-size="${it.size}" font-weight="${it.weight ?? 400}" fill="${it.fill ?? '#fff'}" text-anchor="${anchor}"${op}${rot}>${ts}</text>`);
      } else if (it.k === 'vgrad') {
        const id = `v${gradN++}`;
        defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${it.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`);
        body.push(`<rect x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}" fill="url(#${id})"/>`);
      } else if (it.k === 'clip') {
        defs.push(`<clipPath id="${it.id}"><rect x="${r2(it.x)}" y="${r2(it.y)}" width="${r2(it.w)}" height="${r2(it.h)}"/></clipPath>`);
        body.push(`<g clip-path="url(#${it.id})">`);
      } else if (it.k === 'endclip') body.push('</g>');
    }
    if (defs.length) out.push(`<defs>${defs.join('')}</defs>`);
    out.push(...body, '</svg>');
    return out.join('\n');
  }

  // Excalidraw scene. Rectangles, polygons and lines become native elements; gradients become flat fills.
  toExcalidraw({ bg = '#0d1320', source = 'snowy-bridge/scripts/storyboard.js' } = {}) {
    const els = [];
    let seed = 1234567;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    let idx = 0;
    const b62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    // fractional-index keys in order: a0..az, then b00..bzz (valid integer keys)
    const nextIndex = () => { const n = idx++; return n < 62 ? 'a' + b62[n] : 'b' + b62[Math.floor((n - 62) / 62)] + b62[(n - 62) % 62]; };
    const base = (type, x, y, w, h, st) => ({
      id: `sb${els.length + 1}`, type, x: r2(x), y: r2(y), width: r2(w), height: r2(h), angle: 0,
      strokeColor: st.stroke ?? 'transparent', backgroundColor: st.fill ?? 'transparent', fillStyle: 'solid',
      strokeWidth: st.sw ?? 1, strokeStyle: st.dash ? 'dashed' : 'solid', roughness: 0, opacity: Math.round((st.op ?? 1) * 100),
      groupIds: [], frameId: null, index: nextIndex(), roundness: null, seed: rnd(), version: 1, versionNonce: rnd(),
      isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
    });
    const colorOrT = (c) => (!c || c === 'none' ? 'transparent' : c);
    const addPath = (type, pts, st, closed) => {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      const e = base(type, pts[0][0], pts[0][1], Math.max(...xs) - x0, Math.max(...ys) - y0, st);
      const p = pts.map((q) => [r2(q[0] - pts[0][0]), r2(q[1] - pts[0][1])]);
      if (closed) p.push([0, 0]);
      Object.assign(e, { points: p, lastCommittedPoint: null, startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: null, elbowed: false });
      els.push(e);
    };
    for (const it of this.items) {
      if (it.k === 'rect') {
        const fill = colorOrT(it.fill), stroke = colorOrT(it.stroke);
        if (fill !== 'transparent' && stroke !== 'transparent' && it.fillOp != null && it.strokeOp != null && it.fillOp !== it.strokeOp) {
          els.push(base('rectangle', it.x, it.y, it.w, it.h, { fill, stroke: 'transparent', op: it.fillOp * (it.op ?? 1) }));
          els.push(base('rectangle', it.x, it.y, it.w, it.h, { stroke, sw: it.sw, dash: it.dash, op: it.strokeOp * (it.op ?? 1) }));
        } else els.push(base('rectangle', it.x, it.y, it.w, it.h, { fill, stroke, sw: it.sw, dash: it.dash, op: (it.fillOp ?? it.strokeOp ?? 1) * (it.op ?? 1) }));
      } else if (it.k === 'vgrad') {
        els.push(base('rectangle', it.x, it.y, it.w, it.h, { fill: it.stops[0][1], stroke: 'transparent' }));
      } else if (it.k === 'poly') {
        const fill = colorOrT(it.fill), stroke = colorOrT(it.stroke);
        if (fill !== 'transparent' && stroke !== 'transparent' && it.fillOp != null && it.strokeOp != null && it.fillOp !== it.strokeOp) {
          addPath('line', it.pts, { fill, stroke: 'transparent', op: it.fillOp * (it.op ?? 1) }, true);
          addPath('line', it.pts, { stroke, sw: it.sw, dash: it.dash, op: it.strokeOp * (it.op ?? 1) }, true);
        } else addPath('line', it.pts, { fill, stroke, sw: it.sw, dash: it.dash, op: (it.fillOp ?? it.strokeOp ?? 1) * (it.op ?? 1) }, true);
      } else if (it.k === 'line') {
        addPath('line', it.pts, { stroke: colorOrT(it.stroke ?? '#fff'), sw: it.sw, dash: it.dash, op: (it.strokeOp ?? 1) * (it.op ?? 1) }, false);
      } else if (it.k === 'circle' && !it.glow) {
        const fill = colorOrT(it.fill), stroke = colorOrT(it.stroke);
        els.push(base('ellipse', it.cx - it.r, it.cy - it.r, it.r * 2, it.r * 2, { fill, stroke, sw: it.sw, dash: it.dash, op: (it.fillOp ?? it.strokeOp ?? 1) * (it.op ?? 1) }));
      } else if (it.k === 'circle' && it.glow) {
        els.push(base('ellipse', it.cx - it.r, it.cy - it.r, it.r * 2, it.r * 2, { fill: it.fill, stroke: 'transparent', op: 0.18 * (it.op ?? 1) }));
      } else if (it.k === 'text') {
        const lines = String(it.str).split('\n');
        const w = Math.max(...lines.map((l) => l.length)) * it.size * 0.56;
        const h = lines.length * it.size * 1.25;
        const x = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
        const e = base('text', x, it.y - it.size * 0.95, w, h, { stroke: it.fill ?? '#fff', op: it.op });
        Object.assign(e, { text: String(it.str), fontSize: it.size, fontFamily: 2, textAlign: it.anchor === 'middle' ? 'center' : it.anchor === 'end' ? 'right' : 'left', verticalAlign: 'top', containerId: null, originalText: String(it.str), autoResize: true, lineHeight: 1.25 });
        els.push(e);
      }
    }
    return { type: 'excalidraw', version: 2, source, elements: els, appState: { gridSize: null, viewBackgroundColor: bg }, files: {} };
  }
}

export const hsl = (h, s, l) => `hsl(${Math.round(h) % 360} ${s}% ${l}%)`;
// Excalidraw needs hex colours, so shot colours are produced as hex
export function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
export { len };
