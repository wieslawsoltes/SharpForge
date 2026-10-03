import { parseArgs } from 'node:util';
import { readJSON, isMain, report } from './lib/io.js';
import { validateDag } from './validate-dag.js';
export function readiness(snapshot, id, contracts = {}) {
  const validation = validateDag(snapshot); if (validation.errors.length) return { id, ready: false, errors: validation.errors, blockers: [] };
  const tasks = new Map(snapshot.issues.map(t => [t.id, t])), task = tasks.get(id), blockers = new Set();
  if (!task) return { id, ready: false, errors: [`Unknown task ${id}`], blockers: [] };
  if (task.kind === 'Epic' || snapshot.issues.some(t => t.parent === id)) blockers.add(`${id}: not a leaf`);
  if (task.state !== 'OPEN') blockers.add(`${id}: issue is not open`);
  const seen = new Set();
  function requirement(t) {
    if (seen.has(t.id)) return; seen.add(t.id);
    for (const dependency of t.dependencies) {
      const dep = tasks.get(dependency);
      const merged = dep.state === 'CLOSED' && dep.pullRequests?.some(pr => pr.merged && pr.baseRefName === snapshot.defaultBranch && /^[0-9a-f]{40}$/.test(pr.mergeCommit ?? ''));
      if (!merged) blockers.add(`${dependency}: no closed issue with merged ${snapshot.defaultBranch} evidence`);
      requirement(dep);
    }
    for (const contract of t.contracts ?? []) {
      const actual = contracts[contract.name];
      if (!actual || String(actual.version) !== contract.version || actual.qualified !== true || !/^[0-9a-f]{40}$/.test(actual.commit ?? '')) blockers.add(`${contract.name}@${contract.version}: not qualified at a recorded commit`);
    }
  }
  requirement(task);
  let parent = task.parent; const parents = new Set();
  while (parent && tasks.has(parent)) { if (parents.has(parent)) { blockers.add(`Parent cycle at ${parent}`); break; } parents.add(parent); requirement(tasks.get(parent)); parent = tasks.get(parent).parent; }
  return { id, ready: blockers.size === 0, errors: [], blockers: [...blockers].sort() };
}
export function requireReady(snapshot, id, { contracts = {}, now = new Date(), maxAgeHours = 24 } = {}) {
  const age = now.getTime() - Date.parse(snapshot.updatedAt);
  if (!Number.isFinite(age) || age < -60000 || age > maxAgeHours * 3600000) throw new Error('Backlog snapshot stale or invalid; refresh before claiming');
  const result = readiness(snapshot, id, contracts);
  if (!result.ready) throw new Error(`Task ${id} blocked: ${[...result.errors, ...result.blockers].join('; ')}`);
  return result;
}
if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { snapshot: { type: 'string', default: 'planning/backlog.snapshot.json' }, task: { type: 'string' }, contracts: { type: 'string' } } });
  const result = readiness(readJSON(values.snapshot), values.task, values.contracts ? readJSON(values.contracts) : {});
  report(result); if (!result.ready) process.exitCode = 1;
}
