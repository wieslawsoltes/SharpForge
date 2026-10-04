import test from 'node:test';
import assert from 'node:assert/strict';
import { observedRevisions, watch } from '../scripts/conformance/release-policy/spec-watch.js';

const release = (tag, published = '2026-10-01T00:00:00Z', prerelease = true) => ({
  tag_name: tag, published_at: published, prerelease, draft: false,
});
const latest = rows => observedRevisions({ kind: 'releases' }, rows)[0].revision;

// Publication time deliberately favors the lower version in every pair.
function expectHigher(lower, higher) {
  const rows = [release(lower, '2026-10-03T00:00:00Z'), release(higher)];
  assert.equal(latest(rows), higher);
  assert.equal(latest([...rows].reverse()), higher);
}

test('release watcher orders preview numeric identifiers before publication dates', () => {
  expectHigher('v10.0.0-preview.9', 'v10.0.0-preview.10');
  expectHigher('v10.0.0-preview.10.2', 'v10.0.0-preview.10.10');
  expectHigher('v10.0.0-preview.999', 'v10.0.1-preview.1');
});

test('release watcher retains text, numeric and identifier-count precedence', () => {
  expectHigher('v10.0.0-alpha', 'v10.0.0-beta');
  expectHigher('v10.0.0-preview.10', 'v10.0.0-preview.alpha');
  expectHigher('v10.0.0-preview', 'v10.0.0-preview.1');
  expectHigher('v10.0.0-preview.1', 'v10.0.0');
});

test('release watcher compares large core and preview integers without precision loss', () => {
  expectHigher('v9007199254740992.0.0', 'v9007199254740993.0.0');
  expectHigher('v1.0.0-preview.9007199254740992', 'v1.0.0-preview.9007199254740993');
  expectHigher('v1.0.0-preview.999999999999999999999999', 'v1.0.0-preview.1000000000000000000000000');
});

test('release watcher preserves accepted dotted suffixes and separate release channels', () => {
  expectHigher('v1.0.0.9', 'v1.0.0.10');
  assert.deepEqual(observedRevisions({ kind: 'releases' }, [
    release('v1.0.0-preview.9', '2026-10-03T00:00:00Z'),
    release('v1.0.0-preview.10'),
    release('v0.9.1', '2026-10-02T00:00:00Z', false),
    { ...release('v2.0.0-preview.1'), draft: true },
  ]), [
    { channel: 'stable', revision: 'v0.9.1' },
    { channel: 'preview', revision: 'v1.0.0-preview.10' },
  ]);
  assert.throws(() => latest([release('v1.0-preview.1')]), /Malformed release identity/);
});

test('publication time breaks ties only after all numeric identifiers compare equally', () => {
  assert.equal(latest([
    release('v1.0.0-preview.01'),
    release('v1.0.0-preview.1', '2026-10-03T00:00:00Z'),
  ]), 'v1.0.0-preview.1');
});

test('watch ignores a later publication of an older preview when the newest version is pinned', async () => {
  const feeds = {
    schemaVersion: 1,
    feeds: [{
      id: 'preview-order', repository: 'example/owned', kind: 'releases',
      pinned: { preview: 'v10.0.0-preview.10' }, specRevision: 'owned-preview',
    }],
  };
  let calls = 0;
  const result = await watch({
    feeds,
    writeIssues: true,
    api: async (path, request) => {
      calls++;
      assert.equal(path, '/repos/example/owned/releases?per_page=100');
      assert.equal(request, undefined);
      return [release('v10.0.0-preview.9', '2026-10-03T00:00:00Z'), release('v10.0.0-preview.10')];
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.promotedCapabilities, []);
});
