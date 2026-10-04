import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createGitProvider } from '../packages/git/src/providers/index.js';
import { GitOriginGrants } from '../packages/git/src/origins.js';
import { GitPermissions } from '../packages/git/src/permissions.js';

const recording = JSON.parse(await readFile(new URL('./fixtures/a25-providers/github-recorded.json', import.meta.url), 'utf8'));
const { creation, pullRequest, issue, reviewThreads, emptyReviewThreads } = recording.records;

function provider(repository, fetch, scopes = ['repo']) {
  const remote = `https://github.com/${repository}`;
  return createGitProvider({ remote, provider: 'github', remoteId: 'recorded', fetch,
    grants: new GitOriginGrants({ grants: { recorded: ['https://github.com', 'https://api.github.com'] } }),
    credentialProvider: () => ({ provider: 'github', kind: 'pat', accessToken: 'authored-offline-replay-token',
      scopes, scopeState: 'known', scopeSource: 'provided', allowedOrigins: ['https://api.github.com'] }),
    permissions: new GitPermissions({ confirm: () => true }) });
}

function creationInput() {
  const { title, head, base, body, draft } = creation.request;
  return { title, head, base, body, draft };
}

// These envelopes and field-name mappings are authored. The retained connector
// returned normalized nodes, without raw GraphQL connections or pageInfo.
function reviewConnection(record) {
  return { data: { repository: { pullRequest: { reviewThreads: {
    nodes: record.response.review_threads.map(thread => ({
      id: thread.id, isResolved: thread.is_resolved, isOutdated: thread.is_outdated,
      path: thread.path, line: thread.line, diffSide: thread.diff_side,
      comments: { nodes: thread.comments.map(comment => ({ id: comment.id, body: comment.body })),
        pageInfo: { hasNextPage: false, endCursor: null } }
    })), pageInfo: { hasNextPage: false, endCursor: null }
  } } } } };
}

test('A25 GitHub capture preserves payload identities and binds authorized creation to the later REST read', () => {
  for (const record of Object.values(recording.records)) {
    for (const key of ['request', 'response']) {
      if (!record.integrity[key]) continue;
      const serialized = JSON.stringify(record[key]);
      assert.equal(createHash('sha256').update(serialized).digest('hex'), record.integrity[key].sha256);
      assert.equal(Buffer.byteLength(serialized), record.integrity[key].bytes);
    }
  }
  assert.equal(creation.source.representation, 'connector-normalized-creation-result');
  assert.equal(pullRequest.source.request.method, 'GET');
  assert.equal(creation.response.number, pullRequest.response.number);
  assert.equal(creation.response.url, pullRequest.response.html_url);
  assert.equal(creation.response.head_sha, pullRequest.response.head.sha);
  assert.equal(creation.response.base_sha, pullRequest.response.base.sha);
  assert.equal(creation.request.head, pullRequest.response.head.ref);
  assert.equal(creation.request.base, pullRequest.response.base.ref);
  assert.equal(creation.request.title, pullRequest.response.title);
  assert.equal(creation.request.body, pullRequest.response.body);
  assert.equal(creation.response.created_at, creation.source.capturedAt);
});

test('A25 GitHub creates a PR from the captured branch request and decodes the corresponding REST record', async t => {
  let calls = 0;
  const api = provider(creation.request.repository_full_name, async (url, request) => {
    calls++;
    assert.equal(url, `https://api.github.com/repos/${creation.request.repository_full_name}/pulls`);
    assert.equal(request.method, 'POST');
    assert.deepEqual(JSON.parse(request.body), creationInput());
    // 201 is an authored replay envelope. The real creation capture is the
    // normalized connector result; this REST body was captured by a later GET.
    return Response.json(pullRequest.response, { status: 201 });
  });
  t.after(() => api.client.dispose());
  const result = await api.createPullRequest(creationInput());
  assert.equal(calls, 1);
  assert.equal(result.id, creation.response.number);
  assert.equal(result.url, creation.response.url);
  assert.equal(result.title, creation.request.title);
  assert.equal(result.body, creation.request.body);
  assert.equal(result.sourceBranch, creation.request.head);
  assert.equal(result.targetBranch, creation.request.base);
  assert.equal(result.sourceOid, creation.response.head_sha);
  assert.equal(result.sourceRemote, 'https://github.com/wieslawsoltes/SharpForge.git');
  assert.equal(result.draft, creation.request.draft);
});

test('A25 GitHub lists recorded public review-thread nodes through an explicitly authored connection envelope', async t => {
  let calls = 0;
  const api = provider(reviewThreads.source.request.repo_full_name, async (url, request) => {
    calls++;
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(request.method, 'POST');
    const body = JSON.parse(request.body);
    assert.deepEqual(body.variables, { owner: 'nodejs', repo: 'node', number: reviewThreads.source.request.pr_number, after: null });
    assert.match(body.query, /reviewThreads\(first:100,after:\$after\)/);
    return Response.json(reviewConnection(reviewThreads));
  });
  t.after(() => api.client.dispose());
  const result = await api.listReviewThreads(reviewThreads.source.request.pr_number);
  const captured = reviewThreads.response.review_threads[0];
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, captured.id);
  assert.equal(result[0].path, captured.path);
  assert.equal(result[0].line, null);
  assert.equal(result[0].isResolved, captured.is_resolved);
  assert.equal(result[0].isOutdated, captured.is_outdated);
  assert.equal(result[0].diffSide, captured.diff_side);
  assert.equal(result[0].comments.nodes[0].id, captured.comments[0].id);
  assert.equal(result[0].comments.nodes[0].body, captured.comments[0].body);
  assert.equal(reviewThreads.source.returnedThreadCount, 12);
  assert.equal(reviewThreads.source.returnedCommentCount, 3);
});

test('A25 GitHub preserves the recorded empty review-thread result', async t => {
  const api = provider(emptyReviewThreads.source.request.repo_full_name, async () => Response.json(reviewConnection(emptyReviewThreads)));
  t.after(() => api.client.dispose());
  assert.deepEqual(await api.listReviewThreads(emptyReviewThreads.source.request.pr_number), []);
});

test('A25 GitHub decodes a captured public issue in an authored collection envelope', async t => {
  const api = provider(creation.request.repository_full_name, async (url, request) => {
    assert.equal(new URL(url).pathname, '/repos/wieslawsoltes/SharpForge/issues');
    assert.equal(request.method, 'GET');
    return Response.json([issue.response]);
  });
  t.after(() => api.client.dispose());
  const [value] = await api.listIssues();
  assert.equal(value.id, issue.response.number);
  assert.equal(value.title, issue.response.title);
  assert.equal(value.url, issue.response.html_url);
  assert.equal(value.state, issue.response.state);
});

test('A25 GitHub rejects the captured creation input under an authored known-insufficient policy before any write', async t => {
  let calls = 0;
  const api = provider(creation.request.repository_full_name, async () => { calls++; throw new Error('No replay request is authorized'); }, []);
  t.after(() => api.client.dispose());
  await assert.rejects(api.createPullRequest(creationInput()), error => error.code === 'Auth' && error.details.state === 'known-insufficient');
  assert.equal(calls, 0);
});
