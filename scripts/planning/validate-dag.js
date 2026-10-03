import { parseArgs } from 'node:util';
import { readJSON, isMain, report } from './lib/io.js';
import { WORK_ID } from './lib/deps-parse.js';
export function validateDag(snapshot) {
  const errors = [], nodes = new Map();
  for (const task of snapshot.issues) {
    if (!WORK_ID.test(task.id)) { errors.push(`Invalid work ID: ${task.id}`); continue; }
    if (nodes.has(task.id)) errors.push(`Duplicate work ID: ${task.id}`);
    nodes.set(task.id, task);
  }
  for (const task of nodes.values()) for (const dependency of task.dependencies) if (!nodes.has(dependency)) errors.push(`${task.id}: unresolved dependency ${dependency}`);
  for (const task of nodes.values()) {
    if (task.parent && !nodes.has(task.parent)) errors.push(`${task.id}: unresolved parent ${task.parent}`);
    const parents = new Set([task.id]); let parent = task.parent;
    while (parent && nodes.has(parent)) { if (parents.has(parent)) { errors.push(`Parent cycle: ${[...parents, parent].join(' -> ')}`); break; } parents.add(parent); parent = nodes.get(parent).parent; }
  }
  const edges = Object.fromEntries([...nodes].map(([id, task]) => {
    const dependencies = new Set(task.dependencies), seen = new Set([id]); let parent = task.parent;
    while (parent && nodes.has(parent) && !seen.has(parent)) { seen.add(parent); for (const dependency of nodes.get(parent).dependencies) dependencies.add(dependency); parent = nodes.get(parent).parent; }
    return [id, [...dependencies].sort()];
  }));
  const visited = new Set(), active = new Set(), order = [], stack = [];
  function visit(id) {
    if (active.has(id)) { errors.push(`Cycle: ${[...stack.slice(stack.indexOf(id)), id].join(' -> ')}`); return; }
    if (visited.has(id) || !nodes.has(id)) return;
    active.add(id); stack.push(id);
    for (const dependency of edges[id]) visit(dependency);
    stack.pop(); active.delete(id); visited.add(id); order.push(id);
  }
  for (const id of [...nodes.keys()].sort()) visit(id);
  return { errors, order, edges };
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' } } });
  report(validateDag(readJSON(values.snapshot)));
}
