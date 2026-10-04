import test from 'node:test';
import assert from 'node:assert/strict';
import { groupContributions, resolveMergeGroupContext, validateMergeGroupContext } from '../../../scripts/conformance/ci-planning/merge-group-context.js';
import { mergeGroupFixture } from './merge-group-fixture.js';

test('actual ordered queue parents resolve every PR independently of the branch-name number', async t => {
  const value = mergeGroupFixture(t);
  value.requests[0].labels = [{ name: 'seam' }, { name: 'contract-change' }];
  const context = await resolveMergeGroupContext(value);
  assert.deepEqual(context.entries.map(entry => entry.pull_request.number), [11, 12]);
  assert.deepEqual(context.entries.map(entry => entry.head), [value.left, value.right]);
  assert.deepEqual(context.entries[0].pull_request.labels, [{ name: 'contract-change' }, { name: 'seam' }]);
  assert.deepEqual(context.entries[1].pull_request.labels, []);
  assert.equal(value.calls.filter(([method]) => method === 'ref').length, 2);
  assert.ok(value.calls.every(([method]) => ['ref', 'GET'].includes(method)));
  assert.deepEqual(validateMergeGroupContext({ ...value, context }), context);
});

test('invalid or mutable queue pins fail before API access', async t => {
  const value = mergeGroupFixture(t);
  for (const change of [{ head: 'HEAD' }, { base: value.head }, { repository: 'bad/repo/extra' },
    { headRef: 'refs/heads/main' }, { headRef: 'refs/heads/gh-readonly-queue/main?bad' }, { baseRef: 'main' }]) {
    await assert.rejects(resolveMergeGroupContext({ ...value, ...change,
      client: { ref: () => assert.fail('Invalid pins must not access GitHub') } }));
  }
});

test('a moved queue ref fails both before and after constituent resolution', async t => {
  const value = mergeGroupFixture(t);
  for (const failAt of [1, 2]) {
    let refs = 0;
    await assert.rejects(resolveMergeGroupContext({ ...value, client: { ...value.client,
      ref: async () => ({ object: { sha: ++refs === failAt ? value.base : value.head } }),
    } }), /queue ref moved/);
  }
});

test('missing or ambiguous exact-head PR association cannot silently omit a constituent', async t => {
  const value = mergeGroupFixture(t);
  for (const matches of [[], [value.requests[0], { ...value.requests[0], number: 13 }]]) {
    await assert.rejects(resolveMergeGroupContext({ ...value, client: { ...value.client,
      api: async (method, path) => path.startsWith(`commits/${value.left}/`)
        ? matches : value.client.api(method, path),
    } }), /exactly one open PR/);
  }
});

test('authoritative PR drift, missing labels and foreign target fail after association', async t => {
  const value = mergeGroupFixture(t);
  for (const mutate of [request => { request.head.sha = value.base; }, request => { request.base.sha = value.left; },
    request => { request.base.ref = 'other'; }, request => { request.state = 'closed'; }, request => { delete request.labels; }]) {
    await assert.rejects(resolveMergeGroupContext({ ...value, client: { ...value.client,
      api: async (method, path) => {
        const response = await value.client.api(method, path);
        if (path === 'pulls/11') mutate(response);
        return response;
      },
    } }));
  }
});

test('full association pages are bounded and never treated as complete', async t => {
  const value = mergeGroupFixture(t);
  let pages = 0;
  await assert.rejects(resolveMergeGroupContext({ ...value, client: { ...value.client,
    api: async () => { pages++; return Array.from({ length: 100 }, () => value.requests[0]); },
  } }), /pagination bound/);
  assert.equal(pages, 3);
});

test('linear or incomplete group histories fail instead of inventing constituent membership', t => {
  const value = mergeGroupFixture(t);
  assert.throws(() => groupContributions({ ...value, head: value.left }), /Unsupported merge-group topology/);
  assert.throws(() => groupContributions({ ...value, base: value.right }), /Unsupported merge-group topology/);
});

test('consumer rejects omitted, reordered or altered snapshots and a different checkout', async t => {
  const value = mergeGroupFixture(t);
  const context = await resolveMergeGroupContext(value);
  for (const mutate of [copy => { copy.entries.pop(); }, copy => { copy.entries.reverse(); },
    copy => { copy.entries[0].head = value.right; }, copy => { copy.entries[0].pull_request.head.sha = value.right; },
    copy => { copy.entries[0].pull_request.base.ref = 'other'; }, copy => { copy.entries[1].pull_request.number = 11; }]) {
    const copy = structuredClone(context); mutate(copy);
    assert.throws(() => validateMergeGroupContext({ ...value, context: copy }));
  }
  assert.throws(() => validateMergeGroupContext({ ...value, context, repository: 'foreign/repository' }), /another repository/);
  value.command(['checkout', '--detach', value.left]);
  assert.throws(() => validateMergeGroupContext({ ...value, context }), /Checkout does not match/);
});
