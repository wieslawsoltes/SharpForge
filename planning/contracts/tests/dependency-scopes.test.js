import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validateDag } from '../../../scripts/planning/validate-dag.js';
import { readiness, requireReady } from '../../../scripts/planning/ready.js';
import { exportDag } from '../../../scripts/planning/dag-export.js';
import { syncReady } from '../../../scripts/planning/sync-ready.js';
import { rollup } from '../../../scripts/planning/rollup.js';
import { Claims, claimRef } from '../../../scripts/planning/lib/claims.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';

const child = 'SF-R015-T03', parent = 'SF-A26-T06', rust = 'SF-A27-T08';
const own = 'SF-A26-T01', shared = 'SF-A00-T03', grandparent = 'SF-A26-E01';
const sibling = 'SF-R016-T03', commit = 'a'.repeat(40);
const at = '2026-10-04T09:00:00.000Z', now = () => new Date(at);
const policy = { version: 1, exceptions: [{ child, parent, dependency: rust, sourceIssue: 425, reason: 'Issue #425 ships the JS/SIMD subset while retaining the broader Rust parent.' }] };
const row = (number, id, options = {}) => ({
  number, id, title: `[${id}] Fixture`, area: id.match(/^SF-(A\d{2})-/)?.[1] ?? 'A26',
  kind: /-E\d/.test(id) ? 'Epic' : 'Task', state: 'OPEN', parent: null,
  dependencies: [], contracts: [], pullRequests: [], ...options,
});
const closed = (number, id, options = {}) => row(number, id, {
  state: 'CLOSED', pullRequests: [{ number, merged: true, mergeCommit: commit, baseRefName: 'main' }], ...options,
});
// Deliberately synthetic state/evidence. The real release prerequisites remain open.
function fixture() {
  return { version: 1, repository: 'fixture/SharpForge', defaultBranch: 'main', updatedAt: at, issues: [
    row(425, child, { parent, dependencies: [own] }),
    row(418, parent, { parent: grandparent, dependencies: [shared, rust] }),
    row(357, grandparent),
    closed(359, own, { parent: grandparent }),
    closed(6, shared, { parent: 'SF-A00-E01' }),
    row(2, 'SF-A00-E01'),
    row(378, rust, { dependencies: ['SF-A27-T01'] }),
    row(372, 'SF-A27-T01'),
    row(625, sibling, { parent }),
  ] };
}
const get = (snapshot, id) => snapshot.issues.find(task => task.id === id);
const validContract = () => ({ version: 1, qualified: true, commit, fileExistsOnMain: true, commitOnMain: true });
function assertRustRequired(snapshot, id) {
  const result = readiness(snapshot, id);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(blocker => blocker.startsWith(`${rust}:`)), result.blockers.join('\n'));
}

test('the exact release boundary changes effective edges without changing parent or sibling requirements', () => {
  const snapshot = fixture(), before = structuredClone(snapshot);
  const result = validateDag(snapshot);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.edges[child], [shared, own]);
  assert.deepEqual(result.edges[parent], [shared, rust]);
  assert.deepEqual(result.edges[sibling], [shared, rust]);
  assert.deepEqual(result.edges, validateDag(snapshot, { policy }).edges);
  assert.equal(readiness(snapshot, child).ready, true);
  assertRustRequired(snapshot, sibling);
  assertRustRequired(snapshot, parent);
  assert.deepEqual(snapshot, before);
});

test('the repository policy matches captured release metadata without asserting actual readiness', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../backlog.snapshot.json', import.meta.url), 'utf8'));
  const scoped = validateDag(snapshot);
  const unscoped = validateDag(snapshot, { policy: { version: 1, exceptions: [] } });
  assert.deepEqual(scoped.errors.filter(error => /dependency scope/i.test(error)), []);
  assert.deepEqual(scoped.edges[child], unscoped.edges[child].filter(dependency => dependency !== rust));
  assert.ok(!scoped.edges[child].includes(rust));
  assert.ok(scoped.edges[parent].includes(rust));
});

test('descendants retain the scoped boundary and their own prerequisites', () => {
  const snapshot = fixture(), descendant = `${child}.1`, leaf = `${child}.2`;
  snapshot.issues.push(row(1500, descendant, { parent: child }), row(1501, leaf, { parent: descendant, dependencies: ['SF-A26-T02'] }), closed(360, 'SF-A26-T02'));
  const graph = validateDag(snapshot);
  assert.deepEqual(graph.errors, []);
  assert.deepEqual(graph.edges[descendant], [shared, own]);
  assert.deepEqual(graph.edges[leaf], [shared, own, 'SF-A26-T02']);
  assert.equal(readiness(snapshot, leaf).ready, true);
  assert.ok(readiness(snapshot, child).blockers.some(blocker => blocker.includes('not a leaf')));
  get(snapshot, 'SF-A26-T02').state = 'OPEN';
  const blocked = readiness(snapshot, leaf);
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.some(blocker => blocker.startsWith('SF-A26-T02:')));
  assert.ok(blocked.blockers.every(blocker => !blocker.startsWith(`${rust}:`)));
});

test('direct and other-ancestor declarations of the excluded target remain required', () => {
  for (const origin of ['child', 'descendant', 'other ancestor']) {
    const snapshot = fixture(), leaf = `${child}.1`;
    snapshot.issues.push(row(1500, leaf, { parent: child }));
    const declaringTask = origin === 'child' ? child : origin === 'descendant' ? leaf : grandparent;
    get(snapshot, declaringTask).dependencies.push(rust);
    const graph = validateDag(snapshot);
    assert.deepEqual(graph.errors, [], origin);
    assert.ok(graph.edges[leaf].includes(rust), origin);
    assertRustRequired(snapshot, leaf);
  }
});

test('an independent transitive route still requires Rust and its own prerequisites', () => {
  const snapshot = fixture();
  get(snapshot, own).dependencies.push(rust);
  const graph = validateDag(snapshot);
  assert.deepEqual(graph.errors, []);
  assert.ok(!graph.edges[child].includes(rust));
  assert.ok(graph.edges[own].includes(rust));
  assertRustRequired(snapshot, child);
  get(snapshot, rust).state = 'CLOSED';
  get(snapshot, rust).pullRequests = [{ number: 900, merged: true, mergeCommit: commit, baseRefName: 'main' }];
  const result = readiness(snapshot, child);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(blocker => blocker.startsWith('SF-A27-T01:')));
});

test('own and retained inherited prerequisites still need closed issues and merged main evidence', () => {
  const invalidEvidence = [
    task => { task.state = 'OPEN'; },
    task => { task.pullRequests = []; },
    task => { task.pullRequests[0].merged = false; },
    task => { task.pullRequests[0].baseRefName = 'feature'; },
    task => { task.pullRequests[0].mergeCommit = 'missing'; },
  ];
  for (const id of [own, shared]) for (const invalidate of invalidEvidence) {
    const snapshot = fixture();
    invalidate(get(snapshot, id));
    const result = readiness(snapshot, child);
    assert.equal(result.ready, false);
    assert.ok(result.blockers.some(blocker => blocker.startsWith(`${id}:`)));
  }
  assert.equal(requireReady(fixture(), child, { now: now() }).ready, true);
  assert.throws(() => requireReady(fixture(), child, { now: new Date('2026-10-06T09:00:00Z') }), /stale/);
});

test('all contracts on the release, its ancestors and retained dependency ancestry remain mandatory', () => {
  for (const id of [child, parent, grandparent, own, 'SF-A00-E01']) {
    const snapshot = fixture();
    get(snapshot, id).contracts = [{ name: 'abi', version: '1' }];
    const absent = readiness(snapshot, child);
    assert.equal(absent.ready, false, id);
    assert.ok(absent.blockers.includes('abi@1: not qualified at a recorded commit'), id);
    assert.equal(readiness(snapshot, child, { abi: validContract() }).ready, true, id);
    for (const change of [{ version: 2 }, { qualified: false }, { commit: 'invalid' }, { fileExistsOnMain: false }, { commitOnMain: false }]) {
      assert.equal(readiness(snapshot, child, { abi: { ...validContract(), ...change } }).ready, false, `${id}: ${JSON.stringify(change)}`);
    }
  }
});

test('malformed and duplicate scope policies fail without partially applying valid exclusions', () => {
  const entry = policy.exceptions[0];
  const malformed = [null, [], {}, { version: 2, exceptions: [] }, { version: 1, exceptions: {} },
    { ...policy, unknown: true },
    ...[null, [], { ...entry, child: '*' }, { ...entry, parent: 'SF-A26-T06_suffix' },
      { ...entry, dependency: 'SF-A27-T08/1' }, { ...entry, sourceIssue: 0 }, { ...entry, sourceIssue: '425' },
      { ...entry, reason: '' }, { ...entry, reason: '  ' }, { ...entry, unknown: true },
    ].map(invalid => ({ version: 1, exceptions: [entry, invalid] })),
    { version: 1, exceptions: [entry, { ...entry }] },
  ];
  for (const candidate of malformed) {
    const result = validateDag(fixture(), { policy: candidate });
    assert.ok(result.errors.some(error => /dependency scope/i.test(error)), JSON.stringify(candidate));
    assert.ok(result.edges[child].includes(rust), JSON.stringify(candidate));
  }
  const noExceptions = validateDag(fixture(), { policy: { version: 1, exceptions: [] } });
  assert.deepEqual(noExceptions.errors, []);
  assert.ok(noExceptions.edges[child].includes(rust));
});

test('absent policy children leave subsets valid while present stale identities or edges fail closed', () => {
  const absent = fixture();
  absent.issues = absent.issues.filter(task => task.id !== child);
  assert.deepEqual(validateDag(absent).errors, []);
  assert.ok(validateDag(absent).edges[sibling].includes(rust));
  for (const invalidate of [
    snapshot => { get(snapshot, child).number = 426; },
    snapshot => { get(snapshot, child).parent = grandparent; },
    snapshot => { get(snapshot, parent).dependencies = [shared]; },
    snapshot => { snapshot.issues = snapshot.issues.filter(task => task.id !== parent); },
    snapshot => { snapshot.issues = snapshot.issues.filter(task => task.id !== rust); },
  ]) {
    const snapshot = fixture(); invalidate(snapshot);
    assert.ok(validateDag(snapshot).errors.some(error => /Dependency scope/.test(error)));
    assert.equal(readiness(snapshot, child).ready, false);
    assert.throws(() => requireReady(snapshot, child, { now: now() }), /blocked/);
  }
  const staleEdge = { version: 1, exceptions: [{ ...policy.exceptions[0], dependency: 'SF-A27-T01' }] };
  assert.ok(validateDag(fixture(), { policy: staleEdge }).errors.some(error => /stale inherited dependency/.test(error)));
  const malformedAbsent = { version: 1, exceptions: [{ ...policy.exceptions[0], reason: '' }] };
  assert.ok(validateDag(absent, { policy: malformedAbsent }).errors.length > 0);
});

test('scopes do not conceal unresolved raw references, parent cycles or required dependency cycles', () => {
  const missing = fixture();
  missing.issues = missing.issues.filter(task => task.id !== rust);
  assert.ok(validateDag(missing).errors.some(error => error.includes(`unresolved dependency ${rust}`)));
  const parentCycle = fixture();
  get(parentCycle, grandparent).parent = child;
  assert.ok(validateDag(parentCycle).errors.some(error => /Parent cycle/.test(error)));
  const dependencyCycle = fixture();
  get(dependencyCycle, own).dependencies.push(child);
  assert.ok(validateDag(dependencyCycle).errors.some(error => /Cycle:/.test(error)));
  assert.equal(readiness(dependencyCycle, child).ready, false);
});

test('DAG exports use effective edges while rollups preserve the full organizational ancestry', () => {
  const snapshot = fixture();
  const diagram = exportDag(snapshot, 'A26');
  assert.ok(diagram.mermaid.includes('SF_A27_T08 --> SF_R016_T03'));
  assert.ok(!diagram.mermaid.includes('SF_A27_T08 --> SF_R015_T03'));
  assert.ok(diagram.mermaid.includes('SF_A26_T01 --> SF_R015_T03'));
  assert.deepEqual(exportDag(snapshot, 'A26'), diagram);
  const result = rollup({ snapshot, evidence: [], revisions: { revisions: [{ id: 'fixture-v1' }] },
    inventory: { schemaVersion: 1, rows: [{ id: 'fixture.scope', leafId: child, area: 'A26', platforms: ['fixture'], engines: ['fixture'], specRevisions: ['fixture-v1'] }] },
  });
  assert.deepEqual(result.groups.map(group => group.id).sort(), ['A26', grandparent, parent, child].sort());
  assert.ok(result.groups.every(group => group.unknown === 1 && group.pass === 0 && !group.complete));
  assert.equal(get(snapshot, child).parent, parent);
  assert.ok(get(snapshot, parent).dependencies.includes(rust));
});

test('ready-label sync shares scope decisions and stale policy matches prevent all writes', async () => {
  const snapshot = fixture(), labels = new Map(snapshot.issues.map(task => [task.number, task.id === sibling ? ['status:ready'] : []]));
  const writes = [], reads = [];
  const client = {
    pages: async path => { reads.push(path); return labels.get(Number(path.split('/')[1])); },
    label: async (number, label) => { writes.push(['add', number]); labels.get(number).push(label); },
    removeLabel: async (number, label) => { writes.push(['remove', number]); labels.set(number, labels.get(number).filter(value => value !== label)); },
  };
  await syncReady(client, snapshot);
  assert.ok(writes.some(([op, number]) => op === 'add' && number === 425));
  assert.ok(writes.some(([op, number]) => op === 'remove' && number === 625));
  assert.deepEqual((await syncReady(client, snapshot)).changes, []);
  writes.length = 0; reads.length = 0;
  get(snapshot, child).number = 426;
  await assert.rejects(syncReady(client, snapshot), /Invalid backlog; labels unchanged/);
  assert.deepEqual(writes, []);
  assert.deepEqual(reads, []);
});

test('the claim readiness hook preserves mandatory blockers before creating simulated ownership', async () => {
  const snapshot = fixture(), fake = new FakeGitHub();
  Object.assign(fake.issues[0].content, { number: 425, title: `[${child}] Fixture` });
  const client = new GitHubProject({ owner: 'test', transport: fake.transport });
  const claims = new Claims(client, { now });
  const options = { issue: 425, agent: 'codex-fixture', branch: 'codex/fixture', ready: item => requireReady(snapshot, item.content.title.match(/^\[([^\]]+)\]/)[1], { now: now() }) };
  get(snapshot, parent).contracts = [{ name: 'abi', version: '1' }];
  await assert.rejects(claims.claim(options), /abi@1/);
  assert.equal(fake.refs.size, 0);
  assert.equal(fake.objects.size, 0);
  assert.deepEqual(fake.issues[0].fields, { Status: 'Ready' });
  get(snapshot, parent).contracts = [];
  get(snapshot, own).state = 'OPEN';
  await assert.rejects(claims.claim(options), /SF-A26-T01/);
  assert.equal(fake.refs.size, 0);
  get(snapshot, own).state = 'CLOSED';
  const record = await claims.claim(options);
  assert.equal(record.task, child);
  assert.ok(fake.refs.has(`refs/heads/${claimRef(child)}`));
  assert.equal(fake.issues[0].fields.Status, 'Claimed');
});

test('readiness command aliases load the same repository policy for snapshot input', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sf-dependency-scope-'));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    const path = join(directory, 'snapshot.json');
    writeFileSync(path, JSON.stringify(fixture()));
    for (const script of ['ready.js', 'readiness.js']) {
      for (const [task, expected] of [[child, true], [sibling, false]]) {
        const result = spawnSync(process.execPath, [join(root, 'scripts/planning', script), '--snapshot', path, '--task', task], { cwd: directory, encoding: 'utf8' });
        assert.equal(result.status, expected ? 0 : 1, result.stderr || result.stdout);
        assert.equal(JSON.parse(result.stdout).ready, expected, script);
      }
    }
    const result = spawnSync(process.execPath, [join(root, 'scripts/planning/dag.js'), '--snapshot', path], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).edges[child], [shared, own]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
