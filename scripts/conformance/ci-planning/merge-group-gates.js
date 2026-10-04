import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { GitHubProject } from '../../planning/lib/github-project.js';
import { ghTransport, isReadOnlyRequest } from '../../planning/lib/gh-retry.js';
import { isMain } from '../../planning/lib/io.js';
import { checkContractChange, contractsAt, versionsAt } from '../../planning/check-contract-change.js';
import { checkSeamLock } from '../../planning/golden-output.js';
import { qualificationEnvironment, reviewOwnership } from './gates.js';
import { groupGit, validateMergeGroupContext } from './merge-group-context.js';
import { createPlan } from './impact.js';
import { groupClaimedIdentity } from './merge-group-projects.js';

/** Project GraphQL reads and repository reads use separate, explicitly configured credentials. */
export function mergeGroupClient(environment = process.env, { spawnProcess = spawn } = {}) {
  if (!environment.GH_TOKEN || !environment.PROJECT_READ_TOKEN) {
    throw new Error('Merge-group planning requires GH_TOKEN and read-only PROJECT_READ_TOKEN (PLANNING_PROJECT_READ_TOKEN secret)');
  }
  const transport = token => ghTransport({ spawnProcess: (command, args, options) => spawnProcess(command, args, {
    ...options, env: { ...qualificationEnvironment(environment), GH_TOKEN: token },
  }) });
  const project = transport(environment.PROJECT_READ_TOKEN), repository = transport(environment.GH_TOKEN);
  const [owner, repo] = (environment.GITHUB_REPOSITORY ?? '').split('/');
  return new GitHubProject({ owner, repo, transport: request => {
    if (!isReadOnlyRequest(request)) throw new Error('Merge-group planning credentials permit read-only requests');
    return request.path === 'graphql' ? project(request) : repository(request);
  } });
}

/** Review the actual commits with only the contributing PR's authoritative labels. */
function reviewContracts({ root, base, head, labels }) {
  const contracts = checkContractChange({ before: contractsAt(base, root), after: contractsAt(head, root),
    beforeVersions: versionsAt(base, root), afterVersions: versionsAt(head, root), labels });
  const seam = checkSeamLock({ root, base, head, labels });
  const errors = [...contracts.errors, ...seam.errors];
  return { passed: errors.length === 0, changes: contracts.changes, errors, error: errors.join('\n') };
}

/** Qualify each constituent and each actual combined-tree contribution, in queue order. */
export async function runMergeGroupGates({ root = process.cwd(), context, repository, client, execute = spawnSync } = {}) {
  const results = [], errors = [];
  const record = (name, result) => {
    results.push({ name, ...result });
    if (!result.passed) errors.push(`${name}: ${result.error || result.stderr || 'failed'}`);
  };
  let verified;
  try { verified = validateMergeGroupContext({ context, root, repository }); }
  catch (error) {
    record('merge-group context', { passed: false, error: error.message });
    return { schemaVersion: 1, passed: false, results, errors };
  }
  for (const entry of verified.entries) {
    const prefix = `PR #${entry.pull_request.number}`;
    let identity, mergeBase;
    try {
      identity = await groupClaimedIdentity(client, entry.pull_request);
      mergeBase = groupGit(['merge-base', '--all', verified.base, entry.head], root);
      if (!/^[a-f0-9]{40}$/.test(mergeBase)) throw new Error('Constituent requires one unambiguous merge base');
      for (const [scope, before, after] of [['source', mergeBase, entry.head], ['combined contribution', entry.parent, entry.commit]]) {
        record(`${prefix} ${scope} ownership`, { ...reviewOwnership({ root, base: verified.base,
          mergeBase: before, head: after, identity, execute }), project: identity.project, issue: identity.issue });
      }
    } catch (error) { record(`${prefix} ownership`, { passed: false, error: error.message }); }
    try {
      // Do not union labels: another PR's contract-change/seam label cannot authorize this one.
      const labels = entry.pull_request.labels.map(label => label.name);
      if (mergeBase) record(`${prefix} source contracts`, reviewContracts({ root, base: mergeBase, head: entry.head, labels }));
      record(`${prefix} combined contribution contracts`, reviewContracts({ root, base: entry.parent, head: entry.commit, labels }));
    } catch (error) { record(`${prefix} contracts`, { passed: false, error: error.message }); }
  }
  // Invalid context, ownership or combined contracts cannot reach candidate-controlled commands.
  if (!errors.length) {
    for (const [name, ...args] of [
      ['combined DAG', 'scripts/planning/dag.js'],
      ['combined test manifests', 'scripts/planning/check-test-manifests.js'],
      ['combined contract integration', 'scripts/planning/contract-gate.js'],
    ]) {
      const child = execute(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 180000,
        maxBuffer: 16 * 1024 * 1024, env: qualificationEnvironment() });
      record(name, { passed: child.status === 0, exitCode: child.status, stdout: child.stdout ?? '', stderr: child.stderr ?? '',
        error: child.error?.message ?? (child.status ? child.stderr?.trim() || `exit ${child.status}` : null) });
    }
  }
  return { schemaVersion: 1, passed: errors.length === 0, context: verified, results, errors };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: {
    root: { type: 'string', default: '.' }, context: { type: 'string' },
    output: { type: 'string', default: 'artifacts/merge-group-gates.json' }, plan: { type: 'string' },
  } });
  try {
    const root = resolve(values.root);
    const context = values.context ? JSON.parse(readFileSync(values.context, 'utf8')) : undefined;
    const repository = process.env.GITHUB_REPOSITORY;
    const result = await runMergeGroupGates({ root, context, repository, client: mergeGroupClient() });
    mkdirSync(dirname(values.output), { recursive: true });
    writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '### Merge-group planning gates\n\n' + result.results.map(check => `#### ${check.name}: ${check.passed ? 'pass' : 'fail'}\n\n<pre>${
        (check.error || check.stdout || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      }</pre>\n`).join('\n'));
    if (result.passed && values.plan) {
      const plan = await createPlan({ root, eventName: 'merge_group', event: { merge_group: { base_sha: context.base } } });
      mkdirSync(dirname(values.plan), { recursive: true });
      writeFileSync(values.plan, JSON.stringify(plan, null, 2) + '\n');
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(plan.matrix)}\n`);
    }
    console.log(JSON.stringify(result));
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
