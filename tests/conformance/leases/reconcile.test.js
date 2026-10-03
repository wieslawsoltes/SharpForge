import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { Claims } from '../../../scripts/planning/lib/claims.js';
import { boundedClient, reconcile, scheduledClient } from '../../../scripts/conformance/leases/reconcile.js';

test('expired lease is labelled in one invocation without reassigning or posting comments', async () => {
  const fake = new FakeGitHub();
  const client = new GitHubProject({ owner: 'test', transport: fake.transport });
  const claims = new Claims(client, { now: () => new Date('2026-10-01T00:00:00Z') });
  await claims.claim({ issue: 1, agent: 'codex-fixture', branch: 'codex/fixture', ttlHours: 1 });
  const before = structuredClone(fake.issues[0]);
  const ref = fake.refs.get('refs/heads/agent/SF-A00-T07.1');
  const snapshot = { issues: [{ id: 'SF-A00-T01', number: 1, state: 'OPEN', parent: null, dependencies: [], contracts: [], pullRequests: [] }] };
  const report = await reconcile({ client, snapshot, now: () => new Date('2026-10-02T00:00:00Z') });
  assert.equal(report.expired.length, 1);
  assert(fake.issues[0].labels.includes('lease:expired'));
  assert.equal(fake.refs.get('refs/heads/agent/SF-A00-T07.1'), ref);
  assert.equal(fake.issues[0].comments.length, before.comments.length);
  assert.deepEqual(fake.issues[0].fields, before.fields);
  assert(![...fake.refs.keys()].some(name => name.includes('agent-ops/')));
});
test('readiness duplicate errors survive expiry reconciliation', async () => {
  const fake = new FakeGitHub();
  const client = new GitHubProject({ owner: 'test', transport: fake.transport });
  const issue = { id: 'SF-A00-T01', number: 1, parent: null, dependencies: [] };
  const report = await reconcile({ client, snapshot: { issues: [issue, issue] } });
  assert.equal(report.passed, false);
  assert.match(report.errors.join(), /Duplicate work ID/);
});
test('scheduler capability rejects ownership/ref mutation and absent credentials', async () => {
  const client = boundedClient({});
  await assert.rejects(client.createRef('main', 'a'.repeat(40)), /mutex/);
  await assert.rejects(client.setFields({}, {}), /Project fields/);
  await assert.rejects(client.writeRecord({}), /replace claims/);
  assert.throws(() => scheduledClient({}), /explicitly configured/);
  assert.throws(() => scheduledClient({ GH_TOKEN: 'fixture', PROJECT_READ_TOKEN: 'fixture', GITHUB_EVENT_NAME: 'pull_request' }), /default-branch/);
});
