import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitProvider } from '../packages/git/src/providers/index.js';
import { providerEndpoint } from '../packages/git/src/providers/endpoints.js';
import { GitOriginGrants, requiredGitOrigins } from '../packages/git/src/origins.js';
import { GitPermissions } from '../packages/git/src/permissions.js';
import { pullRequestRecord } from '../packages/git/src/providers/models.js';

const sourceOid = 'c'.repeat(40);

// REST contract fixtures follow the cited primary schemas; no user's account or network is used.
const contracts = [
  { provider: 'github', remote: 'https://github.com/acme/project', scopes: ['repo'],
    list: '/repos/acme/project/pulls', comments: '/repos/acme/project/issues/7/comments',
    value: { number: 7, title: 'Feature', body: 'Description', state: 'open', head: { ref: 'feature' }, base: { ref: 'main' } },
    source: 'https://docs.github.com/en/rest/pulls/pulls' },
  { provider: 'gitlab', remote: 'https://gitlab.example/acme/group/project', scopes: ['api'],
    list: '/api/v4/projects/acme%2Fgroup%2Fproject/merge_requests', comments: '/api/v4/projects/acme%2Fgroup%2Fproject/merge_requests/7/notes',
    value: { iid: 7, title: 'Feature', description: 'Description', state: 'opened', source_branch: 'feature', target_branch: 'main' },
    source: 'https://docs.gitlab.com/api/merge_requests/' },
  { provider: 'bitbucket', remote: 'https://bitbucket.org/acme/project', scopes: ['pullrequest:write', 'issue:write'],
    list: '/2.0/repositories/acme/project/pullrequests', comments: '/2.0/repositories/acme/project/pullrequests/7/comments',
    value: { id: 7, title: 'Feature', description: 'Description', state: 'OPEN',
      source: { branch: { name: 'feature' } }, destination: { branch: { name: 'main' } } },
    source: 'https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/' },
  { provider: 'azure', remote: 'https://dev.azure.com/acme/Project/_git/Repo', scopes: ['vso.code_write', 'vso.work_write'],
    list: '/acme/Project/_apis/git/repositories/Repo/pullrequests', comments: '/acme/Project/_apis/git/repositories/Repo/pullrequests/7/threads',
    value: { pullRequestId: 7, title: 'Feature', description: 'Description', status: 'active',
      sourceRefName: 'refs/heads/feature', targetRefName: 'refs/heads/main' },
    source: 'https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/create?view=azure-devops-rest-7.1' },
  { provider: 'gitea', remote: 'https://gitea.example/acme/project', scopes: ['write:repository', 'write:issue'],
    list: '/api/v1/repos/acme/project/pulls', comments: '/api/v1/repos/acme/project/issues/7/comments',
    value: { number: 7, title: 'Feature', body: 'Description', state: 'open', head: { ref: 'feature' }, base: { ref: 'main' } },
    source: 'https://docs.gitea.com/api/operations/repo-create-pull-request/' }
];

function setup(contract, options = {}) {
  const requests = [];
  const endpoint = providerEndpoint(contract.remote, { provider: contract.provider });
  const grants = new GitOriginGrants({ grants: { origin: requiredGitOrigins(contract.remote, contract) } });
  const credential = { provider: contract.provider, accessToken: 'provider-fixture-token',
    allowedOrigins: grants.list('origin'), scopes: contract.scopes, kind: 'oauth' };
  const provider = createGitProvider({ provider: contract.provider, remote: contract.remote, grants, remoteId: 'origin',
    credentialProvider: () => credential, permissions: new GitPermissions({ confirm: () => true }),
    fetch: async (url, request) => {
      const parsed = new URL(url);
      const body = request.body ? JSON.parse(request.body) : null;
      requests.push({ path: parsed.pathname, method: request.method, body, headers: request.headers });
      if (parsed.pathname === contract.list) {
        if (request.method === 'GET') return Response.json(contract.provider === 'bitbucket' ? { values: [contract.value] } :
          contract.provider === 'azure' ? { value: [contract.value] } : [contract.value]);
        return Response.json(contract.value, { status: 201 });
      }
      if (parsed.pathname === `${contract.list}/7`) return Response.json({ ...contract.value, title: 'Updated' });
      if (parsed.pathname === contract.comments) return Response.json({ id: 1, body: 'Review comment' }, { status: 201 });
      throw new Error(`Unexpected ${request.method} fixture endpoint ${parsed.pathname}`);
    }, ...options });
  return { provider, requests, endpoint };
}

for (const contract of contracts) {
  test(`A25 ${contract.provider} PR detail identifies the real fork repository and source commit`, async () => {
    const sourceRemote = contract.provider === 'azure' ? 'https://dev.azure.com/fork/Project/_git/Repo' :
      contract.remote.replace('/acme/', '/fork/');
    const details = {
      github: { head: { sha: sourceOid, ref: 'feature', repo: { clone_url: sourceRemote } } },
      gitea: { head: { sha: sourceOid, ref: 'feature', repo: { clone_url: sourceRemote } } },
      gitlab: { diff_refs: { head_sha: sourceOid }, source_project_id: 42 },
      bitbucket: { source: { branch: { name: 'feature' }, commit: { hash: sourceOid }, repository: { links: { html: { href: sourceRemote } } } } },
      azure: { lastMergeSourceCommit: { commitId: sourceOid }, forkSource: { repository: { remoteUrl: sourceRemote } } }
    };
    const paths = [];
    const { provider } = setup(contract, { fetch: async url => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.endsWith('/projects/42')) return Response.json({ http_url_to_repo: sourceRemote });
      assert.equal(path, `${contract.list}/7`);
      return Response.json({ ...contract.value, ...details[contract.provider] });
    } });
    const value = await provider.getPullRequest(7);
    assert.equal(value.sourceOid, sourceOid);
    assert.equal(value.sourceRemote, sourceRemote);
    assert.equal(value.sourceBranch, 'feature');
    assert.equal(paths.length, contract.provider === 'gitlab' ? 2 : 1);
    provider.client.dispose();
  });

  test(`A25 ${contract.provider} shared PR provider conformance uses its documented endpoint shapes`, async () => {
    const { provider, requests } = setup(contract);
    const listed = await provider.listPullRequests();
    assert.equal(listed[0].id, 7);
    assert.equal(listed[0].title, 'Feature');
    const created = await provider.createPullRequest({ title: 'Feature', head: 'feature', base: 'main', body: 'Description' });
    assert.equal(created.id, 7);
    if (contract.provider === 'azure') assert.equal(created.url, `${contract.remote}/pullrequest/7`);
    const post = requests.find(request => request.path === contract.list && request.method === 'POST');
    const branches = { github: post.body.head, gitlab: post.body.source_branch,
      bitbucket: post.body.source?.branch?.name, azure: post.body.sourceRefName, gitea: post.body.head };
    assert.equal(branches[contract.provider], contract.provider === 'azure' ? 'refs/heads/feature' : 'feature');
    assert.equal((await provider.updatePullRequest(7, { title: 'Updated' })).title, 'Updated');
    await provider.addComment(7, 'Review comment');
    assert.equal(requests.at(-1).path, contract.comments);
    assert.equal(requests.every(request => request.headers.get('Authorization') === 'Bearer provider-fixture-token'), true);
  });

  test(`A25 ${contract.provider} unauthorized PR creation makes no network request`, async () => {
    const { provider, requests } = setup(contract, { credentialProvider: () => ({ provider: contract.provider,
      accessToken: 'read-only', scopes: [], allowedOrigins: requiredGitOrigins(contract.remote, contract) }) });
    await assert.rejects(provider.createPullRequest({ title: 'Denied', head: 'feature', base: 'main' }), { code: 'Auth' });
    assert.equal(requests.length, 0);
  });
}

test('A25 GitHub review thread GraphQL follows cursor without interpolating names into query', async () => {
  const contract = contracts[0];
  const requests = [];
  const { provider } = setup(contract, { fetch: async (_, request) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    const next = !body.variables.after;
    return Response.json({ data: { repository: { pullRequest: { reviewThreads: {
      nodes: [{ id: next ? 'thread-one' : 'thread-two', path: 'file.cs', isResolved: false,
        comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }],
      pageInfo: { hasNextPage: next, endCursor: next ? 'cursor' : null }
    } } } } });
  } });
  const values = await provider.listReviewThreads(7);
  assert.equal(values.length, 2);
  assert.equal(requests[0].variables.owner, 'acme');
  assert.equal(requests[1].variables.after, 'cursor');
  assert.equal(requests[0].query.includes('acme'), false);
});

test('A25 provider resolver rejects ambiguous hosted paths and preserves self-hosted GitLab namespaces', () => {
  assert.equal(providerEndpoint('https://gitlab.example/a/b/c.git', { provider: 'gitlab' }).repoPath, 'projects/a%2Fb%2Fc');
  assert.throws(() => providerEndpoint('https://github.com/a'), { code: 'Unsafe' });
  assert.throws(() => providerEndpoint('https://github.com.evil.example/a/b'), { code: 'Unsupported' });
  assert.throws(() => providerEndpoint('https://token@github.com/a/b'), { code: 'Unsafe' });
});

test('A25 PR detail never substitutes a target for a missing fork or accepts credential-bearing clone URLs', () => {
  const value = { sourceRefName: 'refs/heads/feature', lastMergeSourceCommit: { commitId: sourceOid },
    forkSource: { repository: {} }, repository: { remoteUrl: 'https://dev.azure.com/acme/Project/_git/Repo' } };
  assert.equal(pullRequestRecord(value, 'azure').sourceRemote, null);
  assert.equal(pullRequestRecord({ head: { sha: sourceOid, repo: { clone_url: 'https://token@github.com/fork/repo' } } }, 'github').sourceRemote, null);
});

test('A25 Azure review threads request the latest source iteration before exposing tracked file positions', async () => {
  const paths = [];
  const { provider } = setup(contracts[3], { fetch: async url => {
    const value = new URL(url);
    paths.push(value);
    if (value.pathname.endsWith('/iterations')) return Response.json({ value: [
      { id: 1, sourceRefCommit: { commitId: 'a'.repeat(40) } }, { id: 2, sourceRefCommit: { commitId: sourceOid } }
    ] });
    assert.equal(value.searchParams.get('$iteration'), '2');
    return Response.json({ value: [{ id: 3, comments: [] }] });
  } });
  const result = await provider.listReviewThreads(7);
  assert.equal(paths.length, 2);
  assert.equal(result[0].reviewedHeadOid, sourceOid);
  assert.equal(result[0].reviewedIteration, 2);
  provider.client.dispose();
});
