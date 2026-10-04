import test from 'node:test';
import assert from 'node:assert/strict';
import {DispatcherQueue, DispatcherQueuePriority} from '@sharpforge/winui-properties';

test('dispatcher: callbacks are serialized on the logical UI thread in priority and FIFO order', () => {
  let thread = 'worker';
  const scheduled = [];
  const observed = [];
  const queue = new DispatcherQueue({schedule: callback => scheduled.push(callback), currentThread: () => thread,
    enterThread: action => { const previous = thread; thread = 'ui'; try { action(); } finally { thread = previous; } }});
  const add = (name, priority) => queue.tryEnqueue(() => {
    assert.equal(queue.hasThreadAccess, true);
    observed.push(name);
  }, priority);
  assert.equal(queue.hasThreadAccess, false);
  add('low', DispatcherQueuePriority.Low);
  add('normal1', DispatcherQueuePriority.Normal);
  add('high1', DispatcherQueuePriority.High);
  add('normal2', DispatcherQueuePriority.Normal);
  add('high2', DispatcherQueuePriority.High);
  assert.equal(scheduled.length, 1);
  scheduled.shift()();
  assert.deepEqual(observed, ['high1', 'high2', 'normal1', 'normal2', 'low']);
  assert.equal(queue.hasThreadAccess, false);
  assert.equal(queue.pending, 0);
  assert.deepEqual([...queue.retainedValues()], []);
});

test('dispatcher: bounded drains reschedule, shutdown rejects work and rewind restores pending callbacks without invoking them', () => {
  const scheduled = [];
  const calls = [];
  const queue = new DispatcherQueue({schedule: callback => scheduled.push(callback), maxPending: 2, maxCallbacksPerDrain: 1});
  queue.tryEnqueue(() => calls.push(1));
  queue.tryEnqueue(() => calls.push(2));
  assert.equal(queue.tryEnqueue(() => calls.push(3)), false);
  const snapshot = queue.snapshot();
  scheduled.shift()();
  assert.deepEqual(calls, [1]);
  assert.equal(scheduled.length, 1);
  queue.restore(snapshot);
  assert.deepEqual(calls, [1]);
  assert.equal(queue.pending, 2);
  queue.shutdown();
  assert.equal(queue.tryEnqueue(() => {}), false);
  assert.equal(queue.pending, 0);
  assert.deepEqual([...queue.retainedValues()], []);
  assert.throws(() => queue.tryEnqueue(() => {}, 123), RangeError);
});
