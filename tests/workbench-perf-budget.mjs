import {readFile} from 'node:fs/promises';

/** Compare integrated browser traces: an absolute budget or >20% p95 regression fails the command. */
export function compareWorkbenchTraces(current, baseline, budgets = {}) {
  if (current.format !== 'sharpforge-workbench-trace' || baseline.format !== current.format ||
      current.units !== 'milliseconds' || baseline.units !== current.units) throw new TypeError('Expected workbench millisecond traces');
  const previous = new Map(baseline.summary.map(item => [item.name + ':' + item.sessionId, item]));
  return current.summary.flatMap(item => {
    const before = previous.get(item.name + ':' + item.sessionId);
    const limit = Math.min(budgets[item.name] ?? Infinity, before ? before.p95 * 1.2 : Infinity);
    return item.p95 > limit ? [{name: item.name, sessionId: item.sessionId, p95: item.p95, baseline: before?.p95, limit}] : [];
  });
}

if (process.argv[1]?.endsWith('workbench-perf-budget.mjs')) {
  const [currentPath, baselinePath, budgetsPath] = process.argv.slice(2);
  if (!currentPath || !baselinePath) throw new Error('Usage: node tests/workbench-perf-budget.mjs current.json baseline.json [budgets.json]');
  const [current, baseline, budgets] = await Promise.all([currentPath, baselinePath, budgetsPath].map(async path =>
    path ? JSON.parse(await readFile(path, 'utf8')) : {}));
  const failures = compareWorkbenchTraces(current, baseline, budgets);
  process.stdout.write(JSON.stringify({passed: failures.length === 0, failures}, null, 2) + '\n');
  process.exitCode = failures.length ? 1 : 0;
}
