import { parseArgs } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, isMain } from './lib/io.js';
import { validateDag } from './validate-dag.js';

const compareNames = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const comparePaths = (left, right) => right.length - left.length || compareNames(left.join(','), right.join(','));

function analyze(snapshot) {
  const { errors, order, edges: requirements } = validateDag(snapshot);
  if (errors.length) throw new Error(errors.join('\n'));
  const longest = new Map();
  for (const id of order) {
    const paths = requirements[id].map(dependency => longest.get(dependency));
    longest.set(id, [...(paths.sort(comparePaths)[0] ?? []), id]);
  }
  const criticalPath = [...longest.values()].sort(comparePaths)[0] ?? [];
  return { requirements, criticalPath };
}

function render(ids, edges) {
  const names = [...ids].sort(compareNames);
  const orderedEdges = [...edges].sort((left, right) => compareNames(left.join(','), right.join(',')));
  const nodeName = id => id.replace(/[-.]/g, '_');
  const mermaid = [
    'flowchart TD',
    ...names.map(id => `  ${nodeName(id)}[${JSON.stringify(id)}]`),
    ...orderedEdges.map(([before, after]) => `  ${nodeName(before)} --> ${nodeName(after)}`),
  ].join('\n') + '\n';
  const dot = [
    'digraph dependencies {',
    ...names.map(id => `  ${JSON.stringify(id)};`),
    ...orderedEdges.map(([before, after]) => `  ${JSON.stringify(before)} -> ${JSON.stringify(after)};`),
    '}',
  ].join('\n') + '\n';
  return { mermaid, dot };
}

function areaDiagram(snapshot, requirements, area) {
  if (area != null && (!/^(?:A\d{2}|R\d{3})$/.test(area) || !snapshot.issues.some(task => task.area === area))) {
    throw new Error(`Unknown area: ${area}`);
  }
  const selected = snapshot.issues.filter(task => area == null || task.area === area);
  const ids = new Set(selected.map(task => task.id));
  const edges = [];
  for (const task of selected) {
    for (const dependency of requirements[task.id]) {
      ids.add(dependency);
      edges.push([dependency, task.id]);
    }
  }
  return render(ids, edges);
}

function criticalDiagram(path) {
  return render(path, path.slice(1).map((id, index) => [path[index], id]));
}

/** Export the selected area and the global longest dependency chain; length counts tasks, not edges or elapsed time. */
export function exportDag(snapshot, area) {
  const { requirements, criticalPath } = analyze(snapshot);
  const critical = criticalDiagram(criticalPath);
  return {
    criticalPath,
    length: criticalPath.length,
    ...areaDiagram(snapshot, requirements, area),
    criticalMermaid: critical.mermaid,
    criticalDot: critical.dot,
  };
}

/** Validate the complete graph before writing all/per-area and dedicated critical-path diagram pairs. */
export function writeDagExports(snapshot, { area, output = 'planning/contracts/dependencies' } = {}) {
  const { requirements, criticalPath } = analyze(snapshot);
  const areas = area == null ? [null, ...new Set(snapshot.issues.map(task => task.area))].sort(compareNames) : [area];
  const diagrams = areas.map(selected => ({
    name: selected ?? 'all',
    ...areaDiagram(snapshot, requirements, selected),
  }));
  diagrams.push({ name: 'critical-path', ...criticalDiagram(criticalPath) });
  mkdirSync(output, { recursive: true });
  const files = [];
  for (const { name, mermaid, dot } of diagrams) {
    for (const [extension, text] of [['mmd', mermaid], ['dot', dot]]) {
      const file = `${name}.${extension}`;
      writeFileSync(join(output, file), text);
      files.push(file);
    }
  }
  return { criticalPath, length: criticalPath.length, files };
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' },
      area: { type: 'string' },
      output: { type: 'string', default: 'planning/contracts/dependencies' },
    } });
    console.log(JSON.stringify(writeDagExports(readJSON(values.snapshot), values)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
