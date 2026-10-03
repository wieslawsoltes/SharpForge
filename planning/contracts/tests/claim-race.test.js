import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeGitHub } from '../../../scripts/planning/testing/fake-github.js';
import { GitHubProject } from '../../../scripts/planning/lib/github-project.js';
import { Claims, claimRef, lockRef, auditRecord } from '../../../scripts/planning/lib/claims.js';
import { withRetry, GitHubError } from '../../../scripts/planning/lib/gh-retry.js';
import { reconstructAudit } from '../../../scripts/planning/audit.js';
const options = { issue: 1, agent: 'codex-alpha', branch: 'codex/fixture', ttlHours: 24 };
function setup(config = {}) {
  const fake = new FakeGitHub(config), client = new GitHubProject({ owner: 'test', transport: fake.transport });
  let time = Date.parse('2026-10-03T12:00:00Z');
  return { fake, client, claims: new Claims(client, { now: () => new Date(time) }), advance: ms => { time += ms; } };
}
test('50 seeded concurrent claim races have exactly one owner and no loser field writes', async () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { fake, claims, client } = setup({ seed, latency: true });
    const other = new Claims(client);
    const results = await Promise.allSettled([claims.claim(options), other.claim({ ...options, agent: 'codex-beta' })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, `seed ${seed}`);
    const winner = results.find(r => r.status === 'fulfilled').value.agent;
    assert.equal(fake.issues[0].fields.Agent, winner);
    assert.deepEqual(fake.requests.filter(r => r.path === 'graphql' && /mutation Set/.test(r.body.query) && r.body.variables.field === 'field-0').map(r => r.body.variables.value.text), [winner]);
    assert.equal(fake.issues[0].comments.length, 1);
  }
});
test('project pagination reads/writes items beyond 100 and clears all lease fields', async () => {
  const { fake, claims, client } = setup({ count: 151 });
  assert.equal((await client.items()).length, 151);
  const opts = { ...options, issue: 151 }; await claims.claim(opts);
  assert.equal(fake.issues[150].fields.Branch, options.branch);
  assert.equal(fake.issues[150].fields['Lease expires'], '2026-10-04');
  await claims.release(opts);
  assert.deepEqual(fake.issues[150].fields, { Status: 'Ready' });
  await claims.claim(opts);
});
test('unknown project fields, choices and invalid lease inputs fail without acquiring ownership', async () => {
  const { client, fake, claims } = setup();
  const item = await client.item(1);
  await assert.rejects(client.setFields(item, { Unknown: 'a' }), /Missing/);
  await assert.rejects(client.setFields(item, { Status: 'bogus' }), /Unknown option/);
  for (const ttlHours of [0, -1, 169, NaN]) await assert.rejects(claims.claim({ ...options, ttlHours }), /TTL/);
  await assert.rejects(claims.claim({ ...options, agent: 'bad identity' }), /Agent/);
  await assert.rejects(claims.claim({ ...options, branch: 'agent/lock' }), /reserved/);
  assert.equal(fake.refs.size, 0);
});
test('parents, closed tasks, and tasks not Ready cannot be claimed', async () => {
  const { fake, claims } = setup();
  fake.issues[0].children = [{ number: 2 }]; await assert.rejects(claims.claim(options), /sub-issues/);
  fake.issues[0].children = []; fake.issues[0].content.state = 'CLOSED'; await assert.rejects(claims.claim(options), /closed/);
  fake.issues[0].content.state = 'OPEN'; fake.issues[0].fields.Status = 'Backlog'; await assert.rejects(claims.claim(options), /Ready/);
  fake.issues[0].fields.Status = 'Ready'; await assert.rejects(claims.claim({ ...options, ready: async () => { throw new Error('unmerged dependency'); } }), /dependency/);
  assert.equal(fake.refs.size, 0);
});
test('owner-only heartbeat extends exact expiry; comments are throttled per hour', async () => {
  const { fake, claims, advance } = setup(); await claims.claim(options);
  await assert.rejects(claims.heartbeat({ ...options, agent: 'codex-beta' }), /belongs/);
  advance(3600000); await claims.heartbeat(options);
  assert.equal((await claims.state(1)).record.expires, '2026-10-04T13:00:00.000Z');
  await claims.heartbeat(options); assert.equal(fake.issues[0].comments.filter(c => auditRecord(c)?.event === 'heartbeat').length, 1);
  advance(3600000); await claims.heartbeat(options); assert.equal(fake.issues[0].comments.filter(c => auditRecord(c)?.event === 'heartbeat').length, 2);
});
test('shared lock races name holder, release frees locks and branch remains untouched', async () => {
  const { claims, fake, client } = setup({ count: 2, latency: true });
  await claims.claim(options); await claims.claim({ ...options, issue: 2, agent: 'codex-beta' });
  const results = await Promise.allSettled([claims.lock({ ...options, key: 'studio' }), claims.lock({ issue: 2, agent: 'codex-beta', key: 'studio' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /belongs to SF-A00-T07/);
  const held = await client.readRecord((await client.ref(lockRef('studio'))).object.sha);
  await claims.release({ issue: held.issue, agent: held.agent, handoff: 'https://example.test/handoff' });
  assert.equal(await client.ref(lockRef('studio')), null);
  assert.equal(fake.issues[held.issue - 1].fields.Branch, options.branch);
});
test('expired lease remains owned; reaper is idempotent; reconciler must provide audit reason', async () => {
  const { claims, fake, advance } = setup(); await claims.claim(options); await claims.lock({ ...options, key: 'studio' });
  advance(25 * 3600000); await assert.rejects(claims.heartbeat(options), /expired/);
  const reaped = await claims.reap(); assert.deepEqual(reaped[0].locks, ['studio']); assert.equal(reaped[0].head, null);
  assert.equal(fake.issues[0].fields.Agent, options.agent); assert.ok(fake.issues[0].labels.includes('lease:expired'));
  await claims.reap(); assert.equal(fake.issues[0].comments.filter(c => c.body.startsWith('<!-- sharpforge-expired')).length, 1);
  await assert.rejects(claims.claim({ ...options, agent: 'codex-beta' }), /already owned/);
  await assert.rejects(claims.release({ ...options, agent: 'codex-beta' }), /reconcile/);
  await assert.rejects(claims.release({ ...options, agent: 'codex-beta', reconcile: true }), /reason/);
  await claims.release({ ...options, agent: 'codex-beta', reconcile: true, reason: 'Abandoned agent session verified stopped' });
  assert.equal(fake.refs.size, 0); await claims.claim({ ...options, agent: 'codex-beta' });
});
test('partial project update keeps claim reserved and explicit release recovers', async () => {
  const { claims, fake, client } = setup();
  fake.failures.push({ remaining: 1, status: 403, message: 'injected outage', match: r => r.path === 'graphql' && /mutation Set/.test(r.body.query) });
  await assert.rejects(claims.claim(options), /outage/);
  assert.ok(await client.ref(claimRef('SF-A00-T07.1')));
  await assert.rejects(claims.claim({ ...options, agent: 'codex-beta' }), /already owned/);
  await claims.release(options); assert.equal(fake.refs.size, 0);
});
test('failed lock field update is recovered by scanning lock refs on release', async () => {
  const { claims, fake } = setup(); await claims.claim(options);
  fake.failures.push({ remaining: 1, status: 403, message: 'injected outage', match: r => r.path === 'graphql' && /mutation Set/.test(r.body.query) && r.body.variables.field === 'field-3' });
  await assert.rejects(claims.lock({ ...options, key: 'studio' }), /outage/);
  await claims.release(options); assert.equal(fake.refs.size, 0);
});
test('secondary rate limit retry is bounded and hard failures preserve distinct exit code', async () => {
  let calls = 0; const waits = [];
  const result = await withRetry(async () => { if (++calls < 3) throw new GitHubError('secondary rate limit', { status: 403 }); return 'ok'; }, { wait: async ms => waits.push(ms), random: () => 0 });
  assert.equal(result, 'ok'); assert.deepEqual(waits, [500, 1000]);
  await assert.rejects(withRetry(async () => { throw new GitHubError('Bad credentials', { status: 401 }); }), e => e.exitCode === 1);
  await assert.rejects(withRetry(async () => { throw new GitHubError('secondary rate limit', { status: 403 }); }, { attempts: 2, wait: async () => {} }), e => e.exitCode === 75);
  await assert.rejects(withRetry(async () => { throw new GitHubError('secondary rate limit', { status: 403, headers: { 'retry-after': '300' } }); }, { wait: async () => { throw new Error('should defer'); } }), e => e.exitCode === 75);
});
test('audit reconstructs complete claim-heartbeat-lock-unlock-release and flags missing claim', async () => {
  const { claims, fake } = setup(); await claims.claim(options); await claims.heartbeat(options);
  await claims.lock({ ...options, key: 'studio' }); await claims.lock({ ...options, key: 'studio', release: true }); await claims.release(options);
  const audit = reconstructAudit(fake.issues[0].comments); assert.equal(audit.complete, true); assert.equal(audit.owner, null); assert.deepEqual(audit.locks, []);
  assert.equal(reconstructAudit(fake.issues[0].comments.slice(1)).complete, false);
});
test('fake REST/GraphQL transport also exposes an actual HTTP server', async () => {
  const { fake } = setup(); const server = await fake.listen();
  try { const response = await fetch(`${server.url}/repos/test/SharpForge/issues/1/comments`); assert.deepEqual(await response.json(), []); } finally { await server.close(); }
});

test('GraphQL resource limits shrink page size and surface permanent node overflow', async () => {
  const pages = [];
  const client = new GitHubProject({ owner: 'test', transport: async request => {
    const size = Number(request.body.query.match(/items\(first:(\d+)/)?.[1]); pages.push(size);
    return size > 12 ? { errors: [{ message: 'Resource limits for this query exceeded.' }] } : { data: { accepted: size } };
  } });
  assert.deepEqual(await client.graphql('query { items(first:50) { id } }'), { accepted: 12 });
  assert.deepEqual(pages, [50, 25, 12]);
  const bad = new GitHubProject({ owner: 'test', transport: async () => ({ errors: [{ message: 'MAX_NODE_LIMIT' }] }) });
  await assert.rejects(bad.graphql('query { items(first:1) { id } }'), e => e.exitCode === 65);
});
