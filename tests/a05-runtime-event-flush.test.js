import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeEventLog, RuntimeEventName} from '@sharpforge/runtime';

// Observe copied rows through the public read seam, without elapsed-time assertions.
class ObservedEventLog extends RuntimeEventLog {
  copies = [];

  read(options) {
    const events = super.read(options);
    this.copies.push(events.map(event => event.sequence));
    return events;
  }
}

function emit(log, count = 1) {
  for (let index = 0; index < count; index++) {
    log.emit(RuntimeEventName.Suspend, {context: 1}, log.sequence);
  }
}

test('event flush does not read history with no subscribers or an empty ring', () => {
  const log = new ObservedEventLog({capacity: 4});
  const received = [];
  const dispose = log.subscribe(event => received.push(event.sequence), {replay: true});
  log.flush();
  dispose();
  emit(log, 4);
  log.flush();
  log.flush();
  assert.deepEqual(log.copies, []);
  assert.deepEqual(received, []);
  assert.equal(log.sequence, 4);
  assert.equal(log.dropped, 0);
  assert.deepEqual(log.export().events.map(event => event.sequence), [1, 2, 3, 4]);
});

test('caught-up subscribers do not copy history and later work copies only the unread suffix', () => {
  const log = new ObservedEventLog({capacity: 8});
  emit(log, 4);
  const first = [];
  const second = [];
  log.subscribe(event => first.push(event.sequence));
  log.flush();
  assert.deepEqual(log.copies, []);
  emit(log);
  log.subscribe(event => second.push(event.sequence));
  emit(log);
  log.flush();
  assert.deepEqual(log.copies, [[5, 6]]);
  assert.deepEqual(first, [5, 6]);
  assert.deepEqual(second, [6]);
  log.flush();
  assert.deepEqual(log.copies, [[5, 6]]);
  emit(log);
  log.flush();
  assert.deepEqual(log.copies, [[5, 6], [7]]);
  assert.deepEqual(first, [5, 6, 7]);
  assert.deepEqual(second, [6, 7]);
  assert.deepEqual(log.read().map(event => event.sequence), [1, 2, 3, 4, 5, 6, 7]);
});

test('replay can revisit retained history after delivery without changing drop counts', () => {
  const log = new ObservedEventLog({capacity: 3});
  emit(log, 5);
  const first = [];
  log.subscribe(event => first.push(event.sequence), {replay: true});
  log.flush();
  assert.deepEqual(first, [3, 4, 5]);
  assert.deepEqual(log.copies, [[3, 4, 5]]);
  assert.equal(log.dropped, 2);
  emit(log);
  const replay = [];
  log.subscribe(event => replay.push(event.sequence), {replay: true});
  log.flush();
  assert.deepEqual(log.copies, [[3, 4, 5], [4, 5, 6]]);
  assert.deepEqual(first, [3, 4, 5, 6]);
  assert.deepEqual(replay, [4, 5, 6]);
  assert.equal(log.dropped, 3);
});

test('callbacks cannot overwrite the unread boundary snapshot or recursively deliver new work', () => {
  const log = new ObservedEventLog({capacity: 2});
  emit(log, 2);
  const first = [];
  const second = [];
  const added = [];
  log.subscribe(event => {
    first.push(event.sequence);
    if (event.sequence === 3) {
      emit(log, 2);
      log.subscribe(next => added.push(next.sequence), {replay: true});
      log.flush();
    }
  });
  log.subscribe(event => second.push(event.sequence));
  emit(log, 2);
  log.flush();
  assert.deepEqual(log.copies, [[3, 4]]);
  assert.deepEqual(first, [3, 4]);
  assert.deepEqual(second, [3, 4]);
  assert.deepEqual(added, []);
  assert.equal(log.dropped, 4);
  log.flush();
  assert.deepEqual(log.copies, [[3, 4], [5, 6]]);
  assert.deepEqual(first, [3, 4, 5, 6]);
  assert.deepEqual(second, [3, 4, 5, 6]);
  assert.deepEqual(added, [5, 6]);
});

test('abort and new replay subscriptions still take effect at their existing boundaries', () => {
  const log = new ObservedEventLog({capacity: 2});
  const controller = new AbortController();
  const first = [];
  const canceled = [];
  const added = [];
  let disposeAdded;
  const disposeFirst = log.subscribe(event => {
    first.push(event.sequence);
    if (event.sequence === 1) {
      controller.abort();
      disposeAdded = log.subscribe(next => added.push(next.sequence), {replay: true});
    }
  });
  const disposeCanceled = log.subscribe(event => canceled.push(event.sequence), {signal: controller.signal});
  emit(log, 2);
  log.flush();
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(canceled, []);
  assert.deepEqual(added, []);
  log.flush();
  assert.deepEqual(added, [1, 2]);
  assert.deepEqual(log.copies, [[1, 2], [1, 2]]);
  disposeFirst();
  disposeCanceled();
  disposeAdded();
  disposeAdded();
  emit(log);
  log.flush();
  assert.deepEqual(log.copies, [[1, 2], [1, 2]]);
});

test('a failed callback advances only its own cursor and retry retains other subscribers work', () => {
  const log = new ObservedEventLog({capacity: 4});
  const failure = new Error('host callback failed');
  const first = [];
  const second = [];
  log.subscribe(event => {
    first.push(event.sequence);
    if (event.sequence === 1) throw failure;
  });
  log.subscribe(event => second.push(event.sequence));
  emit(log, 2);
  assert.throws(() => log.flush(), error => error === failure);
  assert.equal(log.flushing, false);
  assert.deepEqual(first, [1]);
  assert.deepEqual(second, []);
  log.flush();
  assert.deepEqual(log.copies, [[1, 2], [1, 2]]);
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(second, [1, 2]);
  log.flush();
  assert.deepEqual(log.copies, [[1, 2], [1, 2]]);
});

test('a lone failing subscriber retries only events after its attempted callback', () => {
  const log = new ObservedEventLog({capacity: 4});
  const failure = new Error('host callback failed');
  const received = [];
  log.subscribe(event => {
    received.push(event.sequence);
    if (event.sequence === 1) throw failure;
  });
  emit(log, 3);
  assert.throws(() => log.flush(), error => error === failure);
  log.flush();
  assert.deepEqual(log.copies, [[1, 2, 3], [2, 3]]);
  assert.deepEqual(received, [1, 2, 3]);
});
