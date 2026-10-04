import { parseArgs } from 'node:util';
import { readJSON, isMain, report } from './lib/io.js';
import { WORK_ID } from './lib/deps-parse.js';
const defaultPolicy = readJSON(new URL('../../planning/contracts/dependency-scopes.json', import.meta.url));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const boundary = (child, parent) => JSON.stringify([child, parent]);

function inheritanceScopes(policy, nodes, errors) {
  const scopes = new Map(), seen = new Set(), start = errors.length;
  if (!object(policy) || policy.version !== 1 || !Array.isArray(policy.exceptions) ||
      Object.keys(policy).some(key => !['version', 'exceptions'].includes(key))) {
    errors.push('Invalid dependency scope policy: expected version 1 and exceptions');
    return scopes;
  }
  for (const [index, entry] of policy.exceptions.entries()) {
    const label = `Dependency scope ${index}`;
    if (!object(entry) || Object.keys(entry).some(key => !['child', 'parent', 'dependency', 'sourceIssue', 'reason'].includes(key)) ||
        !['child', 'parent', 'dependency'].every(key => typeof entry[key] === 'string' && WORK_ID.test(entry[key])) ||
        !Number.isSafeInteger(entry.sourceIssue) || entry.sourceIssue <= 0 || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push(`${label}: invalid child, parent, dependency, source issue or reason`);
      continue;
    }
    const key = JSON.stringify([entry.child, entry.parent, entry.dependency]);
    if (seen.has(key)) { errors.push(`${label}: duplicate exception ${key}`); continue; }
    seen.add(key);
    const child = nodes.get(entry.child);
    // A partial snapshot need not contain every release slice in the policy.
    if (!child) continue;
    if (child.number !== entry.sourceIssue || child.parent !== entry.parent) {
      errors.push(`${label}: ${entry.child} source issue or parent changed`);
      continue;
    }
    const parent = nodes.get(entry.parent);
    if (!parent || !nodes.has(entry.dependency) || !parent.dependencies.includes(entry.dependency)) {
      errors.push(`${label}: stale inherited dependency ${entry.parent} -> ${entry.dependency}`);
      continue;
    }
    const path = boundary(entry.child, entry.parent);
    if (!scopes.has(path)) scopes.set(path, new Set());
    scopes.get(path).add(entry.dependency);
  }
  // Invalid policy must never partially weaken the graph.
  return errors.length === start ? scopes : new Map();
}

export function validateDag(snapshot, { policy = defaultPolicy } = {}) {
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
  const scopes = inheritanceScopes(policy, nodes, errors);
  const edges = Object.fromEntries([...nodes].map(([id, task]) => {
    const dependencies = new Set(task.dependencies), seen = new Set([id]); let cursor = task;
    while (cursor.parent && nodes.has(cursor.parent) && !seen.has(cursor.parent)) {
      const parent = nodes.get(cursor.parent), excluded = scopes.get(boundary(cursor.id, parent.id));
      seen.add(parent.id);
      for (const dependency of parent.dependencies) if (!excluded?.has(dependency)) dependencies.add(dependency);
      cursor = parent;
    }
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
