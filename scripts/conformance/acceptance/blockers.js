import { readFile } from 'node:fs/promises';
import { validate } from '../../planning/schema/validate.js';
export async function readBlockers(
  path = new URL(
    '../../../planning/qualification/blockers.json',
    import.meta.url,
  ),
) {
  const value = JSON.parse(await readFile(path));
  const schema = JSON.parse(
    await readFile(
      new URL(
        '../../../tests/conformance/acceptance/blockers.schema.json',
        import.meta.url,
      ),
    ),
  );
  validate(schema, value);
  if (
    new Set(value.blockers.map((row) => row.id)).size !== value.blockers.length
  )
    throw new Error('Duplicate blocker id');
  const snapshot = JSON.parse(
    await readFile(
      new URL('../../../planning/backlog.snapshot.json', import.meta.url),
    ),
  );
  const knownTasks = new Set(snapshot.issues.map((row) => row.id));
  for (const row of value.blockers)
    for (const id of row.taskIds) {
      if (!knownTasks.has(id)) throw new Error('Unknown blocker task: ' + id);
    }
  return value;
}
export function recordedBlocker(ledger, id, scenario, target) {
  const row = ledger.blockers.find(
    (item) =>
      item.id === id &&
      item.scenarios.includes(scenario) &&
      item.targets.includes(target),
  );
  if (!row)
    throw new Error(`Unrecorded blocker ${id} for ${scenario}/${target}`);
  return row;
}
export const unavailable = Object.freeze({
  'git-init': 'A25-GIT',
  'git-commit': 'A25-GIT',
  'git-branch': 'A25-GIT',
  'git-merge': 'A25-GIT',
  publish: 'A26-PUBLISH',
});
