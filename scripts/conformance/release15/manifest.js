import { readFile } from 'node:fs/promises';
export const requirements = Object.freeze([
  'remote-edit-design',
  'session-isolation',
  'numeric-network',
  'gpu-fallback-loss',
  'downloaded-app-html',
  'provider-auth',
  'keyboard-dpi-designers',
  'source-reproduction',
  'platform-reporting',
]);
const actions = new Set([
  'documents',
  'sessions',
  'canvas2d',
  'dom',
  'webgpu',
  'device-loss',
  'geometry',
]);
export function validateManifest(scenario, ledger, knownTasks) {
  if (
    scenario.schemaVersion !== 1 ||
    scenario.task !== 'SF-R015-T04' ||
    !Array.isArray(scenario.checks) ||
    scenario.checks.length < requirements.length ||
    scenario.checks.length > 50
  )
    throw new Error('Invalid release15 scenario');
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.blockers))
    throw new Error('Invalid blocker ledger');
  const ids = new Set(),
    blockers = new Map();
  for (const row of ledger.blockers) {
    if (
      !/^[A-Z][A-Z0-9-]+$/.test(row.id) ||
      blockers.has(row.id) ||
      !row.taskIds?.length ||
      row.taskIds.some((id) => !knownTasks.has(id)) ||
      typeof row.reason !== 'string' ||
      row.reason.length < 20
    )
      throw new Error('Invalid, duplicate or unknown task-linked blocker');
    blockers.set(row.id, row);
  }
  for (const row of scenario.checks) {
    if (
      !/^[a-z][a-z0-9-]+$/.test(row.id) ||
      ids.has(row.id) ||
      !requirements.includes(row.requirement)
    )
      throw new Error('Invalid check identity');
    ids.add(row.id);
    if (!!row.blocker === !!row.adapter)
      throw new Error('Check requires either a blocker or actual adapter');
    if (row.blocker && (!blockers.has(row.blocker) || !row.steps?.length))
      throw new Error('Unrecorded blocker or missing concrete steps');
    if (
      row.adapter &&
      !['t12-cli', 't12-studio', 'browser', 'local-io', 'archive'].includes(
        row.adapter,
      )
    )
      throw new Error('Unknown adapter');
    if (
      row.adapter === 'browser' &&
      (!row.actions?.length ||
        row.actions.some((action) => !actions.has(action)))
    )
      throw new Error('Unknown browser action');
    if (
      row.adapter?.startsWith('t12-') &&
      !['solution-edit-build-debug', 'designer-roundtrip'].includes(
        row.scenario,
      )
    )
      throw new Error('Unknown T12 scenario');
  }
  for (const requirement of requirements)
    if (!scenario.checks.some((row) => row.requirement === requirement))
      throw new Error('Missing requirement: ' + requirement);
  return blockers;
}
export async function loadManifest() {
  const read = async (path) =>
    JSON.parse(await readFile(new URL(path, import.meta.url)));
  const scenario = await read(
    '../../../tests/conformance/release15/scenario.json',
  );
  const ledger = await read(
    '../../../planning/qualification/release15/blockers.json',
  );
  const snapshot = await read('../../../planning/backlog.snapshot.json');
  const blockers = validateManifest(
    scenario,
    ledger,
    new Set(snapshot.issues.map((row) => row.id)),
  );
  return { scenario, ledger, blockers };
}
