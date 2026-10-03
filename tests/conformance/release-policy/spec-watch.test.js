import test from 'node:test';
import assert from 'node:assert/strict';
import { watch, observedRevisions } from '../../../scripts/conformance/release-policy/spec-watch.js';
import { github, pages } from '../../../scripts/conformance/release-policy/github.js';

const feeds = {
  schemaVersion: 1,
  feeds: [{ id: 'owned', repository: 'example/owned', kind: 'commit', branch: 'main',
    pinned: { preview: 'a'.repeat(40) }, specRevision: 'owned-preview' }],
};

test('one simulated revision creates one review issue across repeated observations, never a promotion', async () => {
  const before = JSON.stringify(feeds);
  const issues = [];
  let writes = 0;
  const api = async (path, request) => {
    if (path.includes('/commits/')) return { sha: 'b'.repeat(40) };
    if (request?.method === 'POST') {
      writes++;
      const issue = { number: 1, state: 'closed', ...request.body };
      issues.push(issue);
      return issue;
    }
    return issues;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await watch({ feeds, api, repository: 'example/owned', writeIssues: true });
    assert.equal(result.changes[0].issue, 1);
    assert.deepEqual(result.promotedCapabilities, []);
  }
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(feeds), before);
  assert.match(issues[0].body, /unknown\/unsupported targets remain unqualified/);
});

test('watch dry run and unchanged input never write, while cancellation prevents any request', async () => {
  let calls = 0;
  const api = async (_path, options) => {
    calls++;
    assert.equal(options, undefined);
    return { sha: 'a'.repeat(40) };
  };
  assert.deepEqual((await watch({ feeds, api, writeIssues: true })).changes, []);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(watch({ feeds, api, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('release feed keeps stable and preview separate and rejects malformed or excessive inputs', () => {
  const release = (tag_name, prerelease) => ({ tag_name, prerelease, draft: false, published_at: '2026-10-03T10:00:00Z' });
  assert.deepEqual(observedRevisions({ kind: 'releases' }, [release('v10.0.1', false), release('v11.0.0-preview.1', true)]), [
    { channel: 'stable', revision: 'v10.0.1' }, { channel: 'preview', revision: 'v11.0.0-preview.1' },
  ]);
  assert.throws(() => observedRevisions({ kind: 'releases' }, []), /Missing/);
  assert.throws(() => observedRevisions({ kind: 'releases' }, Array(101).fill(release('v1.0.0', false))), /malformed/);
  assert.throws(() => observedRevisions({ kind: 'releases' }, [release('$(bad)', false)]), /Malformed/);
  assert.throws(() => observedRevisions({ kind: 'commit' }, { sha: 'mutable-main' }), /Malformed/);
});

test('API transport restricts origin, response bounds, pagination and cancellation', async () => {
  const seen = [];
  const api = github({ token: 'owned-fixture-not-a-token', fetcher: async (url, options) => {
    seen.push({ url, options });
    return new Response('{"owned":true}');
  } });
  assert.deepEqual(await api('/repos/example/owned'), { owned: true });
  assert.equal(seen[0].url, 'https://api.github.com/repos/example/owned');
  assert.equal(seen[0].options.redirect, 'error');
  await assert.rejects(api('//example.invalid'), /Invalid/);
  await assert.rejects(api('/../outside'), /Invalid/);
  await assert.rejects(github({ fetcher: async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)) })('/x'), /exceeds/);
  await assert.rejects(pages(async () => Array(100).fill({}), '/x', { limit: 1 }), /pagination bound/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(pages(async () => [], '/x', { signal: controller.signal }), { name: 'AbortError' });
});
