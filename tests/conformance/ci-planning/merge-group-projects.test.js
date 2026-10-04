import test from 'node:test';
import assert from 'node:assert/strict';
import { claimProjectItems, groupClaimedIdentity } from '../../../scripts/conformance/ci-planning/merge-group-projects.js';

function fixture({ task = 'SF-A29-T14', issue = 484, project = 4 } = {}) {
  const branch = `codex/${task}`, repository = 'fixture/repository';
  const claim = { task, issue, branch, agent: 'codex-fixture', expires: '2099-01-01T00:00:00Z', generation: 'claim-generation', locks: [] };
  const pr = { body: `Task: ${task}`, head: { ref: branch } };
  const item = { id: `item-${project}`, isArchived: false,
    project: { id: `project-${project}`, number: project, url: `https://github.com/users/fixture/projects/${project}`, owner: { login: 'fixture' } },
    workId: { text: task }, branch: { text: branch }, agent: { text: claim.agent } };
  const response = { repository: { issue: { number: issue, title: `[${task}] task`, repository: { nameWithOwner: repository },
    projectItems: { nodes: [item], pageInfo: { hasNextPage: false, endCursor: null } } } } };
  const calls = [];
  const client = {
    owner: 'fixture', repo: 'repository', number: 4,
    items: async () => assert.fail('Group qualification must not use the default Project4 board'),
    ref: async name => ({ object: { sha: name } }),
    readRecord: async () => structuredClone(claim),
    graphql: async (query, variables) => { calls.push({ query, variables }); return structuredClone(response); },
  };
  return { client, claim, pr, item, response, calls };
}

test('a mixed-area group resolves each authoritative claim issue into its own live Project', async () => {
  for (const options of [{}, { task: 'SF-A03-T01', issue: 46, project: 6 }, { task: 'SF-A07-T01', issue: 107, project: 9 }]) {
    const value = fixture(options);
    const identity = await groupClaimedIdentity(value.client, value.pr);
    assert.equal(identity.project.number, options.project ?? 4);
    assert.equal(identity.issue, options.issue ?? 484);
    assert.equal(identity.task, value.claim.task);
    assert.equal(identity.area, value.claim.task.slice(3, 6));
    assert.deepEqual(value.calls[0].variables, { owner: 'fixture', repo: 'repository', issue: value.claim.issue, after: null });
    assert.match(value.calls[0].query, /^query ClaimProjects/);
    assert.match(value.calls[0].query, /projectItems\(first:50,after:\$after,includeArchived:false\)/);
    assert.doesNotMatch(value.calls[0].query, /projectV2\(number:/);
  }
});

test('claim issue identity and Work ID cannot be substituted by another repository or task', async () => {
  for (const change of [value => { value.response.repository.issue.number++; },
    value => { value.response.repository.issue.repository.nameWithOwner = 'other/repository'; },
    value => { value.response.repository.issue.title = '[SF-A29-T15] another task'; },
    value => { value.item.workId.text = 'SF-A29-T15'; },
    value => { value.response.repository.issue.projectItems = null; }]) {
    const value = fixture(); change(value);
    await assert.rejects(groupClaimedIdentity(value.client, value.pr), /identity|Work ID|memberships/);
  }
});

test('foreign, archived and tracking-only memberships do not replace the managed claim projection', async () => {
  const value = fixture({ project: 6 });
  const foreign = { ...structuredClone(value.item), id: 'foreign', project: { ...value.item.project, owner: { login: 'other' } } };
  const archived = { ...structuredClone(value.item), id: 'archived', isArchived: true };
  const tracking = { ...structuredClone(value.item), id: 'tracking', workId: null, branch: null, agent: null };
  value.response.repository.issue.projectItems.nodes.push(foreign, archived, tracking);
  assert.equal((await groupClaimedIdentity(value.client, value.pr)).project.number, 6);
  value.response.repository.issue.projectItems.nodes.shift();
  await assert.rejects(groupClaimedIdentity(value.client, value.pr), /exactly one project item/);
});

test('ambiguous managed memberships and stale Project branches fail instead of selecting a convenient board', async () => {
  const value = fixture();
  value.response.repository.issue.projectItems.nodes.push({ ...structuredClone(value.item), id: 'duplicate-projection',
    project: { ...value.item.project, id: 'project-6', number: 6 } });
  await assert.rejects(groupClaimedIdentity(value.client, value.pr), /exactly one project item/);
  value.response.repository.issue.projectItems.nodes.pop();
  value.item.branch.text = 'codex/stale';
  await assert.rejects(groupClaimedIdentity(value.client, value.pr), /branch/i);
});

test('membership lookup follows bounded advancing pages and rejects incomplete or repeated pagination', async () => {
  const value = fixture({ project: 6 });
  const calls = [];
  const pages = { ...value.client, graphql: async (_query, variables) => {
    calls.push(variables.after);
    const result = structuredClone(value.response);
    if (!variables.after) result.repository.issue.projectItems = { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } };
    return result;
  } };
  assert.equal((await claimProjectItems(pages, value.claim))[0].project.number, 6);
  assert.deepEqual(calls, [null, 'next']);
  for (const mode of ['repeat', 'missing', 'bound']) {
    let count = 0;
    const client = { ...value.client, graphql: async () => {
      const result = structuredClone(value.response);
      result.repository.issue.projectItems = { nodes: [], pageInfo: { hasNextPage: true,
        endCursor: mode === 'missing' ? null : mode === 'repeat' ? 'same' : `page-${++count}` } };
      return result;
    } };
    await assert.rejects(claimProjectItems(client, value.claim), /pagination/);
    if (mode === 'bound') assert.equal(count, 10);
  }
});

test('invalid claim issue, inaccessible memberships, absent claims and expired leases remain explicit failures', async () => {
  const value = fixture();
  for (const issue of [undefined, 0, '484']) {
    await assert.rejects(claimProjectItems(value.client, { ...value.claim, issue }), /valid issue number/);
  }
  assert.equal(value.calls.length, 0);
  await assert.rejects(groupClaimedIdentity({ ...value.client, graphql: async () => { throw new Error('Project access denied'); } }, value.pr), /Project access denied/);
  await assert.rejects(groupClaimedIdentity({ ...value.client, ref: async () => null }, value.pr), /no authoritative claim/);
  await assert.rejects(groupClaimedIdentity(value.client, value.pr, Date.parse('2100-01-01')), /expired/);
});


test('a managed Project projection cannot bypass branch binding by omitting its Branch field', async () => {
  for (const branch of [undefined, null, { text: '' }, { text: '   ' }]) {
    const value = fixture();
    value.item.branch = branch;
    await assert.rejects(groupClaimedIdentity(value.client, value.pr), /requires a nonempty Branch/);
  }
});


test('issue483 Work-ID-only Project3 tracking does not block the managed Project4 claim', async () => {
  const value = fixture({ task: 'SF-A29-T13', issue: 483, project: 4 });
  value.claim.branch = 'codex/a29-manual-planning-context';
  value.claim.agent = 'codex-p4-registries';
  value.pr.head.ref = value.claim.branch;
  value.item.branch.text = value.claim.branch;
  value.item.agent.text = value.claim.agent;
  const tracking = { ...structuredClone(value.item), id: 'project3-tracking',
    project: { ...value.item.project, id: 'project-3', number: 3 }, branch: null, agent: null };
  value.response.repository.issue.projectItems.nodes.unshift(tracking);
  const identity = await groupClaimedIdentity(value.client, value.pr);
  assert.equal(identity.project.number, 4);
  assert.equal(identity.issue, 483);
  assert.match(value.calls[0].query, /agent:fieldValueByName\(name:"Agent"\)/);
  value.response.repository.issue.projectItems.nodes.pop();
  await assert.rejects(groupClaimedIdentity(value.client, value.pr), /exactly one project item/);
});

test('a branch-managed projection requires an Agent matching the authoritative claim', async () => {
  for (const agent of [undefined, null, { text: '' }, { text: '   ' }, { text: 'codex-other-owner' }]) {
    const value = fixture();
    value.item.agent = agent;
    await assert.rejects(groupClaimedIdentity(value.client, value.pr), /Project Agent does not match/);
  }
});
