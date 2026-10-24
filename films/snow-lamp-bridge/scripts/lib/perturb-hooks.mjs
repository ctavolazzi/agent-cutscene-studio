// Module hooks for the traceability control (scripts/lib/perturb.mjs): serve a patched copy of a picture file to every
// importer in this process. register()'s data carries the patches: [{ url, replace: [{ find, with }], append }]. Each
// `find` (a multiline regular expression) must match exactly once, or the import fails and the perturbation reports
// that it could not reach its constant.
let patches = [];

export async function initialize(data) {
  patches = data?.patches ?? [];
}

export async function load(url, context, nextLoad) {
  const own = patches.filter((p) => p.url === url);
  const result = await nextLoad(url, context);
  if (!own.length) return result;
  let src = String(result.source);
  for (const p of own) {
    for (const x of p.replace ?? []) {
      const n = src.match(new RegExp(x.find, 'gm'))?.length ?? 0;
      if (n !== 1) throw new Error(`perturb: /${x.find}/ matches ${n} times in ${url}`);
      src = src.replace(new RegExp(x.find, 'm'), x.with);
    }
    if (p.append) src += `\n// perturbed\n${p.append}\n`;
  }
  return { format: result.format, source: src, shortCircuit: true };
}
