import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventLog, RuntimeEventName, exportRuntimeTrace} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function emit(log, count, instruction = log.sequence) {
  for (let index = 0; index < count; index++) {
    log.emit(RuntimeEventName.MethodEnter, {method: 0x06000001, frame: index + 1}, instruction + index);
  }
}

test('trace export keeps the existing event shape and instruction clock with one bounded read', () => {
  class ObservedLog extends RuntimeEventLog {
    windows = [];
    read(options) {
      const events = super.read(options);
      this.windows.push(events.map(event => event.sequence));
      return events;
    }
  }
  const log = new ObservedLog({capacity: 5});
  emit(log, 5);
  const trace = exportRuntimeTrace(log, {after: 1, limit: 2});
  assert.deepEqual(log.windows, [[2, 3]]);
  assert.deepEqual(Object.keys(trace), ['format', 'clock', 'sequence', 'dropped', 'events']);
  assert.equal(trace.format, 'SharpForge.RuntimeEvents/1');
  assert.equal(trace.clock, 'instructions');
  assert.equal(trace.sequence, 5);
  assert.equal(trace.dropped, 0);
  assert.deepEqual(trace.events.map(event => event.instruction), [1, 2]);
  assert.equal(trace.events[0].provider, 'Microsoft-Windows-DotNETRuntime');
  assert.equal(trace.events[0].payload.method, 0x06000001, 'Metadata tokens are not remapped to profiler IDs');
  assert.deepEqual(JSON.parse(JSON.stringify(trace)), trace);
});

test('default helper export preserves the existing full-window contract and empty log shape', () => {
  const log = new RuntimeEventLog({capacity: 3});
  assert.deepEqual(exportRuntimeTrace(log), {
    format: 'SharpForge.RuntimeEvents/1', clock: 'instructions', sequence: 0, dropped: 0, events: []
  });
  emit(log, 4);
  assert.deepEqual(exportRuntimeTrace(log), log.export());
  assert.deepEqual(log.export({after: 2, limit: 1}).events.map(event => event.sequence), [3]);
});

test('minimum capacity and maximum instruction/cursor values keep their exact units and bounds', () => {
  const log = new RuntimeEventLog({capacity: 1});
  log.emit(RuntimeEventName.Resume, {context: 1}, Number.MAX_SAFE_INTEGER);
  const trace = exportRuntimeTrace(log, {limit: 1});
  assert.equal(trace.events[0].instruction, Number.MAX_SAFE_INTEGER);
  assert.equal(trace.sequence, 1);
  assert.deepEqual(exportRuntimeTrace(log, {after: Number.MAX_SAFE_INTEGER}).events, []);
});

test('cursor pages keep global sequence and drop metadata without skipping unread retained events', () => {
  const log = new RuntimeEventLog({capacity: 3});
  emit(log, 5);
  const first = exportRuntimeTrace(log, {limit: 2});
  assert.deepEqual(first.events.map(event => event.sequence), [3, 4]);
  assert.equal(first.sequence, 5);
  assert.equal(first.dropped, 2);
  const second = exportRuntimeTrace(log, {after: first.events.at(-1).sequence, limit: 2});
  assert.deepEqual(second.events.map(event => event.sequence), [5]);
  assert.equal(second.sequence, 5);
  assert.equal(second.dropped, 2);
  assert.deepEqual(exportRuntimeTrace(log, {after: 5}).events, []);
  assert.deepEqual(exportRuntimeTrace(log, {after: 99}).events, []);
});

test('ring eviction between pages stays visible as sequence gaps and cumulative drops', () => {
  const log = new RuntimeEventLog({capacity: 3});
  emit(log, 5);
  const first = exportRuntimeTrace(log, {limit: 1});
  assert.equal(first.events[0].sequence, 3);
  emit(log, 2);
  const second = exportRuntimeTrace(log, {after: 3, limit: 2});
  assert.deepEqual(second.events.map(event => event.sequence), [5, 6]);
  assert.equal(second.sequence, 7);
  assert.equal(second.dropped, 4);
  assert.deepEqual(first.events.map(event => event.sequence), [3]);
});

test('export owns its window array while safely sharing already-frozen event records', () => {
  const log = new RuntimeEventLog({capacity: 2});
  const event = log.emit(RuntimeEventName.MethodLoad, {method: 4, name: 'Original'}, 0);
  const first = exportRuntimeTrace(log);
  const second = exportRuntimeTrace(log);
  assert.notEqual(first.events, second.events);
  assert.equal(first.events[0], event);
  assert.equal(second.events[0], event);
  assert(Object.isFrozen(event));
  assert(Object.isFrozen(event.payload));
  assert.throws(() => { event.payload.name = 'Changed'; }, TypeError);
  first.events.length = 0;
  first.sequence = 99;
  assert.equal(exportRuntimeTrace(log).sequence, 1);
  assert.deepEqual(second.events, [event]);
  emit(log, 2);
  assert.equal(log.dropped, 1);
  assert.equal(second.events[0].payload.name, 'Original', 'Exported records survive ring overwrite');
});

test('export neither flushes subscribers nor consumes their replay or future cursors', () => {
  const log = new RuntimeEventLog({capacity: 4});
  emit(log, 2);
  const replay = [];
  const future = [];
  log.subscribe(event => replay.push(event.sequence), {replay: true});
  log.subscribe(event => future.push(event.sequence));
  exportRuntimeTrace(log, {limit: 1});
  exportRuntimeTrace(log, {after: 1});
  assert.deepEqual(replay, []);
  assert.deepEqual(future, []);
  emit(log, 1);
  log.flush();
  assert.deepEqual(replay, [1, 2, 3]);
  assert.deepEqual(future, [3]);
  const failure = new Error('host subscriber failed');
  const dispose = log.subscribe(() => { throw failure; }, {replay: true});
  assert.doesNotThrow(() => exportRuntimeTrace(log));
  assert.throws(() => log.flush(), error => error === failure);
  dispose();
});

test('export uses sequence order even when instruction counts move backwards', () => {
  const log = new RuntimeEventLog();
  log.emit(RuntimeEventName.MethodLeave, {method: 1, reason: 'return'}, 50);
  log.emit(RuntimeEventName.MethodEnter, {method: 1, reason: 'restore'}, 5);
  const trace = exportRuntimeTrace(log);
  assert.deepEqual(trace.events.map(event => event.sequence), [1, 2]);
  assert.deepEqual(trace.events.map(event => event.instruction), [50, 5]);
  assert.equal(trace.clock, 'instructions');
});

test('invalid log inputs and cursors reject without changing history or invoking arbitrary exporters', () => {
  const fake = {export() { throw new Error('must not call this'); }};
  for (const value of [null, undefined, false, {}, fake, {format: 'SharpForge.RuntimeEvents/1', events: []}]) {
    assert.throws(() => exportRuntimeTrace(value), /Runtime event log required/);
  }
  const log = new RuntimeEventLog({capacity: 3});
  emit(log, 2);
  const before = log.export();
  for (const after of [-1, 0.5, NaN, Infinity, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => exportRuntimeTrace(log, {after}), RangeError);
  }
  for (const limit of [0, -1, 0.5, NaN, Infinity, '1', 4]) {
    assert.throws(() => exportRuntimeTrace(log, {limit}), RangeError);
  }
  assert.throws(() => exportRuntimeTrace(log, null), TypeError);
  assert.deepEqual(log.export(), before);
});

function calls() {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4', 40).op('call', context.methods.Increment).op('call', context.methods.Increment).op('ret');
    }},
    {name: 'Increment', result: 'int', parameters: ['int'],
      body: writer => writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')}
  ]});
}

test('CIL: a real runtime log exports tokens and names, preserves restore chronology, and remains available after stop', () => {
  const vm = new CilVirtualMachine(calls(), {runtimeEvents: true});
  try {
    vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
    const snapshot = vm.snapshot();
    assert.equal(vm.run().returnValue, 42);
    const before = exportRuntimeTrace(vm.runtimeEvents);
    assert(before.events.some(event => event.name === RuntimeEventName.MethodLoad &&
      event.payload.method === 0x06000002 && event.payload.name === 'Fixture.Program::Increment'));
    vm.restore(snapshot);
    const restored = exportRuntimeTrace(vm.runtimeEvents, {after: before.sequence});
    assert(restored.events.length > 0);
    assert(restored.events.every(event => event.sequence > before.sequence && event.payload.reason === 'restore'));
    assert(restored.events[0].instruction < before.events.at(-1).instruction);
    assert.equal(vm.run().returnValue, 42);
    vm.stop();
    const final = exportRuntimeTrace(vm.runtimeEvents);
    assert.deepEqual(JSON.parse(JSON.stringify(final)), final);
    assert(final.sequence > before.sequence);
  } finally { vm.stop(); }
});

test('CIL: exporting a disabled observer is an explicit error and does not enable it', () => {
  const vm = new CilVirtualMachine(calls());
  try {
    assert.equal(vm.runtimeEvents, null);
    assert.throws(() => exportRuntimeTrace(vm.runtimeEvents), /Runtime event log required/);
    assert.equal(vm.runtimeEvents, null);
    assert.equal(vm.run().returnValue, 42);
  } finally { vm.stop(); }
});
