import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {flushCilMethodEvents} from '../packages/runtime/src/execution/cil-method-events.js';

const finalizerToken = 0x06000002;

function createVM() {
  const assembly = managedFixture({methods: [
    {name: 'Main', result: 'int', body: writer => writer.op('ldc.i4', 42).op('ret')},
    {name: 'Finalize', static: false, locals: ['byte[]'], body(writer, context) {
      writer.op('ldc.i4.1').op('newarr', context.resolve('byte')).op('stloc.0');
      for (let index = 0; index < 200; index++) writer.op('nop');
      writer.op('ret');
    }}
  ]});
  return new CilVirtualMachine(assembly, {runtimeEvents: true});
}

function suspendFinalizer(vm) {
  vm.heap.object(vm.typeSystem.table('Fixture.Program'), []);
  vm.heap.collect();
  // Creating the cooperative runner costs one unit; the remaining units execute its actual body.
  const result = vm.heap.lifetime.drainFinalizers({budget: 8});
  assert.equal(result.status, 'yielded', result.fault?.stack);
  const runner = vm.heap.lifetime.finalizers.context.active.runner;
  assert.equal(runner.done, false);
  const frame = runner.execution.frames[0];
  assert.equal(frame.method.token, finalizerToken);
  assert.equal(vm.heap.get(frame.locals[0]).kind, 'array');
  flushCilMethodEvents(vm);
  return {runner, array: frame.locals[0]};
}

function finishFinalizers(vm) {
  const result = vm.heap.lifetime.drainFinalizers({budget: 4096});
  assert.equal(result.fault, null);
  assert.equal(result.pending, 0);
  assert.equal(vm.gcRuntime.finalizerRunners.size, 0);
  flushCilMethodEvents(vm);
}

function malformedStorage(snapshot) {
  const spaces = snapshot.heap.services.spaces;
  assert(spaces.bindings.length > 0);
  const bindings = spaces.bindings.map((binding, index) => index === 0 ? {...binding, blockId: -1} : binding);
  return {...snapshot, heap: {...snapshot.heap, services: {...snapshot.heap.services, spaces: {...spaces, bindings}}}};
}

for (const previousState of ['idle', 'another suspended finalizer']) {
  test(`Failed later-service restore retains ${previousState} ownership and balanced method spans`, t => {
    const vm = createVM();
    t.after(() => vm.stop());
    const abandoned = suspendFinalizer(vm);
    const saved = vm.snapshot();
    finishFinalizers(vm);
    vm.heap.collect();
    assert.equal(vm.heap.tryGet(abandoned.array), null);
    const current = previousState === 'idle' ? null : suspendFinalizer(vm);
    const before = {frames: vm.frames, state: vm.state, instructions: vm.instructions,
      objects: vm.heap.stats.liveObjects, bytes: vm.heap.stats.liveBytes, sequence: vm.runtimeEvents.sequence};

    assert.throws(() => vm.restore(malformedStorage(saved)), error =>
      error instanceof TypeError && error.message === 'Invalid storage snapshot binding');
    assert.equal(vm.frames, before.frames);
    assert.equal(vm.state, before.state);
    assert.equal(vm.instructions, before.instructions);
    assert.equal(vm.heap.stats.liveObjects, before.objects);
    assert.equal(vm.heap.stats.liveBytes, before.bytes);
    assert.equal(vm.heap.lifetime.finalizers.context.active?.runner ?? null, current?.runner ?? null);
    assert.deepEqual([...vm.gcRuntime.finalizerRunners], current ? [current.runner] : []);
    assert.equal(vm.heap.tryGet(abandoned.array), null, 'The failed restore cannot revive discarded managed roots');
    if (current) assert.equal(vm.heap.get(current.array).kind, 'array');
    flushCilMethodEvents(vm);
    assert.equal(vm.runtimeEvents.sequence, before.sequence, 'Failed restoration neither opens nor closes method spans');

    finishFinalizers(vm);
    const first = vm.run();
    assert.equal(first.state, 'terminated', first.fault?.stack);
    assert.equal(first.returnValue, 42);
    vm.restore(saved);
    const restored = vm.heap.lifetime.finalizers.context.active.runner;
    assert.equal(restored, abandoned.runner);
    assert.deepEqual([...vm.gcRuntime.finalizerRunners], [restored]);
    assert.equal(restored.execution.frames[0].method, vm.inspector.getMethod(finalizerToken));
    assert.equal(vm.heap.get(abandoned.array).kind, 'array');
    finishFinalizers(vm);
    const replay = vm.run();
    assert.equal(replay.state, 'terminated', replay.fault?.stack);
    assert.equal(replay.returnValue, first.returnValue);
    vm.heap.collect();
    assert.equal(vm.heap.tryGet(abandoned.array), null);

    const events = vm.runtimeEvents.read();
    const finalizerEvents = events.filter(event => event.payload.method === finalizerToken);
    assert.equal(finalizerEvents.filter(event => event.name === RuntimeEventName.MethodLoad).length, 1);
    const enters = finalizerEvents.filter(event => event.name === RuntimeEventName.MethodEnter);
    const leaves = finalizerEvents.filter(event => event.name === RuntimeEventName.MethodLeave);
    assert.equal(enters.length, current ? 3 : 2);
    assert.equal(leaves.length, enters.length);
    assert(leaves.every(event => event.payload.reason === 'return'));
    assert(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence));
  });
}
