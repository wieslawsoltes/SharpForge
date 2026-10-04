import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSignatureType } from '@sharpforge/cil';

const object = { kind: 'primitive', name: 'object' };
test('public signature display hook overrides selected nodes and preserves default formatting', () => {
  const type = { kind: 'szarray', element: object };
  const before = structuredClone(type);
  const formatType = (node) => (node === object ? 'dynamic' : undefined);
  assert.equal(formatSignatureType(type, null, { formatType }), 'dynamic[]');
  assert.equal(formatSignatureType(type), 'object[]');
  assert.deepEqual(type, before);
});

test('public display children share depth, node and cancellation budgets', () => {
  const formatType = (node, formatChild) => formatChild(node);
  assert.throws(() => formatSignatureType(object, null, { formatType, maxDepth: 2 }), /complexity limit/);
  assert.throws(() => formatSignatureType(object, null, { formatType, maxNodes: 2 }), /complexity limit/);
  assert.throws(() => formatSignatureType(object, null, { formatType, signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => formatSignatureType(object, null, { formatType: 1 }), /must be a function/);
  assert.throws(() => formatSignatureType(object, null, { formatType: () => 1 }), /string or undefined/);
});
