#!/usr/bin/env node
// Start a new film: copies template/ to films/<slug>/, names it, and leaves a fresh PLAN.md and BUILD_LOG.md.
// Usage: node tools/new-film.mjs <slug> ["Title of the film"]
//   slug: lowercase letters, digits and hyphens, for example "rain-on-the-pier"
// Afterwards: cd films/<slug> && npm ci && npm test && npm run dev
// Each film is self-contained (its own engine copy and node_modules), so a finished film never changes when the
// template improves later. To bring an engine fix into an older film, copy the changed files across on purpose.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [slug, titleArg] = process.argv.slice(2);
if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('usage: node tools/new-film.mjs <slug> ["Title"]   (slug: lowercase letters, digits and hyphens)');
  process.exit(1);
}
const title = titleArg ?? slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const src = join(ROOT, 'template');
const dest = join(ROOT, 'films', slug);
if (existsSync(dest)) {
  console.error(`films/${slug} already exists`);
  process.exit(1);
}

const SKIP = new Set(['node_modules', 'dist', 'out', '.cache']);
cpSync(src, dest, { recursive: true, filter: (p) => !SKIP.has(p.split(/[\\/]/).pop()) });

const edit = (file, fn) => { const p = join(dest, file); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };
edit('package.json', (s) => { const j = JSON.parse(s); j.name = slug; j.description = `${title}: a PS1-style three.js film`; return `${JSON.stringify(j, null, 2)}\n`; });
edit('package-lock.json', (s) => s.replace(/"name": "ps1-film"/g, `"name": "${slug}"`));
edit('index.html', (s) => s.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`));
edit('README.md', (s) => s.replace(/^# .*$/m, `# ${title}`));
edit('PLAN.md', (s) => s.replace(/^# .*$/m, `# ${title}: plan`));
edit('BUILD_LOG.md', (s) => s.replace(/^# .*$/m, `# ${title}: build log`));

console.log(`films/${slug} created from template/ ("${title}").`);
console.log(`Next: cd films/${slug} && npm ci && npm test && npm run dev`);
console.log('Then fill in PLAN.md (see playbook/process.md, Stage 0) before replacing the example scene.');
