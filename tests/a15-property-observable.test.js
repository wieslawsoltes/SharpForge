import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableVector, SubscriptionLifetime} from '@sharpforge/winui-properties';

test('A15 vector mutations publish exact indexed INCC deltas', () => {
  const changes = [];
  const vector = new ObservableVector([1, 2, 3]);
  const dispose = vector.subscribe(change => changes.push(change));
  vector.Insert(1, 9);
  vector.Move(1, 3);
  vector.set_Item(0, 8);
  vector.RemoveAt(2);
  assert.deepEqual([...vector], [8, 2, 9]);
  assert.deepEqual(changes.map(change => [change.action, change.NewStartingIndex, change.OldStartingIndex]), [
    ['Add', 1, -1], ['Move', 3, 1], ['Replace', 0, 0], ['Remove', -1, 2]
  ]);
  dispose();
  assert.equal(vector.subscriberCount, 0);
  assert.throws(() => vector.get_Item(-1), {kind: 'ArgumentOutOfRangeException'});
});

test('A15 vector rejects reentrant mutation and enforces size before publication', () => {
  const vector = new ObservableVector([], {maxItems: 1});
  vector.subscribe(() => assert.throws(() => vector.Clear(), {kind: 'InvalidOperationException'}));
  vector.Add(1);
  assert.throws(() => vector.Add(2), RangeError);
  assert.deepEqual([...vector], [1]);
});

test('A15 explicit weak handles attach/detach on load and target collection', () => {
  let value = {};
  let released = 0;
  const handlers = new Set();
  const lifetime = new SubscriptionLifetime(value, {
    createWeak: () => 1,
    dereference: () => value,
    release: () => released++
  });
  lifetime.add(handler => { handlers.add(handler); return () => handlers.delete(handler); }, () => {});
  lifetime.load();
  assert.equal(handlers.size, 1);
  lifetime.unload();
  assert.equal(handlers.size, 0);
  lifetime.load();
  value = null;
  assert.equal(lifetime.sweep(), true);
  assert.equal(handlers.size, 0);
  assert.equal(released, 1);
  lifetime.dispose();
  assert.equal(released, 1);
});
