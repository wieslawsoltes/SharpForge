import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventLog, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

test('T10.2 host event adapter observes a real managed program without changing its result', () => {
  const log = new RuntimeEventLog(), received = [];
  const unsubscribe = log.subscribe(event => received.push(event));
  const vm = new CilVirtualMachine(managedFixture());
  try {
    const method = vm.top.method;
    log.emit(RuntimeEventName.MethodEnter, {method: method.token, name: method.name}, vm.instructions);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 42);
    log.emit(RuntimeEventName.MethodLeave, {method: method.token}, vm.instructions);
    assert.equal(received.length, 0, 'Observers execute at the explicit host flush');
    log.flush();
    assert.deepEqual(received.map(event => event.name), ['MethodEnter', 'MethodLeave']);
    assert.deepEqual(received.map(event => event.instruction), [0, result.stats.instructions]);
    assert.equal(JSON.parse(JSON.stringify(log.export())).events[0].payload.name, 'Main');
  } finally { unsubscribe(); vm.stop(); }
});

test('T10.2 ring overflow, read cursors and replay preserve retained chronological order', () => {
  const log = new RuntimeEventLog({capacity: 2}), received = [];
  for (let index = 0; index < 3; index++) log.emit(RuntimeEventName.GCStart, {collection: index}, index);
  assert.equal(log.dropped, 1);
  assert.deepEqual(log.read().map(event => event.sequence), [2, 3]);
  assert.deepEqual(log.read({after: 2, limit: 1}).map(event => event.sequence), [3]);
  log.subscribe(event => received.push(event.sequence), {replay: true});
  log.flush();
  log.flush();
  assert.deepEqual(received, [2, 3]);
  assert.deepEqual(log.read({after: 99}), []);
  assert.equal(new RuntimeEventLog({capacity: 1}).read().length, 0);
});

test('T10.2 payloads are owned immutable JSON scalars and rejected writes leave the ring unchanged', () => {
  const log = new RuntimeEventLog(), payload = {method: 1, name: 'Before'};
  const event = log.emit(RuntimeEventName.MethodLoad, payload, 0);
  payload.name = 'After';
  assert.equal(event.payload.name, 'Before');
  assert(Object.isFrozen(event) && Object.isFrozen(event.payload));
  assert.throws(() => { event.payload.name = 'Changed'; }, TypeError);
  const before = log.export();
  for (const invalid of [null, [], {nested: {}}, {value: NaN}, {value: 1n}, {value: undefined}]) {
    assert.throws(() => log.emit(RuntimeEventName.MethodLoad, invalid, 0), TypeError);
    assert.deepEqual(log.export(), before);
  }
  assert.throws(() => log.emit(RuntimeEventName.MethodLoad, {name: 'x'.repeat(16385)}, 0), RangeError);
});

test('T10.2 callback emission, recursion and new subscriptions defer to the next flush', () => {
  const log = new RuntimeEventLog({capacity: 1}), first = [], second = [], added = [];
  log.subscribe(event => {
    first.push(event.sequence);
    if (event.sequence === 1) {
      log.emit(RuntimeEventName.Resume, {}, 1);
      log.subscribe(next => added.push(next.sequence), {replay: true});
      log.flush();
    }
  });
  log.subscribe(event => second.push(event.sequence));
  log.emit(RuntimeEventName.Suspend, {}, 0);
  log.flush();
  assert.deepEqual(first, [1]);
  assert.deepEqual(second, [1], 'All subscribers see the same flush boundary despite overwrite');
  assert.deepEqual(added, []);
  log.flush();
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(second, [1, 2]);
  assert.deepEqual(added, [2]);
});

test('T10.2 abort and idempotent disposal release subscriber capacity', () => {
  const log = new RuntimeEventLog({maxSubscribers: 1}), controller = new AbortController(), received = [];
  const dispose = log.subscribe(event => received.push(event.sequence), {signal: controller.signal});
  assert.throws(() => log.subscribe(() => {}), RangeError);
  log.emit(RuntimeEventName.TierUp, {method: 1}, 10);
  controller.abort();
  dispose();
  dispose();
  log.flush();
  assert.deepEqual(received, []);
  assert.throws(() => log.subscribe(() => {}, {signal: controller.signal}), {name: 'AbortError'});
  const next = log.subscribe(() => {});
  next();
  assert.equal(log.subscribers.size, 0);
});

test('T10.2 host observer failures are explicit and a later flush can continue', () => {
  const log = new RuntimeEventLog(), failure = new Error('observer failed'), received = [];
  const dispose = log.subscribe(() => { throw failure; });
  log.subscribe(event => received.push(event.sequence));
  log.emit(RuntimeEventName.ExceptionThrown, {type: 'System.Exception'}, 4);
  assert.throws(() => log.flush(), error => error === failure);
  dispose();
  log.flush();
  assert.deepEqual(received, [1]);
});

test('T10.2 malformed options and exhausted sequence counters fail before changing history', () => {
  for (const capacity of [0, -1, 1.5, NaN, 1_000_001]) assert.throws(() => new RuntimeEventLog({capacity}), RangeError);
  const log = new RuntimeEventLog();
  assert.throws(() => log.emit('Unknown', {}, 0), TypeError);
  for (const instruction of [-1, Infinity, 0.5]) assert.throws(() => log.emit(RuntimeEventName.GCStart, {}, instruction), RangeError);
  assert.throws(() => log.read({after: -1}), RangeError);
  assert.throws(() => log.read({limit: 0}), RangeError);
  assert.throws(() => log.subscribe(null), TypeError);
  assert.throws(() => log.subscribe(() => {}, {replay: 'yes'}), TypeError);
  log.sequence = Number.MAX_SAFE_INTEGER;
  assert.throws(() => log.emit(RuntimeEventName.GCStart, {}, 0), RangeError);
  assert.equal(log.sequence, Number.MAX_SAFE_INTEGER);
  assert.equal(log.count, 0);
});
