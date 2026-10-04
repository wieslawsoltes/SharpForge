import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { checkContractChange, contractsAt, versionsAt } from '../../../scripts/planning/check-contract-change.js';
import { resolveMergeGroupContext } from '../../../scripts/conformance/ci-planning/merge-group-context.js';
import { mergeGroupClient, runMergeGroupGates } from '../../../scripts/conformance/ci-planning/merge-group-gates.js';
import { mergeGroupFixture } from './merge-group-fixture.js';

function claims(value, { leftLocks = [] } = {}) {
  const records = value.requests.map((request, index) => ({ task: `SF-A29-T${13 + index}`, branch: request.head.ref,
    issue: 483 + index, agent: 'codex-fixture', expires: '2099-01-01T00:00:00Z', generation: `generation-${index}`, locks: index ? [] : leftLocks }));
  return {
    owner: 'fixture', repo: 'repository',
    items: async () => assert.fail('Queue claims must not scan default Project4'),
    graphql: async (_query, variables) => {
      const record = records.find(record => record.issue === variables.issue);
      return { repository: { issue: { number: record.issue, title: `[${record.task}] fixture`, repository: { nameWithOwner: value.repository },
        projectItems: { nodes: [{ id: `item-${record.issue}`, isArchived: false, project: { id: 'project-4', number: 4, owner: { login: 'fixture' } },
          workId: { text: record.task }, branch: { text: record.branch }, agent: { text: record.agent } }], pageInfo: { hasNextPage: false, endCursor: null } } } } };
    },
    ref: async name => ({ object: { sha: name } }),
    readRecord: async ref => ref.startsWith('agent-locks/')
      ? { task: records[0].task, generation: records[0].generation, paths: ['packages/private.js'] }
      : records.find(record => ref === `agent/${record.task}`),
  };
}

function compatible(value, { breaking = false, privateSource = false, privateMerge = false } = {}) {
  const existing = breaking ? { id: 0, name: 'renamed' } : value.baseline[0];
  const added = { id: 2, name: 'Right' };
  value.command(['checkout', '--detach', value.base]);
  value.right = value.commit({ [value.contract]: [existing, added],
    ...(breaking ? { 'planning/contracts/versions.json': { framework: 2 } } : {}),
    ...(privateSource ? { 'packages/private.js': 'export const privateValue = true;\n' } : {}),
  });
  value.write(value.contract, [existing, value.leftIds[1], added]);
  if (privateMerge) value.write('packages/private.js', 'export const mergeOnly = true;\n');
  value.command(['add', '.']);
  value.head = value.command(['commit-tree', value.command(['write-tree']), '-p', value.first, '-p', value.right, '-m', 'combined compatible fixture']);
  value.command(['reset', '--hard', value.head]);
  value.requests[1].head.sha = value.right;
  value.client.ref = async () => ({ object: { sha: value.head } });
  return value;
}

function execution(calls, outcome = () => ({ status: 0, stdout: '', stderr: '' })) {
  return (command, args, options) => {
    if (command === 'git') return spawnSync(command, args, options);
    calls.push({ command, args, options });
    return outcome(args);
  };
}

test('context-free queue qualification fails before claims or child commands', async t => {
  const value = mergeGroupFixture(t);
  const result = await runMergeGroupGates({ root: value.root,
    client: { items: () => assert.fail('No claims without context') }, execute: () => assert.fail('No command without context') });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Missing authoritative merge-group/);
});

test('two individually compatible real PRs fail on their actual incompatible combined tree', async t => {
  const value = mergeGroupFixture(t);
  for (const head of [value.left, value.right]) {
    const result = checkContractChange({ before: contractsAt(value.base, value.root), after: contractsAt(head, value.root),
      beforeVersions: versionsAt(value.base, value.root), afterVersions: versionsAt(head, value.root) });
    assert.deepEqual(result.errors, []);
  }
  const calls = [];
  const context = await resolveMergeGroupContext(value);
  const result = await runMergeGroupGates({ ...value, context, client: claims(value), execute: execution(calls) });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /PR #12 combined contribution contracts:.*duplicate contract id 1/);
  assert.equal(result.results.filter(check => check.name.endsWith('source contracts') && check.passed).length, 2);
  assert.equal(calls.length, 0);
  assert.equal(result.context.head, value.head);
});

test('compatible combined tree runs serial integration commands on its exact checkout without tokens', async t => {
  const value = compatible(mergeGroupFixture(t));
  const calls = [];
  const context = await resolveMergeGroupContext(value);
  const result = await runMergeGroupGates({ ...value, context, client: claims(value), execute: execution(calls) });
  assert.equal(result.passed, true, result.errors.join('\n'));
  assert.deepEqual(calls.map(call => call.args[0]), [
    'scripts/planning/dag.js', 'scripts/planning/check-test-manifests.js', 'scripts/planning/contract-gate.js',
  ]);
  for (const call of calls) {
    assert.equal(call.options.cwd, value.root);
    for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'PROJECT_READ_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) {
      assert.equal(Object.hasOwn(call.options.env, name), false);
    }
  }
  assert.equal(result.results.filter(check => check.name.endsWith('ownership') && check.passed).length, 4);
});

test('one PR contract-change label cannot authorize another constituent breaking change', async t => {
  const value = compatible(mergeGroupFixture(t), { breaking: true });
  value.requests[0].labels = [{ name: 'contract-change' }];
  let context = await resolveMergeGroupContext(value);
  let result = await runMergeGroupGates({ ...value, context, client: claims(value), execute: execution([]) });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /PR #12 source contracts:.*requires contract-change label/);
  assert.match(result.errors.join('\n'), /PR #12 combined contribution contracts:.*requires contract-change label/);
  value.requests[1].labels = [{ name: 'contract-change' }];
  context = await resolveMergeGroupContext(value);
  result = await runMergeGroupGates({ ...value, context, client: claims(value), execute: execution([]) });
  assert.equal(result.passed, true, result.errors.join('\n'));
});

test('constituent ownership never pools another PR locks and covers merge-only edits', async t => {
  for (const options of [{ privateSource: true }, { privateMerge: true }]) {
    const value = compatible(mergeGroupFixture(t), options);
    const context = await resolveMergeGroupContext(value);
    const calls = [];
    const result = await runMergeGroupGates({ ...value, context, client: claims(value, { leftLocks: ['private'] }), execute: execution(calls) });
    assert.equal(result.passed, false);
    assert.match(result.errors.join('\n'), /PR #12 combined contribution ownership:.*packages\/private.js: outside A29 ownership/);
    if (options.privateMerge) assert.equal(result.results.find(check => check.name === 'PR #12 source ownership').passed, true);
    assert.equal(calls.length, 0);
  }
});

test('missing Project access and command failures remain failures with pinned context', async t => {
  const value = compatible(mergeGroupFixture(t));
  const context = await resolveMergeGroupContext(value);
  let result = await runMergeGroupGates({ ...value, context,
    client: { ...claims(value), graphql: async () => { throw new Error('Project access denied'); } }, execute: execution([]) });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /Project access denied/);
  assert.equal(result.context.head, value.head);
  result = await runMergeGroupGates({ ...value, context, client: claims(value),
    execute: execution([], args => ({ status: args[0].endsWith('contract-gate.js') ? 1 : 0, stdout: '', stderr: 'integration failed' })) });
  assert.equal(result.passed, false);
  assert.match(result.errors.join('\n'), /combined contract integration: integration failed/);
});

test('manual queue workflow binds harness, all serial area jobs and artifacts to explicit group context', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/merge-queue.yml', import.meta.url), 'utf8');
  for (const input of ['head_sha', 'base_sha', 'head_ref', 'base_ref']) assert.match(workflow, new RegExp(`      ${input}:`));
  assert.match(workflow, /path: planning-tools/);
  assert.match(workflow, /path: qualified-group/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /merge-group-context.js --root qualified-group/);
  assert.match(workflow, /merge-group-gates.js\n\s+--root qualified-group --context/);
  assert.match(workflow, /ref: \$\{\{ needs.matrix.outputs.head_sha \}\}/);
  assert.match(workflow, /head_sha: \$\{\{ steps.context.outputs.head_sha \}\}/);
  assert.match(workflow, /max-parallel: 1/);
  assert.match(workflow, /merge-group-gates.json/);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /pull_request_target|: write|^  merge_group:/m);
  assert.equal((workflow.match(/PROJECT_READ_TOKEN:/g) ?? []).length, 1);
  assert.match(workflow, /id: plan\n        env:\n          GH_TOKEN: \$\{\{ github.token \}\}\n          PROJECT_READ_TOKEN: \$\{\{ secrets.PLANNING_PROJECT_READ_TOKEN \}\}/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf('  areas:')), /PROJECT_READ_TOKEN|secrets\./);
});


test('trusted queue planning rejects absent Project or repository credentials before transport', () => {
  for (const environment of [{}, { GH_TOKEN: 'repository' }, { PROJECT_READ_TOKEN: 'project' }]) {
    assert.throws(() => mergeGroupClient(environment, { spawnProcess: () => assert.fail('No transport without credentials') }), /requires GH_TOKEN and read-only PROJECT_READ_TOKEN/);
  }
});

test('trusted queue planning isolates read-only Project GraphQL from repository API credentials', async () => {
  const calls = [];
  const client = mergeGroupClient({ GITHUB_REPOSITORY: 'fixture/repository', GH_TOKEN: 'repository',
    PROJECT_READ_TOKEN: 'project', GITHUB_TOKEN: 'other-repository', GH_ENTERPRISE_TOKEN: 'enterprise', PATH: 'fixture-path' },
  { spawnProcess: (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: () => queueMicrotask(() => {
      child.stdout.emit('data', 'HTTP/2 200 OK\r\n\r\n{"data":{"fixture":true}}');
      child.emit('close', 0);
    }) };
    return child;
  } });
  assert.deepEqual(await client.graphql('query Fixture { viewer { login } }'), { fixture: true });
  await client.api('GET', 'git/ref/heads/agent/SF-A29-T14');
  assert.deepEqual(calls.map(call => call.options.env.GH_TOKEN), ['project', 'repository']);
  for (const call of calls) {
    assert.equal(call.options.env.PATH, 'fixture-path');
    for (const name of ['PROJECT_READ_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN']) assert.equal(Object.hasOwn(call.options.env, name), false);
  }
  await assert.rejects(client.graphql('mutation Bad { deleteProjectV2(input: {}) { clientMutationId } }'), /read-only/);
  assert.throws(() => client.api('POST', 'issues/1/comments', { body: 'must not be sent' }), /read-only/);
  assert.equal(calls.length, 2);
});
