// Static scan, no browser. Fails on two things:
// (a) a wall clock, a timer or unseeded randomness in src/ (code only, comments ignored). The scene must be a pure
//     function of t; the playback block in src/main.js (the body of `if (!params.capture) {`) is the one place allowed
//     to read performance.now, requestAnimationFrame or setAnimationLoop. See src/CONTRACT.md.
// (b) an em or en dash in any text file of the project (node_modules/, dist/, .git/ and out/ are skipped, and so are
//     binary files): the character itself, a backslash-u escape of it, or an HTML entity for it (and a CSS escape in
//     CSS and HTML files), since each of those still draws a dash on screen. User rule: no such dashes anywhere.
// Usage: node scripts/check-forbidden.js [--root <dir>] [--json <file>]
// Exits 0 when clean, 1 on any hit or error. Prints file:line:column for every hit.
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Built from code points so this file never holds the characters it hunts for.
const EN = String.fromCharCode(0x2013), EM = String.fromCharCode(0x2014);
const DASH_NAME = { [EN]: 'en dash (U+2013)', [EM]: 'em dash (U+2014)' };
const DASH_RE = new RegExp(`[${EN}${EM}]`, 'g');
// The written forms of the same dashes. The [\\] class keeps this file free of the escapes it hunts for.
const DASH_FORMS = [
  { form: 'escape', re: /[\\]u(?:201[34]|\{0*201[34]\})/g },
  { form: 'entity', re: /&(?:[mn]dash;|#0*821[12](?![0-9])|#x0*201[34](?![0-9a-f]))/gi },
  { form: 'CSS escape', re: /[\\]0*201[34](?![0-9a-f])/gi, ext: new Set(['.css', '.scss', '.sass', '.less', '.html', '.htm', '.svg']) },
];
const formName = (m, form) => `${/2014|8212|mdash/i.test(m) ? 'em dash (U+2014)' : 'en dash (U+2013)'} as ${/^[aeiou]/i.test(form) ? 'an' : 'a'} ${form}`;

// mainOk: allowed inside the playback block of src/main.js, which holds the playback clock
export const CODE_RULES = [
  // dotted, bracketed (Math['random']), passed with its name (Reflect.get(Math, 'random')) or destructured
  { id: 'Math.random', re: /\bMath\s*\.\s*random\b|\bMath\s*\[\s*(['"`])random\1\s*\]|\bMath\s*,\s*(['"`])random\2|\{[^{}]*\brandom\b[^{}]*\}\s*=\s*Math\b/g },
  { id: 'crypto random', re: /\bcrypto\s*\.\s*(?:getRandomValues|randomUUID)\b/g },
  { id: 'Date.now', re: /\bDate\s*\.\s*now\b|\bDate\s*\[\s*(['"`])now\1\s*\]|\{[^{}]*\bnow\b[^{}]*\}\s*=\s*Date\b/g },
  { id: 'new Date', re: /\bnew\s+Date\b|(?<![.\w$])Date\s*\(/g },
  { id: 'performance.now', re: /\bperformance\s*\.\s*now\b/g, mainOk: true },
  // timeOrigin, performance['now'], const { now } = performance and so on ('high-performance' is a string, not this)
  { id: 'performance clock', re: /(?<![\w$-])performance\b(?!\s*\.\s*now\b)/g },
  { id: 'requestAnimationFrame', re: /\brequestAnimationFrame\b/g, mainOk: true },
  { id: 'setAnimationLoop', re: /\bsetAnimationLoop\b/g, mainOk: true },
  // THREE.Clock and THREE.Timer read performance.now inside three.js
  { id: 'three.js clock', re: /\bTHREE\s*\.\s*(?:Clock|Timer)\b|\bnew\s+(?:Clock|Timer)\b|\bimport\s*\{[^}]*\b(?:Clock|Timer)\b[^}]*\}\s*from\b/g },
  { id: 'timer', re: /\b(?:setTimeout|setInterval|setImmediate|requestIdleCallback)\b/g },
];
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.jsx', '.tsx']);
const SKIP_ANYWHERE = new Set(['node_modules', '.git']);
const SKIP_AT_ROOT = new Set(['dist', 'out']);
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.tif', '.tiff', '.psd',
  '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.tgz', '.xz', '.bz2', '.7z', '.br',
  '.rgb', '.raw', '.bin', '.wasm', '.sqlite', '.db', '.glb', '.ktx2', '.exr', '.hdr',
]);
const utf8 = new TextDecoder('utf-8', { fatal: true });

// Blank out comments, keep everything else (strings included) at the same line and column, so a hit maps back to
// the source. With literals: true, the insides of strings, templates and regex literals are blanked too, so their
// braces do not count when matching blocks. Regex literals are told apart from division by the previous significant
// token; a ) that closes an if, while, for or with header counts as a statement start, so a / after it is a regex.
export function stripComments(src, { literals = false } = {}) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const lit = (a, b) => { if (literals) blank(a, b); };
  const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
  const HEADERS = new Set(['if', 'while', 'for', 'with']);
  let i = 0;
  let prev = ''; // last significant character outside comments
  let prevWord = '';
  let afterHeader = false;
  const parens = []; // the word before each open paren, to know what a close paren ends
  const braces = []; // brace depth at each open template substitution
  let depth = 0;
  const token = (p, w = '') => { prev = p; prevWord = w; afterHeader = false; };
  const regexAllowed = () => afterHeader || prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || KEYWORDS_BEFORE_REGEX.has(prevWord);
  const skipString = (q) => { i++; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n') break; i++; } i++; };
  // returns true when the template ends here, false when it stops at a ${ substitution
  const skipTemplate = () => {
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; return true; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; braces.push(depth); depth++; return false; }
      i++;
    }
    return true;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"') { const a = i; skipString(c); lit(a, i); token(c); continue; }
    if (c === '`') { const a = i; i++; skipTemplate(); lit(a, i); token('`'); continue; }
    if (c === '/' && regexAllowed()) {
      const a = i;
      i++;
      let cls = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true;
        else if (src[i] === ']') cls = false;
        else if (src[i] === '/' && !cls) break;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      lit(a, i);
      token('/');
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (braces.length && depth === braces[braces.length - 1]) { braces.pop(); const a = i; i++; skipTemplate(); lit(a, i); token('`'); continue; }
    }
    if (c === '(') { parens.push(prevWord); token('('); i++; continue; }
    if (c === ')') { const w = parens.pop(); token(')'); afterHeader = HEADERS.has(w); i++; continue; }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      token(src[j - 1], src.slice(i, j)); i = j; continue;
    }
    if (!/\s/.test(c)) token(c);
    i++;
  }
  return out.join('');
}

const posOf = (text, index) => {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, col: index - before.lastIndexOf('\n') };
};
const lineOf = (text, line) => text.split('\n')[line - 1] ?? '';
// show a dash by name, so this tool's own output never prints one
const visible = (s) => s.replace(DASH_RE, (m) => (m === EM ? '[U+2014]' : '[U+2013]')).trim().slice(0, 110);

// The playback block of src/main.js: the body of `if (!params.capture) {`, as character offsets and lines.
// Braces are matched with comments, strings and regex literals blanked, so a brace inside one does not count.
const PLAYBACK_RE = /\bif\s*\(\s*!\s*params\s*\.\s*capture\s*\)\s*\{/;
export function playbackBlock(src) {
  const code = stripComments(src, { literals: true });
  const m = PLAYBACK_RE.exec(code);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return { from: open, to: i, start: posOf(code, m.index).line, end: posOf(code, i).line };
  }
  return null;
}

function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue; // never follow links out of the tree or into a loop
      if (st.isDirectory()) {
        if (SKIP_ANYWHERE.has(name) || (dir === root && SKIP_AT_ROOT.has(name))) continue;
        visit(full);
      } else if (st.isFile()) files.push(full);
    }
  };
  visit(root);
  return files;
}

// Returns the decoded text, or null for a binary file.
function readText(file) {
  if (BINARY_EXT.has(extname(file).toLowerCase())) return null;
  const buf = readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) return null;
  try { return utf8.decode(buf); } catch { return null; }
}

export function scan(root = ROOT) {
  root = resolve(root);
  const hits = [], allowed = [];
  const counted = { code: 0, text: 0, binary: 0 };
  const srcDir = join(root, 'src') + sep;
  const mainFile = join(root, 'src', 'main.js');
  let playback = null;
  for (const file of walk(root)) {
    const text = readText(file);
    const rel = relative(root, file).split(sep).join('/');
    if (text === null) { counted.binary++; continue; }
    counted.text++;
    for (const m of text.matchAll(DASH_RE)) {
      const { line, col } = posOf(text, m.index);
      hits.push({ rule: DASH_NAME[m[0]], file: rel, line, col, text: visible(lineOf(text, line)) });
    }
    const ext = extname(file).toLowerCase();
    for (const f of DASH_FORMS) {
      if (f.ext && !f.ext.has(ext)) continue;
      for (const m of text.matchAll(f.re)) {
        const { line, col } = posOf(text, m.index);
        hits.push({ rule: formName(m[0], f.form), file: rel, line, col, text: visible(lineOf(text, line)) });
      }
    }
    if (!file.startsWith(srcDir) || !CODE_EXT.has(ext)) continue;
    counted.code++;
    const code = stripComments(text);
    const block = file === mainFile ? playbackBlock(text) : null;
    if (block) playback = { file: rel, start: block.start, end: block.end };
    for (const rule of CODE_RULES) {
      for (const m of code.matchAll(rule.re)) {
        const { line, col } = posOf(code, m.index);
        const rec = { rule: rule.id, file: rel, line, col, text: visible(lineOf(text, line)) };
        if (rule.mainOk && block && m.index > block.from && m.index < block.to) allowed.push(rec);
        else hits.push(rec);
      }
    }
  }
  hits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.col - b.col));
  return { ok: hits.length === 0, root, files: counted, playback, hits, allowed };
}

function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const fmt = (r) => cols.map((c, k) => String(r[c]).padEnd(w[k])).join('  ').trimEnd();
  return [fmt(Object.fromEntries(cols.map((c) => [c, c]))), w.map((x) => '-'.repeat(x)).join('  '), ...rows.map(fmt)].join('\n');
}

function main() {
  const { values: a } = parseArgs({ options: { root: { type: 'string' }, json: { type: 'string' } }, strict: true });
  const report = scan(a.root ? resolve(a.root) : ROOT);
  const where = (h) => ({ ...h, at: `${h.file}:${h.line}:${h.col}` });
  console.log(`check-forbidden: ${report.root}`);
  console.log(`scanned ${report.files.text} text files (${report.files.code} code files under src/), skipped ${report.files.binary} binary files`);
  const pb = report.playback;
  console.log(pb ? `playback block: ${pb.file} lines ${pb.start} to ${pb.end}` : 'playback block: none found (no `if (!params.capture) {` in src/main.js), so no clock read is allowed anywhere');
  if (report.allowed.length) {
    console.log(`\nallowed (inside the playback block):`);
    console.log(table(report.allowed.map(where), ['rule', 'at']));
  }
  if (report.hits.length) {
    console.log(`\n${report.hits.length} forbidden ${report.hits.length === 1 ? 'hit' : 'hits'}:`);
    console.log(table(report.hits.map(where), ['rule', 'at', 'text']));
  }
  console.log(`\n${report.ok ? 'PASS' : 'FAIL'}: ${report.hits.length} hits`);
  if (a.json) {
    mkdirSync(dirname(resolve(a.json)), { recursive: true });
    writeFileSync(resolve(a.json), `${JSON.stringify(report, null, 1)}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error(`check-forbidden failed: ${e.message}`);
    process.exitCode = 1;
  }
}
