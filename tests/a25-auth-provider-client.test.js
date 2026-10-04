import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderClient } from '../packages/git/src/providers/client.js';
import { GitOriginGrants } from '../packages/git/src/origins.js';

function client(fetch, options = {}) {
  return new ProviderClient({ baseUrl: 'https://api.example/v1/', fetch,
    grants: new GitOriginGrants({ grants: { repository: ['https://api.example'] } }), remoteId: 'repository',
    delay: async () => {}, ...options });
}

test('A25 provider retries 429 and secondary 403 no more than three times', async () => {
  for (const status of [429, 403]) {
    let calls = 0;
    const api = client(async () => { calls++; return Response.json({}, { status, headers: { 'Retry-After': '0' } }); });
    await assert.rejects(api.json('items'), error => {
      assert.equal(error.details.attempts, 4);
      assert.equal(error.details.status, status);
      return true;
    });
    assert.equal(calls, 4);
  }
});

test('A25 Retry-After seconds and rate-limit reset are honored without early retry', async () => {
  const waits = [];
  let calls = 0;
  const api = client(async () => ++calls === 1 ? Response.json({}, { status: 429, headers: { 'Retry-After': '2' } }) :
    Response.json({ value: true }), { delay: async milliseconds => waits.push(milliseconds) });
  assert.deepEqual(await api.json('items'), { value: true });
  assert.deepEqual(waits, [2000]);
  const excessive = client(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
  await assert.rejects(excessive.json('items'), { code: 'Network' });
});

test('A25 ETag 304 returns isolated cached data and follows retained Link headers', async () => {
  const counts = new Map();
  const api = client(async (url, request) => {
    const page = new URL(url).searchParams.get('page') ?? '1';
    const count = (counts.get(page) ?? 0) + 1;
    counts.set(page, count);
    if (count === 2) {
      assert.equal(request.headers.get('If-None-Match'), `"page-${page}"`);
      return new Response(null, { status: 304 });
    }
    return Response.json([{ id: Number(page) }], { headers: {
      ETag: `"page-${page}"`, ...(page === '1' ? { Link: '<https://api.example/v1/items?page=2>; rel="next"' } : {})
    } });
  });
  const first = await api.paginate('items');
  first[0].id = 999;
  assert.deepEqual(await api.paginate('items'), [{ id: 1 }, { id: 2 }]);
});

test('A25 pagination rejects origin hops, API-root escapes, cycles and collection bounds', async () => {
  for (const next of ['https://evil.example/items', 'https://api.example/admin/items', 'https://api.example/v1/items']) {
    let requests = 0;
    const api = client(async () => { requests++; return Response.json({ values: [{ id: 1 }], next }); });
    await assert.rejects(api.paginate('items'), error => ['Unsafe', 'Corrupt'].includes(error.code));
    assert.equal(requests, 1);
  }
  const bounded = client(async () => Response.json([1, 2]), { maximumItems: 1 });
  await assert.rejects(bounded.paginate('items'), { code: 'Limit' });
  const responseBound = client(async () => new Response('x'.repeat(64)), { maximumResponseBytes: 32 });
  await assert.rejects(responseBound.json('items'), { code: 'Limit' });
});

test('A25 provider cursors support GitLab pages, Bitbucket next, Azure continuation', async () => {
  for (const kind of ['gitlab', 'bitbucket', 'azure']) {
    let calls = 0;
    const api = client(async url => {
      if (++calls === 2) {
        assert.equal(new URL(url).searchParams.has(kind === 'azure' ? 'continuationToken' : 'page'), true);
        return Response.json({ values: [2] });
      }
      const headers = kind === 'gitlab' ? { 'X-Next-Page': '2' } : kind === 'azure' ? { 'X-MS-ContinuationToken': 'opaque-cursor' } : {};
      return Response.json({ values: [1], ...(kind === 'bitbucket' ? { next: 'https://api.example/v1/items?page=2' } : {}) }, { headers });
    });
    assert.deepEqual(await api.paginate('items'), [1, 2]);
  }
});

test('A25 cancellation stops retries and redirects never follow token-bearing requests', async () => {
  const controller = new AbortController();
  let calls = 0;
  const api = client(async () => { calls++; return Response.json({}, { status: 429, headers: { 'Retry-After': '0' } }); }, {
    delay: async () => controller.abort()
  });
  await assert.rejects(api.json('items', { signal: controller.signal }), { code: 'Cancelled' });
  assert.equal(calls, 1);
  const response = Response.json({});
  Object.defineProperty(response, 'redirected', { value: true });
  const redirecting = client(async () => response);
  await assert.rejects(redirecting.json('items'), { code: 'Unsafe' });
});

test('A25 read-only POST cannot bypass write permission with a GraphQL mutation operation', async () => {
  let requests = 0;
  const api = client(async () => { requests++; return Response.json({}); });
  await assert.rejects(api.json('graphql', { method: 'POST', readOnly: true,
    body: { query: 'query Read { viewer { login } } mutation Write { deleteRef(input:{refId:"x"}) { clientMutationId } }',
      operationName: 'Write' } }), { code: 'Unsafe' });
  assert.equal(requests, 0);
  await assert.rejects(api.json('repos/o/r/git/refs', { method: 'POST', readOnly: true,
    body: { query: 'query Read { viewer { login } }', ref: 'refs/heads/injected', sha: 'a'.repeat(40) } }), { code: 'Unsafe' });
  assert.equal(requests, 0);
});

test('A25 provider limits reject unbounded configuration and limit zero-byte ETag cache entries', async () => {
  assert.throws(() => client(async () => Response.json({}), { maximumPages: Infinity }), { code: 'Limit' });
  const captures = [];
  const api = client(async (url, request) => {
    captures.push({ url, etag: request.headers.get('If-None-Match') });
    return new Response(null, { status: 204, headers: { ETag: '"empty"' } });
  }, { maximumCacheEntries: 1 });
  await api.json('first');
  await api.json('second');
  await api.json('first');
  assert.equal(captures[2].etag, null);
});
