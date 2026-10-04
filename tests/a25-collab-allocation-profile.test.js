import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLABORATION_ALLOCATION_SETTINGS, collaborationAllocationBackend, summarizeCollaborationAllocations } from '../packages/git/bench/collaboration-allocations.js';

const frame = (id, url, selfSize, children = []) => ({ id, callFrame: { url }, selfSize, children });
const prefix = 'file:///fixture/packages/git/src/collab/';

test('allocation summary counts sampled self sizes once and preserves source-stack attribution', () => {
  // Shape/accounting contract only: the separate benchmark obtains its profile from native V8.
  const profile = { head: frame(1, '', 5, [
    frame(2, prefix + 'crdt.js', 100, [frame(3, 'node:internal', 20), frame(4, prefix + 'order-index.js', 30)]),
    frame(5, 'file:///fixture/harness.js', 50)
  ]), samples: [{ nodeId: 2, size: 64, ordinal: 1 }, { nodeId: 3, size: 64, ordinal: 2 }, { nodeId: 5, size: 64, ordinal: 3 }] };
  assert.deepEqual(summarizeCollaborationAllocations(profile, [prefix]), {
    estimatedV8AllocatedBytes: 205, estimatedCollaborationStackBytes: 150,
    sampleRecords: 3, collaborationSampleRecords: 2, profileNodes: 5
  });
  assert.deepEqual(COLLABORATION_ALLOCATION_SETTINGS, {
    samplingInterval: 32768,
    includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true
  });
  assert.equal(Object.hasOwn(COLLABORATION_ALLOCATION_SETTINGS, 'stackDepth'), false);
});

test('allocation backend depth and stop-time GC provenance are limited to the verified Node and V8 pair', () => {
  const verified = collaborationAllocationBackend('v24.19.0', '13.6.233.17-node.51');
  assert.equal(verified.runtimeMatchesSource, true);
  assert.equal(verified.effectiveStackDepth, 128);
  assert.equal(verified.forcedCollectionAtStop, true);
  assert(verified.sources.every(source => source.url.includes('/v24.19.0/') && /^[0-9a-f]{40}$/u.test(source.gitBlob)));
  for (const [node, v8] of [['v22.0.0', '13.6.233.17-node.51'], ['v24.19.0', 'unverified-v8']]) {
    const unknown = collaborationAllocationBackend(node, v8);
    assert.equal(unknown.runtimeMatchesSource, false);
    assert.equal(unknown.effectiveStackDepth, null);
    assert.equal(unknown.forcedCollectionAtStop, null);
  }
});

test('allocation summary rejects absent, invalid or inconsistent native profile data', () => {
  assert.throws(() => summarizeCollaborationAllocations(null), /missing/);
  assert.throws(() => summarizeCollaborationAllocations({ head: frame(1, '', NaN), samples: [] }), /Malformed/);
  assert.throws(() => summarizeCollaborationAllocations({ head: frame(1, '', 1, [frame(1, '', 2)]), samples: [] }), /Malformed/);
  assert.throws(() => summarizeCollaborationAllocations({ head: frame(1, '', 1), samples: [{ nodeId: 9, size: 2 }] }), /Malformed/);
});
