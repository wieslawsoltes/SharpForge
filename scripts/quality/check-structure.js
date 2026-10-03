// Structure gate: keeps source files small and readable. See CONTRIBUTING.md, "File and function size".
// Usage: node scripts/quality/check-structure.js [--strict] [--update-baseline]
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baselinePath = join(root, 'scripts', 'quality', 'structure-baseline.json');
const limits = { lines: 500, bytes: 40_000, lineLength: 160 };
const roots = ['packages', 'apps', 'scripts', 'rust'];
const extensions = /\.(js|mjs|rs|css)$/;
const ignored = /(^|\/)(node_modules|dist|artifacts|target|vendor|generated|fixtures)(\/|$)|\.min\.|\.generated\./;

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const rel = relative(root, path).replaceAll('\\', '/');
    if (ignored.test(rel)) continue;
    if (entry.isDirectory()) yield* walk(path);
    else if (extensions.test(entry.name)) yield rel;
  }
}

function measure(text) {
  const lines = text.split('\n');
  return { lines: lines.length, bytes: Buffer.byteLength(text), lineLength: Math.max(...lines.map(l => l.length)) };
}

const args = new Set(process.argv.slice(2));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8').catch(() => '{"files":{}}'));
const current = {};
const problems = [];
for (const dir of roots) {
  for await (const file of walk(join(root, dir))) {
    const m = measure(await readFile(join(root, file), 'utf8'));
    const over = Object.keys(limits).filter(k => m[k] > limits[k]);
    if (!over.length) continue;
    current[file] = m;
    const allowed = baseline.files[file];
    if (!allowed) problems.push(`${file}: new file exceeds ${over.map(k => `${k} ${m[k]} > ${limits[k]}`).join(', ')}`);
    else for (const k of over) if (m[k] > allowed[k]) problems.push(`${file}: ${k} grew ${allowed[k]} -> ${m[k]} (legacy file may only shrink)`);
  }
}

if (args.has('--update-baseline')) {
  await writeFile(baselinePath, JSON.stringify({ limits, files: Object.fromEntries(Object.entries(current).sort()) }, null, 1) + '\n');
  console.log(`Baseline written: ${Object.keys(current).length} legacy files over the limits.`);
} else if (problems.length) {
  console.log(`Structure gate: ${problems.length} problem(s)\n` + problems.join('\n'));
  if (args.has('--strict')) process.exit(1);
} else {
  console.log(`Structure gate: clean (${Object.keys(current).length} legacy files still over the limits; shrink them when you touch them).`);
}
