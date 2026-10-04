import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCollectionChange } from '../packages/winui-controls/src/host/collection-changes.js';

test('observable deltas preserve scene node and mutable collection identity', () => {
  const values = ['a', 'b', 'c'];
  const node = { id: '1:1', collections: { Items: values } };
  const apply = change => applyCollectionChange(node, 'Items', change);
  apply({ action: 'Add', NewStartingIndex: 1, NewItems: ['x'], version: 1 });
  apply({ action: 'Move', OldStartingIndex: 0, NewStartingIndex: 3, OldItems: ['a'], version: 2 });
  apply({ action: 'Replace', OldStartingIndex: 1, NewStartingIndex: 1, OldItems: ['b'], NewItems: ['y', 'z'], version: 3 });
  apply({ action: 'Remove', OldStartingIndex: 0, OldItems: ['x'], version: 4 });
  assert.deepEqual(values, ['y', 'z', 'c', 'a']);
  assert.equal(node.collections.Items, values);
  apply({ action: 'Reset', NewItems: ['reset'], version: 5 });
  assert.deepEqual(values, ['reset']);
});

test('malformed or stale deltas do not partially change retained items', () => {
  const node = { collections: { Items: ['a', 'b'] } };
  for (const change of [
    { action: 'Remove', OldStartingIndex: 1, OldItems: ['wrong'] },
    { action: 'Add', NewStartingIndex: 3, NewItems: ['x'] },
    { action: 'Move', OldStartingIndex: 0, NewStartingIndex: 2, OldItems: ['a'] },
    { action: 'Replace', OldStartingIndex: 0, NewStartingIndex: 1, OldItems: ['a'], NewItems: ['x'] }
  ]) {
    assert.throws(() => applyCollectionChange(node, 'Items', change), /SFUI1670/);
    assert.deepEqual(node.collections.Items, ['a', 'b']);
  }
});

test('frozen initial values and large deltas remain bounded without spreading a million call arguments', () => {
  const original = Object.freeze([1]);
  const node = { collections: { Items: original } };
  const added = Array.from({ length: 10000 }, (_, index) => index + 2);
  applyCollectionChange(node, 'Items', { action: 'Add', NewStartingIndex: 1, NewItems: added });
  assert.equal(node.collections.Items.length, 10001);
  assert.equal(node.collections.Items.at(-1), 10001);
  assert.deepEqual(original, [1]);
  applyCollectionChange(node, 'Items', { action: 'Reset', NewItems: node.collections.Items });
  assert.equal(node.collections.Items.length, 10001);
});
