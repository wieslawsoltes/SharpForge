import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { readJSON, isMain } from './lib/io.js';
import { overlaps } from './lib/paths.js';
export function generateOwnership(catalog, shared = {}) {
  const areas = Object.fromEntries(catalog.areas.map(area => [area.id, { write: area.write, evidence: area.evidence }]));
  const errors = [];
  for (let n = 0; n < 30; n++) if (!areas[`A${String(n).padStart(2, '0')}`]) errors.push(`Missing area A${String(n).padStart(2, '0')}`);
  const ids = Object.keys(areas).sort();
  if (ids.length !== catalog.areas.length) errors.push('Duplicate area ID');
  for (let i = 0; i < ids.length; i++) for (const b of ids.slice(i + 1)) for (const p of areas[ids[i]].write) for (const q of areas[b].write) {
    if (overlaps(p, q) && !Object.values(shared).some(s => s.areas.includes(ids[i]) && s.areas.includes(b) && s.paths.includes(p) && s.paths.includes(q))) errors.push(`Undeclared overlap ${ids[i]}:${p} / ${b}:${q}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { version: 1, areas, shared };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { check: { type: 'boolean' }, catalog: { type: 'string', default: 'planning/catalog.json' }, output: { type: 'string', default: 'planning/contracts/ownership.json' } } });
  const content = JSON.stringify(generateOwnership(readJSON(values.catalog)), null, 2) + '\n';
  if (values.check) { if (readFileSync(values.output, 'utf8') !== content) throw new Error('Ownership map drift; run gen-ownership.js'); } else writeFileSync(values.output, content);
}
