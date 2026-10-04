import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { claimProjectItems, groupClaimedIdentity, projectClaimedIdentity } from '../../../scripts/conformance/ci-planning/merge-group-projects.js';
import { reviewOwnership } from '../../../scripts/conformance/ci-planning/gates.js';

const snapshot = JSON.parse(readFileSync(new URL('../../../planning/backlog.snapshot.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-10-04T09:00:00Z');
function captured(number) {
  const issue = snapshot.issues.find(row => row.number === number);
  assert.ok(issue, `Missing captured issue #${number}`);
  return issue;
}
function fixture({ id = 'SF-R015-T03', number = 425, body = 'Area: **A26**. Parent: #418.' } = {}) {
  const branch = `codex/${id}`, repository = 'fixture/repository';
  const claim = { task: id, issue: number, branch, agent: 'codex-fixture', expires: '2026-10-05T09:00:00Z', generation: 'generation', locks: [] };
  const pr = { head: { ref: branch }, body: `Task: ${id}` };
  const item = { id: 'item-4', isArchived: false,
    project: { id: 'project-4', number: 4, owner: { login: 'fixture' } },
    workId: { text: id }, branch: { text: branch }, agent: { text: claim.agent } };
  const issue = { number, title: `[${id}] Fixture`, body, repository: { nameWithOwner: repository },
    projectItems: { nodes: [item], pageInfo: { hasNextPage: false, endCursor: null } } };
  const locks = new Map(), calls = [];
  const client = {
    owner: 'fixture', repo: 'repository',
    items: async () => assert.fail('Qualification must use the claimed issue lookup'),
    ref: async name => name === `agent/${id}` || locks.has(name) ? { object: { sha: name } } : null,
    readRecord: async name => structuredClone(name === `agent/${id}` ? claim : locks.get(name)),
    graphql: async (query, variables) => {
      calls.push({ query, variables });
      const result = structuredClone(issue);
      // A fake response must not supply a field the live query never requested.
      if (!/\bbody\b/.test(query)) delete result.body;
      return { repository: { issue: result } };
    },
  };
  return { client, claim, pr, item, issue, locks, calls };
}

test('individual and group qualification resolve all four captured release areas from the live issue', async () => {
  for (const [number, area] of [[423, 'A00'], [424, 'A10'], [425, 'A26'], [426, 'A29']]) {
    for (const resolve of [projectClaimedIdentity, groupClaimedIdentity]) {
      const value = fixture(captured(number));
      const identity = await resolve(value.client, value.pr, now);
      assert.equal(identity.task, value.claim.task);
      assert.equal(identity.area, area);
      assert.equal(identity.issue, number);
      assert.equal(identity.project.number, 4);
      assert.deepEqual(identity.locks, []);
      assert.deepEqual(value.calls[0].variables, { owner: 'fixture', repo: 'repository', issue: number, after: null });
      assert.match(value.calls[0].query, /\bbody\b/);
      assert.doesNotMatch(value.calls[0].query, /projectV2\(number:/);
    }
  }
});

test('the live membership projection retains the exact issue body', async () => {
  const value = fixture(captured(425));
  const items = await claimProjectItems(value.client, value.claim);
  assert.equal(items.length, 1);
  assert.equal(items[0].content.body, captured(425).body);
  assert.equal(items[0].content.number, 425);
  assert.equal(items[0].content.repository.nameWithOwner, 'fixture/repository');
});

test('release Area accepts observed plain, bold and inline metadata syntax', async () => {
  for (const body of [
    'Area: A26\nParent: #418', '**Area:** A26 — Publishing\n**Parent:** #418',
    'Area: **A26**. Parent: #418.', '**Area:** **A26**\r\n**Parent:** #418',
    'Release: [delivery](https://github.com/fixture/repository/issues/422). Area: **A26**. Parent: #418.',
    '**Parent:** #418 · **Area:** A26 · **Priority:** P1',
  ]) {
    const value = fixture({ body });
    assert.equal((await groupClaimedIdentity(value.client, value.pr, now)).area, 'A26', body);
  }
});

test('missing or malformed release Area cannot be supplied by PR metadata or later prose', async () => {
  for (const body of [
    undefined, null, '', 'Area:', 'Area: A2', 'Area: A260', 'Area: A26suffix',
    'Area: A26_1', 'Area: R015', 'Area: see A26', 'Workstream: A26',
    'An example Area: A26', 'Parent: #418\n## Deliverable\nArea: A26',
    'Parent: #418\n## Dependencies\n**Area:** A26',
  ]) {
    const value = fixture();
    value.issue.body = body;
    value.pr.body += '\nArea: A26\n**Area:** A26';
    value.claim.area = 'A26';
    value.item.area = { text: 'A26' };
    await assert.rejects(groupClaimedIdentity(value.client, value.pr, now), /area/i, String(body));
  }
});

test('area-owned task IDs retain priority over contradictory or absent body metadata', async () => {
  for (const body of ['Area: A26', '', undefined]) {
    const value = fixture({ id: 'SF-A00-T01', number: 4 });
    value.issue.body = body;
    assert.equal((await groupClaimedIdentity(value.client, value.pr, now)).area, 'A00');
  }
});

test('release declarations cannot bypass Project owner, branch or issue identity binding', async () => {
  for (const [change, error] of [
    [value => { value.item.agent.text = 'codex-other'; }, /Agent does not match/],
    [value => { value.item.branch.text = 'codex/other'; }, /Branch does not match/],
    [value => { value.item.workId.text = 'SF-R015-T04'; }, /Work ID/],
    [value => { value.issue.number = 426; }, /issue identity/],
    [value => { value.issue.repository.nameWithOwner = 'other/repository'; }, /issue identity/],
    [value => { value.issue.title = '[SF-R015-T04] Another task'; }, /issue identity/],
    [value => { value.item.project.owner.login = 'other'; }, /exactly one project item/],
  ]) {
    const value = fixture(); change(value);
    await assert.rejects(groupClaimedIdentity(value.client, value.pr, now), error);
  }
});

test('release declarations retain authoritative claim and lock-generation checks', async () => {
  const absent = fixture();
  absent.client.ref = async () => null;
  await assert.rejects(groupClaimedIdentity(absent.client, absent.pr, now), /no authoritative claim/);
  for (const expires of ['invalid', '2026-10-04T08:59:59Z', '2026-10-04T09:00:00Z']) {
    const value = fixture(); value.claim.expires = expires;
    await assert.rejects(groupClaimedIdentity(value.client, value.pr, now), /expired/);
  }
  for (const lock of [null, { task: 'SF-R015-T04', generation: 'generation' },
    { task: 'SF-R015-T03', generation: 'different' }]) {
    const value = fixture(); value.claim.locks = ['release-shared'];
    if (lock) value.locks.set('agent-locks/release-shared', lock);
    await assert.rejects(groupClaimedIdentity(value.client, value.pr, now), /Unverified lock release-shared/);
  }
  const mismatch = fixture(); mismatch.claim.task = 'SF-R015-T04';
  await assert.rejects(groupClaimedIdentity(mismatch.client, mismatch.pr, now), /Claim task does not match/);
});

test('real Git changes remain area-scoped and only a verified covering lock allows another area', async t => {
  const root = mkdtempSync(join(tmpdir(), 'sf-release-ownership-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const commit = () => { git(['add', '.']); git(['commit', '-m', 'fixture']); return git(['rev-parse', 'HEAD']); };
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.test']); git(['config', 'commit.gpgsign', 'false']);
  write('planning/contracts/ownership.json', { areas: {
    A26: { write: ['packages/publish/**'], evidence: [] },
    A03: { write: ['packages/compiler/**'], evidence: [] },
  } });
  write('planning/contracts/ownership-exceptions.json', { docsOnly: [], generated: [], areaGenerated: [] });
  write('planning/contracts/locks.json', {});
  const base = commit(), value = fixture(captured(425));
  const identity = await projectClaimedIdentity(value.client, value.pr, now);
  write('packages/publish/fixture.js', 'export const publish = true;\n');
  const owned = commit();
  assert.equal(reviewOwnership({ root, base, mergeBase: base, head: owned, identity }).passed, true);
  write('packages/compiler/fixture.js', 'export const compile = true;\n');
  const crossArea = commit();
  const denied = reviewOwnership({ root, base, mergeBase: base, head: crossArea, identity });
  assert.equal(denied.passed, false);
  assert.match(denied.error, /packages\/compiler\/fixture.js: outside A26 ownership/);
  value.claim.locks = ['release-shared'];
  value.locks.set('agent-locks/release-shared', {
    task: value.claim.task, generation: value.claim.generation, paths: ['packages/compiler/**'],
  });
  const locked = await groupClaimedIdentity(value.client, value.pr, now);
  assert.deepEqual(locked.locks, [{ key: 'release-shared', paths: ['packages/compiler/**'] }]);
  assert.equal(reviewOwnership({ root, base, mergeBase: base, head: crossArea, identity: locked }).passed, true);
  const unknown = fixture({ body: 'Area: A99' });
  const unknownIdentity = await groupClaimedIdentity(unknown.client, unknown.pr, now);
  assert.throws(() => reviewOwnership({ root, base, mergeBase: base, head: owned, identity: unknownIdentity }), /Unknown area: A99/);
});
