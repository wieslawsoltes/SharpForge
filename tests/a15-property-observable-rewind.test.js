import test from 'node:test';
import assert from 'node:assert/strict';
import {ObservableObject, ObservableVector, ChangeNotificationQueue, SubscriptionLifetime} from '@sharpforge/winui-properties';

test('A15 observable snapshots restore listener identity without replaying notifications', () => {
  const source = new ObservableObject({Name: 'first'});
  let first = 0, future = 0;
  const unsubscribe = source.subscribe(() => first++);
  const snapshot = source.snapshot();
  unsubscribe();
  source.subscribe(() => future++);
  source.set('Name', 'future');
  source.restore(snapshot);
  assert.equal(source.get('Name'), 'first');
  assert.equal(first, 0);
  assert.equal(future, 1);
  source.set('Name', 'restored');
  assert.equal(first, 1);
  assert.equal(future, 1);
  unsubscribe();
  assert.equal(source.subscriberCount, 0);
});

test('A15 vector rewind preserves callback token removals and rejects malformed snapshots atomically', () => {
  const vector = new ObservableVector([1], {maxListeners: 2});
  const events = [];
  const remove = vector.subscribe(change => events.push(change.action));
  const snapshot = vector.snapshot();
  vector.dispose();
  vector.restore(snapshot);
  assert.deepEqual([...vector], [1]);
  assert.equal(events.length, 0);
  vector.Add(2);
  assert.deepEqual(events, ['Add']);
  remove();
  assert.equal(vector.subscriberCount, 0);
  const before = vector.snapshot();
  assert.throws(() => vector.restore({...before, listeners: [[before.nextToken, () => {}]]}), TypeError);
  assert.deepEqual([...vector], [1, 2]);
  vector.subscribe(() => {});
  vector.subscribePropertyChanged(() => {});
  assert.throws(() => vector.subscribe(() => {}), RangeError);
  const iterator = vector[Symbol.iterator]();
  iterator.next();
  vector.set_Item(0, 3);
  assert.throws(() => iterator.next(), {kind: 'InvalidOperationException'});
});

test('A15 queued source disposal cancels only its own pending notifications', () => {
  const queue = new ChangeNotificationQueue({autoDrain: false});
  const first = new ObservableObject({Value: 0}, {queue});
  const second = new ObservableObject({Value: 0}, {queue});
  let delivered = 0;
  first.subscribe(() => { throw new Error('Disposed source delivered'); });
  second.subscribe(() => delivered++);
  first.set('Value', 1);
  second.set('Value', 2);
  const snapshot = queue.snapshot();
  first.dispose();
  queue.drain();
  assert.equal(delivered, 1);
  queue.restore(snapshot);
  assert.equal(delivered, 1);
  queue.drain();
  assert.equal(delivered, 2);
});

test('A15 lifetime rewind reconnects saved state without calling subscription factories', () => {
  const target = {};
  const source = new ObservableObject({Value: 0});
  let factories = 0, deliveries = 0;
  const lifetime = new SubscriptionLifetime(target);
  const remove = lifetime.add(callback => { factories++; return source.subscribe(callback); }, () => deliveries++);
  lifetime.load();
  const sourceState = source.snapshot(), lifetimeState = lifetime.snapshot();
  lifetime.unload();
  source.restore(sourceState);
  lifetime.restore(lifetimeState);
  assert.equal(factories, 1);
  source.set('Value', 1);
  assert.equal(deliveries, 1);
  remove();
  assert.equal(source.subscriberCount, 0);
  lifetime.dispose();
});

test('A15 observable roots include explicit user delegate metadata while private subscriptions stay weak', () => {
  const vector = new ObservableVector([1]);
  const managedDelegate = {h: 10, g: 2};
  const user = () => {};
  user.retainedValues = function* () { yield managedDelegate; };
  const privateObserver = () => {};
  const remove = vector.subscribe(user);
  vector.subscribe(privateObserver);
  assert.deepEqual([...vector.retainedValues()], [1, managedDelegate]);
  remove();
  assert.deepEqual([...vector.retainedValues()], [1]);
});
