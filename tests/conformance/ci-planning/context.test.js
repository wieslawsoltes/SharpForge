import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../../../scripts/planning/lib/io.js';
import { normalizePlanningContext, resolvePlanningContext, validatePlanningContext } from '../../../scripts/conformance/ci-planning/context.js';
import { qualificationEnvironment, runGates } from '../../../scripts/conformance/ci-planning/gates.js';

const repository = 'fixture/repository';
const task = 'SF-A29-T13';
const branch = 'codex/manual-context';
const expected = { repository, number: 23, head: 'a'.repeat(40), base: 'b'.repeat(40) };
const request = () => ({
  number: 23, state: 'open', body: `Task: ${task}`,
  head: { sha: expected.head, ref: branch, repo: { full_name: 'fork/repository' } },
  base: { sha: expected.base, repo: { full_name: repository } }, labels: [{ name: 'seam' }, { name: 'contract-change' }],
});

test('explicit inputs resolve one read-only API snapshot and preserve authoritative labels for fork PRs', async () => {
  const calls = [];
  const context = await resolvePlanningContext({ ...expected, client: { api: async (...args) => {
    calls.push(args);
    return request();
  } } });
  assert.deepEqual(calls, [['GET', 'pulls/23']]);
  assert.equal(context.head, expected.head);
  assert.equal(context.base, expected.base);
  assert.deepEqual(context.pull_request.labels, [{ name: 'contract-change' }, { name: 'seam' }]);
  assert.equal(context.pull_request.head.repo.full_name, 'fork/repository');
  const empty = request();
  empty.labels = [];
  assert.deepEqual(normalizePlanningContext({ ...expected, request: empty }).pull_request.labels, []);
});

test('missing or mutable manual inputs fail before any API request', async () => {
  for (const change of [{ number: undefined }, { number: '23;echo bad' }, { number: '023' },
    { head: 'HEAD' }, { base: 'main' }, { repository: 'fixture/repository/extra' }]) {
    await assert.rejects(resolvePlanningContext({ ...expected, ...change,
      client: { api: () => assert.fail('Invalid inputs must not reach GitHub') } }));
  }
});

test('stale head/base, foreign identity and missing/malformed API labels cannot become a qualification snapshot', () => {
  const changes = [
    value => { value.head.sha = 'c'.repeat(40); },
    value => { value.base.sha = 'c'.repeat(40); },
    value => { value.base.repo.full_name = 'other/repository'; },
    value => { value.number = 24; },
    value => { value.state = 'closed'; },
    value => { delete value.labels; },
    value => { value.labels = ['seam']; },
    value => { delete value.head.ref; },
  ];
  for (const change of changes) {
    const value = request();
    change(value);
    assert.throws(() => normalizePlanningContext({ ...expected, request: value }));
  }
});

function fixture(t, {project = 4} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sf-manual-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = args => git(args, root).trim();
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const commit = changes => {
    for (const [path, value] of Object.entries(changes)) write(path, value);
    command(['add', '.']);
    command(['commit', '-m', 'fixture']);
    return command(['rev-parse', 'HEAD']);
  };
  command(['init', '-b', 'main']);
  command(['config', 'user.name', 'Fixture']);
  command(['config', 'user.email', 'fixture@example.test']);
  command(['config', 'commit.gpgsign', 'false']);
  const base = commit({
    'planning/contracts/ownership.json': { areas: { A29: { write: ['scripts/conformance/**'], evidence: ['tests/**'] } } },
    'planning/contracts/ownership-exceptions.json': { docsOnly: [], generated: [], areaGenerated: [] },
    'planning/contracts/locks.json': { hot: ['packages/hot.js'] },
    'packages/hot.js': 'export const n = 1;\n',
  });
  const snapshot = head => normalizePlanningContext({ ...expected, base, head,
    request: { ...request(), base: { sha: base, repo: { full_name: repository } },
      head: { sha: head, ref: branch, repo: { full_name: 'fork/repository' } } } });
  const client = {
    owner: 'fixture', repo: 'repository',
    items: async () => [{ fields: { 'Work ID': task, Branch: branch }, content: { title: `[${task}] fixture` } }],
    ref: async name => ({ object: { sha: name } }),
    readRecord: async () => ({ task, branch, issue: 483, agent: 'fixture-agent', expires: '2099-01-01T00:00:00Z', locks: [], generation: 'fixture' }),
    graphql: async () => ({repository: {issue: {number: 483, title: `[${task}] fixture`,
      repository: {nameWithOwner: repository}, projectItems: {nodes: [{
        id: `item-${project}`, isArchived: false, project: {id: `project-${project}`, number: project,
          owner: {login: 'fixture'}, url: `https://github.com/users/fixture/projects/${project}`},
        workId: {text: task}, branch: {text: branch}, agent: {text: 'fixture-agent'},
      }], pageInfo: {hasNextPage: false, endCursor: null}},
    }}}),
  };
  const execute = (command, args, options) => command === 'git'
    ? spawnSync(command, args, options) : { status: 0, stdout: '', stderr: '' };
  return { root, base, command, commit, snapshot, client, execute };
}

test('manual context checks the exact checkout and always executes authoritative ownership for an actual PR diff', async t => {
  const value = fixture(t);
  const head = value.commit({ 'scripts/conformance/owned.js': 'export const owned = true;\n' });
  const context = value.snapshot(head);
  const result = await runGates({ ...value, context, repository });
  assert.equal(result.passed, true);
  assert.equal(result.results[0].name, 'ownership and hot-file budget');
  assert.equal(result.results.length, 5);
  assert.equal(result.context.checkout, head);
  assert.equal(result.context.base, value.base);
  assert.deepEqual(result.context.labels, ['contract-change', 'seam']);
  assert.throws(() => validatePlanningContext({ context, root: value.root, repository: 'wrong/repository' }), /another repository/);
  value.command(['checkout', '--detach', value.base]);
  const failed = await runGates({ ...value, context, execute: () => assert.fail('Stale checkout must not execute commands') });
  assert.equal(failed.passed, false);
  assert.match(failed.errors.join('\n'), /Checkout does not match/);
});

test('PR edits to policy cannot authorize its own cross-area hot-file growth', async t => {
  const value = fixture(t);
  const head = value.commit({
    'packages/hot.js': 'export const n = 1;\nexport const added = true;\n',
    'planning/contracts/ownership.json': { areas: { A29: { write: ['**'], evidence: [] } } },
    'planning/contracts/locks.json': {},
  });
  const result = await runGates({ ...value, context: value.snapshot(head) });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /packages\/hot.js: requires lock hot/);
  assert.match(result.errors.join('\n'), /growth requires hot/);
});

test('missing Project access remains a recorded failure with the exact context retained', async t => {
  const value = fixture(t);
  const result = await runGates({ ...value, context: value.snapshot(value.base),
    client: { ...value.client, graphql: async () => { throw new Error('Project access denied'); } },
    execute: () => assert.fail('Denied ownership must stop candidate commands') });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Project access denied/);
  assert.equal(result.context.head, value.base);
  assert.equal(result.results.length, 1);
});

test('manual qualification resolves the claimed issue across Projects without a board scan', async t => {
  for (const project of [6, 9]) {
    const value = fixture(t, {project});
    const head = value.commit({'scripts/conformance/owned.js': 'export const owned = true;\n'});
    const result = await runGates({...value, context: value.snapshot(head), repository,
      client: {...value.client, items: () => assert.fail('Do not scan the default Project board')}});
    assert.equal(result.passed, true, result.errors.join('\n'));
    assert.equal(result.results[0].project.number, project);
    assert.equal(result.results[0].issue, 483);
    assert.equal(result.results.length, 5);
  }
});

test('manual qualification rejects stale managed Project ownership before child commands', async t => {
  const value = fixture(t);
  const response = await value.client.graphql();
  response.repository.issue.projectItems.nodes[0].agent.text = 'different-owner';
  const result = await runGates({...value, context: value.snapshot(value.base), repository,
    client: {...value.client, graphql: async () => response},
    execute: () => assert.fail('Stale Project ownership must stop candidate commands')});
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Agent/);
  assert.equal(result.results.length, 1);
});

test('missing manual planning credentials fail with context before candidate commands', async t => {
  const value = fixture(t);
  const result = await runGates({ ...value, context: value.snapshot(value.base), client: undefined,
    environment: {}, execute: () => assert.fail('Missing credentials must stop candidate commands') });
  assert.equal(result.passed, false);
  assert.equal(result.context.head, value.base);
  assert.equal(result.results.length, 1);
  assert.match(result.errors.join('\n'), /requires GH_TOKEN and read-only PROJECT_READ_TOKEN/);
});

test('qualification subprocesses do not receive repository or Project API tokens', () => {
  const environment = { PATH: 'fixture-path', GH_TOKEN: 'repository', GITHUB_TOKEN: 'repository',
    GH_ENTERPRISE_TOKEN: 'enterprise', GITHUB_ENTERPRISE_TOKEN: 'enterprise', PROJECT_READ_TOKEN: 'project' };
  assert.deepEqual(qualificationEnvironment(environment), { PATH: 'fixture-path' });
  assert.equal(environment.GH_TOKEN, 'repository');
});

test('real CLI invocation without PR context exits nonzero and retains the failure artifact', t => {
  const value = fixture(t);
  const output = join(value.root, 'result.json');
  const cli = fileURLToPath(new URL('../../../scripts/conformance/ci-planning/gates.js', import.meta.url));
  const child = spawnSync(process.execPath, [cli, '--root', value.root, '--output', output], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(child.status, 1, child.stderr);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Missing authoritative PR qualification context/);
});

test('manual and reusable workflow inputs retain separate harness/PR checkouts and read-only permissions', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/planning-gates.yml', import.meta.url), 'utf8');
  for (const input of ['pr_number', 'head_sha', 'base_sha']) {
    assert.equal((workflow.match(new RegExp(`      ${input}:`, 'g')) ?? []).length, 2);
  }
  assert.match(workflow, /ref: \$\{\{ steps.context.outputs.head_sha \}\}/);
  assert.match(workflow, /path: planning-tools/);
  assert.match(workflow, /path: qualified-pr/);
  assert.match(workflow, /gates.js --root qualified-pr --context "\$RUNNER_TEMP\/planning-pr.json"/);
  assert.ok(workflow.indexOf('context.js --output') < workflow.indexOf('ref: ${{ steps.context.outputs.head_sha }}'));
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /pull_request_target|: write/);
  assert.equal((workflow.match(/^          PROJECT_READ_TOKEN:/gm) ?? []).length, 1);
  assert.match(workflow, /workflow_call:\n    secrets:\n      PLANNING_PROJECT_READ_TOKEN:\n        description: [^\n]+\n        required: true/);
  assert.match(workflow, /Ownership, DAG, manifests, contracts and combined-tree regression\n        env:\n          GH_TOKEN: \$\{\{ github.token \}\}\n          PROJECT_READ_TOKEN: \$\{\{ secrets.PLANNING_PROJECT_READ_TOKEN \}\}/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf('      - name: Explicit flake measurement')), /PROJECT_READ_TOKEN|secrets\./);
});
