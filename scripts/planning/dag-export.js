import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readJSON, isMain } from './lib/io.js';
import { validateDag } from './validate-dag.js';
export function exportDag(snapshot, area) {
  const { errors, order, edges: requirements } = validateDag(snapshot); if (errors.length) throw new Error(errors.join('\n'));
  const nodes = new Map(snapshot.issues.map(t => [t.id, t])), longest = new Map();
  for (const id of order) { const paths = requirements[id].map(d => longest.get(d) ?? []); longest.set(id, [...paths.sort((a, b) => b.length - a.length)[0] ?? [], id]); }
  const criticalPath = [...longest.values()].sort((a, b) => b.length - a.length || a.join().localeCompare(b.join()))[0] ?? [];
  const selected = snapshot.issues.filter(t => !area || t.area === area), ids = new Set(selected.map(t => t.id));
  for (const task of selected) for (const dependency of requirements[task.id]) ids.add(dependency);
  const nodeName = id => id.replace(/[-.]/g, '_');
  const edges = selected.flatMap(t => requirements[t.id].map(d => [d, t.id]));
  return { criticalPath, length: criticalPath.length, mermaid: `flowchart TD\n${[...ids].sort().map(id => `  ${nodeName(id)}[${JSON.stringify(id)}]`).join('\n')}\n${edges.map(([a, b]) => `  ${nodeName(a)} --> ${nodeName(b)}`).join('\n')}\n`, dot: `digraph dependencies {\n${[...ids].sort().map(id => `  ${JSON.stringify(id)};`).join('\n')}\n${edges.map(([a, b]) => `  ${JSON.stringify(a)} -> ${JSON.stringify(b)};`).join('\n')}\n}\n` };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' }, area: { type: 'string' }, output: { type: 'string', default: 'planning/contracts/dependencies' } } });
  const snapshot = readJSON(values.snapshot); mkdirSync(values.output, { recursive: true });
  for (const area of values.area ? [values.area] : [null, ...new Set(snapshot.issues.map(t => t.area))].sort()) { const result = exportDag(snapshot, area); writeFileSync(`${values.output}/${area ?? 'all'}.mmd`, result.mermaid); writeFileSync(`${values.output}/${area ?? 'all'}.dot`, result.dot); }
  console.log(JSON.stringify({ criticalPath: exportDag(snapshot).criticalPath }));
}
