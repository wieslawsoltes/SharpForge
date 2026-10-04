import test from 'node:test';
import assert from 'node:assert/strict';
import {DesignerAnnouncements} from '@sharpforge/designer';

function browserTimers(context) {
  const callbacks = new Map();
  const cancelled = [];
  let serial = 0;
  context.mock.method(globalThis, 'setTimeout', function(callback, delay) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    assert.equal(delay, 50);
    const id = serial++;
    callbacks.set(id, callback);
    return id;
  });
  context.mock.method(globalThis, 'clearTimeout', function(id) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    cancelled.push(id);
    callbacks.delete(id);
  });
  return {callbacks, cancelled,
    tick() {
      const [id, callback] = callbacks.entries().next().value;
      callbacks.delete(id);
      callback();
    }
  };
}

test('default announcement timers retain the browser receiver for scheduling, rescheduling and close', context => {
  const clock = browserTimers(context);
  const spoken = [];
  const closing = new DesignerAnnouncements({announce: message => spoken.push(message)});
  closing.push('Do not speak after closing the document');
  assert.equal(closing.timer, 0);
  const lateCallback = clock.callbacks.get(0);
  closing.dispose();
  assert.deepEqual(clock.cancelled, [0]);
  assert.equal(clock.callbacks.size, 0);
  lateCallback();
  closing.dispose();
  assert.equal(closing.push('Closed'), false);
  assert.deepEqual(spoken, []);
  assert.deepEqual(clock.cancelled, [0]);

  const draining = new DesignerAnnouncements({announce: message => spoken.push(message)});
  draining.push('Selected Save');
  draining.push('Synchronization: synced');
  assert.equal(clock.callbacks.size, 1);
  clock.tick();
  assert.deepEqual(spoken, ['Selected Save']);
  assert.equal(clock.callbacks.size, 1);
  clock.tick();
  assert.deepEqual(spoken, ['Selected Save', 'Synchronization: synced']);
  assert.equal(clock.callbacks.size, 0);
  draining.dispose();
  assert.deepEqual(clock.cancelled, [0]);
});

test('explicit scheduler and cancel functions retain their supplied receiver and cancellation handle', () => {
  const scheduler = {
    pending: new Map(), cancelled: [],
    schedule(callback) {
      assert.equal(this, scheduler);
      this.pending.set(0, callback);
      return 0;
    },
    cancel(id) {
      assert.equal(this, scheduler);
      this.cancelled.push(id);
      this.pending.delete(id);
    }
  };
  const schedule = scheduler.schedule.bind(scheduler);
  const cancel = scheduler.cancel.bind(scheduler);
  const announcements = new DesignerAnnouncements({announce() {}, schedule, cancel});
  assert.equal(announcements.schedule, schedule);
  assert.equal(announcements.cancel, cancel);
  announcements.push('Pending');
  announcements.dispose();
  assert.deepEqual(scheduler.cancelled, [0]);
  assert.equal(scheduler.pending.size, 0);
});

test('a failing injected cancellation leaves no queued work and reports its original failure once', () => {
  const failure = new Error('Scheduler failed to cancel');
  let callback;
  let cancellations = 0;
  const spoken = [];
  const announcements = new DesignerAnnouncements({
    announce: message => spoken.push(message),
    schedule(next) {
      callback = next;
      return 7;
    },
    cancel() {
      cancellations++;
      throw failure;
    }
  });
  announcements.push('Pending');
  assert.throws(() => announcements.dispose(), error => error === failure);
  assert.equal(announcements.disposed, true);
  assert.equal(announcements.timer, null);
  assert.deepEqual(announcements.pending, []);
  callback();
  assert.deepEqual(spoken, []);
  assert.doesNotThrow(() => announcements.dispose());
  assert.equal(cancellations, 1);
});
