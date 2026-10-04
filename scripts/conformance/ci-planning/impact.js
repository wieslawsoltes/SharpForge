import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ciMatrix } from '../../planning/ci-matrix.js';
import { discoverManifests } from '../../planning/test-manifests.js';
import { importGraph } from '../../planning/import-graph.js';
import { impactedTests } from '../../planning/impacted-tests.js';
import { matches } from '../../planning/lib/paths.js';
import { git, isMain } from '../../planning/lib/io.js';
import { runProcess } from '../../planning/run-tests.js';

const sharedAreas = ['A00', 'A29'];
const sha = /^[a-f0-9]{40}$/;

/** Unknown impact always selects the full matrix; shared contracts and infrastructure remain selected. */
export function selectImpact({ manifests, graph, files, ownership, eventName = 'pull_request' }) {
  let reason = eventName === 'pull_request' ? null : 'Full qualification event';
  if (!reason && (!graph || graph.errors.length)) reason = 'Import graph unavailable or unresolved';
  if (!reason && files.some(path => !path.endsWith('.js') && !/^docs\/.*\.md$/.test(path))) {
    reason = 'Non-JavaScript or shared configuration impact requires full fallback';
  }
  let areas;
  if (!reason) {
    const selected = impactedTests({ graph, manifests, files }).areas;
    const owners = Object.entries(ownership.areas)
      .filter(([, value]) => files.some(path => matches(path, [...value.write, ...value.evidence])))
      .map(([area]) => area);
    const unknown = files.filter(path => !/^docs\/.*\.md$/.test(path))
      .some(path => !graph.modules.some(module => module.path === path) || !Object.values(ownership.areas)
        .some(value => matches(path, [...value.write, ...value.evidence])));
    if (unknown) reason = 'Changed module has no resolved graph/ownership coverage';
    else areas = [...new Set([...selected, ...owners, ...sharedAreas])].sort();
  }
  const chosen = reason ? manifests : manifests.filter(manifest => areas.includes(manifest.area));
  return {
    schemaVersion: 1,
    mode: reason ? 'full' : 'impacted',
    reason: reason ?? 'Static consumers plus owning and shared areas',
    files,
    areas: chosen.map(manifest => manifest.area),
    nodeFiles: chosen.flatMap(manifest => manifest.nodeFiles),
    browserScripts: chosen.flatMap(manifest => manifest.browserScripts),
  };
}

export async function createPlan({ root = process.cwd(), eventName = process.env.GITHUB_EVENT_NAME, event = {} } = {}) {
  const manifests = await discoverManifests(root);
  const head = git(['rev-parse', 'HEAD'], root).trim();
  const base = event.pull_request?.base?.sha ?? event.merge_group?.base_sha;
  let graph, files = [], fallback;
  if (eventName === 'pull_request') {
    try {
      if (!sha.test(base ?? '')) throw new Error('Missing immutable PR base');
      files = git(['diff', '--no-renames', '--name-only', '-z', `${base}...HEAD`], root).split('\0').filter(Boolean);
      graph = importGraph(root);
    } catch (error) {
      fallback = error.message;
    }
  }
  const ownership = JSON.parse(readFileSync(resolve(root, 'planning/contracts/ownership.json'), 'utf8'));
  const full = event.pull_request?.labels?.some(label => label.name === 'full-ci');
  const plan = selectImpact({ manifests, graph, files, ownership, eventName: full ? 'full-ci' : eventName });
  if (fallback) plan.reason = `Full fallback: ${fallback}`;
  const matrix = await ciMatrix(root);
  return { ...plan, head, base: base ?? null, matrix: { include: matrix.include.filter(row => plan.areas.includes(row.area)) } };
}

export async function runImpacted(plan, root = process.cwd()) {
  if (plan.mode !== 'impacted' || git(['rev-parse', 'HEAD'], root).trim() !== plan.head) {
    throw new Error('Impacted execution requires a plan for this exact checkout');
  }
  const manifests = await discoverManifests(root);
  const selected = manifests.filter(manifest => plan.areas.includes(manifest.area));
  if (selected.length !== plan.areas.length || sharedAreas.some(area => !plan.areas.includes(area))) {
    throw new Error('Plan has invalid areas or omits shared checks');
  }
  const expected = selected.flatMap(manifest => manifest.nodeFiles);
  if (JSON.stringify(expected) !== JSON.stringify(plan.nodeFiles)) throw new Error('Plan test membership drift');
  if (!expected.length) throw new Error('Impacted plan has no Node tests');
  return runProcess(process.execPath, ['--test', '--test-concurrency=1', '--test-timeout=' + Math.max(...selected.map(item => item.timeout)), ...expected], { cwd: root });
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { run: { type: 'string' }, output: { type: 'string', default: 'artifacts/ci-plan.json' } } });
  try {
    if (values.run) process.exitCode = await runImpacted(JSON.parse(readFileSync(values.run, 'utf8')));
    else {
      const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
      const plan = await createPlan({ event });
      mkdirSync(dirname(values.output), { recursive: true });
      writeFileSync(values.output, JSON.stringify(plan, null, 2) + '\n');
      console.log(JSON.stringify(plan));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `mode=${plan.mode}\nmatrix=${JSON.stringify(plan.matrix)}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `### Test impact\n\n${plan.mode}: ${plan.areas.join(', ')}\n\n${plan.reason.replaceAll('\n', ' ')}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
