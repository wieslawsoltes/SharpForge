import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSnapshot, snapshotBacklog } from '../../../scripts/planning/snapshot-backlog.js';
import { readiness } from '../../../scripts/planning/ready.js';
import { rollup } from '../../../scripts/planning/rollup.js';
import { validate } from '../../../scripts/planning/schema/validate.js';

const updatedAt = '2026-10-03T12:55:45.654Z';
const commit = 'a'.repeat(40), head = 'b'.repeat(40);
const parentId = 'SF-A00-T11', releaseId = 'SF-R015-T01';
const parentUrl = 'https://github.com/wieslawsoltes/SharpForge/issues/14';
const releaseHeader = `Release: [0.15 delivery](https://github.com/wieslawsoltes/SharpForge/issues/422). Area: **A00**. Parent: [${parentId}](${parentUrl}).`;
const issue = (number, id, body = '', extra = {}) => ({ number, title: `[${id}] Fixture`, body, state: 'OPEN', labels: [], ...extra });
const normalize = (issues, extra = {}) => normalizeSnapshot({ issues, repository: 'fixture/SharpForge', defaultBranch: 'main', updatedAt, ...extra });
const find = (snapshot, id) => snapshot.issues.find(row => row.id === id);

test('release snapshots preserve actual inline and legacy parent metadata formats', () => {
  const headers = [
    releaseHeader,
    `**Area:** A00 — Contracts\n**Parent:** [${parentId}](${parentUrl})`,
    `**Area:** **A00**\n**Parent:** **[${parentId}](${parentUrl})**`,
    `Area: A00\nParent: [${parentId}](${parentUrl})`,
    'Area: **A00** · Parent: #14',
    '**Parent:** #14 (SF-A00-T11) · **Workstream:** A00\n**Area:** A00',
    `Area: A00. Parent: ${parentUrl}`,
    `Area: A00. Parent: [Implementation task](${parentUrl})`,
    `Area: A00. Parent: [SF-invalid](${parentUrl})`,
    'Parent: **#14**. Area: **A00**',
  ];
  for (const body of headers) {
    const snapshot = normalize([issue(423, releaseId, body), issue(14, parentId)]);
    assert.equal(find(snapshot, releaseId).area, 'A00', body);
    assert.equal(find(snapshot, releaseId).parent, parentId, body);
  }
});

test('explicit valid parent identity wins over link number and unresolved numbers stay absent', () => {
  const parent = issue(14, parentId), other = issue(99, 'SF-A00-T99');
  const link = '[SF-A00-T11](https://github.com/wieslawsoltes/SharpForge/issues/99)';
  for (const value of [link, `**${link}**`]) {
    const linked = normalize([parent, other, issue(423, releaseId, `Area: A00. Parent: ${value}.`)]);
    assert.equal(find(linked, releaseId).parent, parentId, value);
  }
  const numeric = normalize([parent, issue(423, releaseId, 'Area: A00. Parent: #999.')]);
  assert.equal(find(numeric, releaseId).parent, null);
  const releaseOnly = normalize([parent, issue(422, 'SF-A00-E02'), issue(423, releaseId,
    'Release: [0.15 delivery](https://github.com/wieslawsoltes/SharpForge/issues/422). Area: **A00**.')]);
  assert.equal(find(releaseOnly, releaseId).parent, null);
});

test('release area fallback retains the actual release and does not infer labels or project fields', () => {
  for (const body of ['', 'Area: A0', 'Area: A001', 'Area: A00suffix', 'Area: A00_extra', 'Area: a00']) {
    const raw = issue(500, 'SF-R016-T01', body, { labels: ['area:A00'] });
    const snapshot = normalize([raw], { items: [{ content: { number: 500 }, fields: { Workstream: 'A00 Contracts' } }] });
    assert.equal(snapshot.issues[0].area, 'R016', body);
  }
  for (const body of ['Area: A00', 'Area: **A00**.', '**Area:** A00 — Contracts']) {
    assert.equal(normalize([issue(500, 'SF-R016-T01', body)]).issues[0].area, 'A00', body);
  }
  const areaTask = normalize([issue(14, parentId, 'Area: **A29**.')]);
  assert.equal(areaTask.issues[0].area, 'A00');
});

test('only metadata before the first section supplies release area and parent', () => {
  const parents = [issue(14, parentId), issue(99, 'SF-A00-T99')];
  const later = '\n## Deliverable\nArea: A29. Parent: #99\n';
  const declared = normalize([...parents, issue(423, releaseId, releaseHeader + later)]);
  assert.equal(find(declared, releaseId).area, 'A00');
  assert.equal(find(declared, releaseId).parent, parentId);
  const absent = normalize([...parents, issue(500, 'SF-R016-T01', '# Release fixture\n' + later)]);
  assert.equal(find(absent, 'SF-R016-T01').area, 'R016');
  assert.equal(find(absent, 'SF-R016-T01').parent, null);
  const prose = normalize([...parents, issue(500, 'SF-R016-T01',
    'Document the Area: A29 and Parent: #99 fields.\n## Deliverable\nFixture')]);
  assert.equal(find(prose, 'SF-R016-T01').area, 'R016');
  assert.equal(find(prose, 'SF-R016-T01').parent, null);
});

test('normalization is deterministic and preserves captured project and merged PR evidence', () => {
  const body = releaseHeader + '\n## Dependencies\n- [SF-A00-T01](https://example.test/1)\n';
  const raw = issue(423, releaseId, body, {
    state: 'closed', labels: { nodes: [{ name: 'state:blocked' }, { name: 'area:A00' }] },
    closedByPullRequestsReferences: { nodes: [
      { number: 88, merged: false, mergedAt: null, mergeCommit: null, headRefOid: head, baseRefName: 'main' },
      { number: 77, merged: true, mergedAt: updatedAt, mergeCommit: { oid: commit }, headRefOid: head, baseRefName: 'main' },
    ] },
  });
  const fields = { Agent: 'fixture-owner', Status: 'Backlog', Evidence: 'retained-evidence', 'Parity percent': 0 };
  const issues = [raw, issue(14, parentId), issue(1, 'SF-A00-T01'), issue(151, 'SF-A10-T08', 'Unrelated body', { labels: ['priority:P1'] })];
  const items = [{ content: { number: 423 }, fields }, { content: { number: 151 }, fields: { Status: 'Ready' } }];
  const before = structuredClone({ issues, items });
  const snapshot = normalize(issues, { items });
  assert.deepEqual(snapshot, normalize([...issues].reverse(), { items: [...items].reverse() }));
  assert.deepEqual({ issues, items }, before);
  assert.deepEqual(snapshot.issues.map(row => row.id), ['SF-A00-T01', parentId, 'SF-A10-T08', releaseId]);
  assert.equal(snapshot.updatedAt, updatedAt);
  const row = find(snapshot, releaseId);
  assert.equal(row.body, body);
  assert.equal(row.state, 'CLOSED');
  assert.equal(row.kind, 'Task');
  assert.deepEqual(row.labels, ['area:A00', 'state:blocked']);
  assert.deepEqual(row.project, fields);
  assert.deepEqual(row.dependencies, ['SF-A00-T01']);
  assert.deepEqual(row.contracts, []);
  assert.deepEqual(row.pullRequests, [
    { number: 77, merged: true, mergedAt: updatedAt, mergeCommit: commit, head, baseRefName: 'main' },
    { number: 88, merged: false, mergedAt: null, mergeCommit: null, head, baseRefName: 'main' },
  ]);
  assert.deepEqual(find(snapshot, 'SF-A10-T08'), {
    id: 'SF-A10-T08', number: 151, title: '[SF-A10-T08] Fixture', body: 'Unrelated body', state: 'OPEN', area: 'A10',
    kind: 'Task', parent: null, dependencies: [], contracts: [], labels: ['priority:P1'], project: { Status: 'Ready' }, pullRequests: [],
  });
  const schema = JSON.parse(readFileSync(new URL('../backlog.schema.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validate(schema, snapshot));
});

test('release leaves inherit parent prerequisites and still require merged dependency evidence', () => {
  const prerequisite = issue(1, 'SF-A00-T01');
  const parent = issue(14, parentId, 'Depends on: SF-A00-T01');
  const release = issue(423, releaseId, 'Area: A00. Parent: #14.');
  const blocked = readiness(normalize([prerequisite, parent, release]), releaseId);
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.errors, []);
  assert.match(blocked.blockers.join('\n'), /SF-A00-T01: no closed issue with merged main evidence/);
  prerequisite.state = 'CLOSED';
  assert.equal(readiness(normalize([prerequisite, parent, release]), releaseId).ready, false);
  prerequisite.pullRequests = [{ number: 77, merged: true, mergeCommit: commit, baseRefName: 'main' }];
  const ready = readiness(normalize([prerequisite, parent, release]), releaseId);
  assert.deepEqual(ready, { id: releaseId, ready: true, errors: [], blockers: [] });
});

test('normalized release leaves roll up through their area parents without manufacturing qualification', () => {
  const snapshot = normalize([
    issue(3, 'SF-A00-E02'),
    issue(14, parentId, '**Parent:** #3'),
    issue(423, releaseId, releaseHeader),
  ]);
  const result = rollup({
    snapshot,
    inventory: { schemaVersion: 1, rows: [{ id: 'fixture.release-snapshot', leafId: releaseId, area: 'A00', platforms: ['fixture'], engines: ['fixture'], specRevisions: ['fixture-v1'] }] },
    revisions: { revisions: [{ id: 'fixture-v1' }] }, evidence: [],
    ancestor: () => { throw new Error('No evidence commit was supplied'); },
    verified: () => { throw new Error('No evidence artifact was supplied'); },
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.groups.map(group => group.id).sort(), ['A00', 'SF-A00-E02', parentId, releaseId].sort());
  assert.equal(result.obligations.length, 1);
  assert.equal(result.obligations[0].status, 'unknown');
  assert.deepEqual(result.obligations[0].invalidated, ['no evidence']);
  for (const group of result.groups) {
    assert.equal(group.total, 1);
    assert.equal(group.unknown, 1);
    assert.equal(group.pass, 0);
    assert.equal(group.percent, 0);
    assert.equal(group.complete, false);
    assert.equal(group.scopeComplete, false);
  }
});

test('the captured release rows agree with their existing declared areas and parent identities', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../backlog.snapshot.json', import.meta.url), 'utf8'));
  const metadata = rows => rows.map(({ number, id, area, parent }) => ({ number, id, area, parent })).sort((a, b) => a.number - b.number);
  assert.deepEqual(metadata(normalize(snapshot.issues).issues), metadata(snapshot.issues));
  for (const [number, id, area, parent] of [
    [423, 'SF-R015-T01', 'A00', 'SF-A00-T11'],
    [424, 'SF-R015-T02', 'A10', 'SF-A10-T08'],
    [425, 'SF-R015-T03', 'A26', 'SF-A26-T06'],
    [426, 'SF-R015-T04', 'A29', 'SF-A29-T12'],
  ]) {
    const rows = snapshot.issues.filter(row => row.number === number);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.id, id);
    assert.ok(row.body.includes(`Area: **${area}**. Parent: [${parent}](`));
    assert.equal(row.area, area);
    assert.equal(row.parent, parent);
    assert.equal(find(snapshot, parent).area, area);
    const regenerated = normalize([row]).issues[0];
    assert.equal(regenerated.area, area);
    assert.equal(regenerated.parent, parent);
  }
});

test('paginated backlog export resolves a release parent from a later issue page', async () => {
  const cursors = [], fields = { Agent: 'fixture-owner', Status: 'Claimed' };
  const release = issue(423, releaseId, 'Area: **A00**. Parent: #14.', {
    closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false } },
  });
  const parent = issue(14, parentId, '', { closedByPullRequestsReferences: { nodes: [], pageInfo: { hasNextPage: false } } });
  const client = {
    owner: 'fixture', repo: 'SharpForge',
    items: async () => [{ content: { number: 423 }, fields }],
    graphql: async (_query, variables) => {
      cursors.push(variables.after);
      const first = variables.after === null;
      assert.equal(variables.after, first ? null : 'second-page');
      return { repository: { defaultBranchRef: { name: 'trunk' }, issues: {
        nodes: first ? [release] : [parent], pageInfo: { hasNextPage: first, endCursor: first ? 'second-page' : null },
      } } };
    },
  };
  const snapshot = await snapshotBacklog(client);
  assert.deepEqual(cursors, [null, 'second-page']);
  assert.equal(snapshot.repository, 'fixture/SharpForge');
  assert.equal(snapshot.defaultBranch, 'trunk');
  assert.equal(find(snapshot, releaseId).area, 'A00');
  assert.equal(find(snapshot, releaseId).parent, parentId);
  assert.deepEqual(find(snapshot, releaseId).project, fields);
});
