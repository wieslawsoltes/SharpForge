import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { checkOwnership } from '../../planning/check-ownership.js';
import { checkHotFiles } from '../../planning/check-hot-files.js';
import { git, isMain } from '../../planning/lib/io.js';
import { validatePlanningContext } from './context.js';
import { projectClaimedIdentity } from './merge-group-projects.js';
export { claimedIdentity } from './claim-identity.js';
import { planningClient, qualificationEnvironment } from './qualification-client.js';
export { qualificationEnvironment } from './qualification-client.js';

const load = (root, ref, path) => JSON.parse(git(['show', `${ref}:${path}`], root));

/** Evaluate one contribution using policy from the pinned base and only its own claim. */
export function reviewOwnership({ root, base, head, mergeBase, identity, execute = spawnSync }) {
  const files = git(['diff', '--no-renames', '--name-only', '-z', mergeBase, head], root).split('\0').filter(Boolean);
  const lockRegistry = load(root, base, 'planning/contracts/locks.json');
  for (const lock of identity.locks) if (!lockRegistry[lock.key] && lock.paths.length) lockRegistry[lock.key] = lock.paths;
  const heldLocks = identity.locks.map(lock => lock.key);
  const ownership = checkOwnership({ files, area: identity.area, ownership: load(root, base, 'planning/contracts/ownership.json'),
    exceptions: load(root, base, 'planning/contracts/ownership-exceptions.json'), lockRegistry, heldLocks });
  const text = (ref, path) => {
    const result = execute('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout : '';
  };
  const changes = Object.fromEntries(files.map(path => [path, { before: text(mergeBase, path), after: text(head, path) }]));
  const hot = checkHotFiles(changes, lockRegistry, heldLocks);
  return { passed: !ownership.errors.length && !hot.errors.length,
    task: identity.task, errors: [...ownership.errors, ...hot.errors], error: [...ownership.errors, ...hot.errors].join('\n') };
}

export async function runGates({ root = process.cwd(), context, repository, client, environment = process.env, execute = spawnSync } = {}) {
  const results = [], errors = [];
  const record = (name, result) => {
    results.push({ name, ...result });
    if (!result.passed) errors.push(`${name}: ${result.error ?? result.stderr ?? 'failed'}`);
  };
  let verified;
  try {
    verified = validatePlanningContext({ context, root, repository });
  } catch (error) {
    record('PR qualification context', { passed: false, error: error.message });
    return { schemaVersion: 1, passed: false, results, errors };
  }
  try {
    const identity = await projectClaimedIdentity(client ?? planningClient(environment), verified.pull_request);
    record('ownership and hot-file budget', { ...reviewOwnership({ root, ...verified, identity, execute }),
      project: identity.project, issue: identity.issue });
  } catch (error) {
    record('ownership and hot-file budget', { passed: false, error: error.message });
  }
  if (errors.length) return { schemaVersion: 1, passed: false, context: verified, results, errors };
  const commands = [
    ['DAG', 'scripts/planning/dag.js'],
    ['test manifests', 'scripts/planning/check-test-manifests.js'],
    ['contracts', 'scripts/planning/contract-gate.js'],
    ['combined-tree compatibility', '--test', '--test-concurrency=1', 'planning/contracts/tests/merge-pair.test.js'],
  ];
  for (const [name, ...args] of commands) {
    const child = execute(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000,
      maxBuffer: 16 * 1024 * 1024, env: qualificationEnvironment(environment) });
    record(name, { passed: child.status === 0, exitCode: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '',
      error: child.error?.message ?? (child.status ? child.stderr?.trim() || `exit ${child.status}` : null) });
  }
  return { schemaVersion: 1, passed: errors.length === 0, context: verified, results, errors };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: {
    root: { type: 'string', default: '.' }, context: { type: 'string' },
    output: { type: 'string', default: 'artifacts/planning-gates.json' },
  } });
  try {
    const context = values.context ? JSON.parse(readFileSync(values.context, 'utf8')) : undefined;
    const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'wieslawsoltes/SharpForge').split('/');
    const result = await runGates({ root: resolve(values.root), context, repository: `${owner}/${repo}` });
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### Planning gates\n\n' + result.results.map(check => `#### ${check.name}: ${check.passed ? 'pass' : 'fail'}\n\n<pre>${
        (check.error || check.stdout || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      }</pre>\n`).join('\n'));
    console.log(JSON.stringify(result));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
