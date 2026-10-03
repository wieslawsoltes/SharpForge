import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareWasmTier, wasmTierStatistics, wasmSafepoint, disposeWasmTier,
  RuntimeEventName} from '@sharpforge/runtime';
import {CilDebugSession} from '@sharpforge/debugger';
import {managedFixture} from './managed-fixtures.js';

function loopFixture(limit = 10) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4', limit).op('blt.s', 'loop').op('ldloc.0').op('ret')}]});
}

const tierEvents = vm => vm.profiler.events.read().filter(event => event.name === RuntimeEventName.TierUp);
const slice = {instructionBudget: 1000, timeBudgetMs: 1000};

test('T11.4 an actual IL breakpoint automatically deopts with exact locals and snapshot state', async () => {
  const session = new CilDebugSession(loopFixture(), {wasmTiering: true, typedNumericStack: true});
  const vm = session.vm;
  try {
    assert.equal((await prepareWasmTier(vm)).status, 'ready');
    const instruction = vm.top.method.instructions[6];
    const [breakpoint] = session.setInstructionBreakpoints([
      {methodToken: vm.top.method.token, ilOffset: instruction.offset, hitCondition: '3'}
    ]);
    assert.equal(breakpoint.verified, true, breakpoint.message);
    session.start(false);
    session.pump(slice);
    assert.equal(vm.state, 'paused');
    assert.equal(session.reason.reason, 'instruction breakpoint');
    const point = wasmSafepoint(vm);
    assert.equal(point.pc, 6);
    assert.deepEqual(point.locals, [3]);
    assert.deepEqual(point.stack, []);
    assert.equal(wasmTierStatistics(vm).deoptimizations, 1);
    vm.state = 'paused';
    assert.equal(wasmTierStatistics(vm).deoptimizations, 1);
    assert.deepEqual(wasmSafepoint(vm), point);
    const snapshot = vm.snapshot();
    assert.equal(snapshot.state, 'paused');
    session.setInstructionBreakpoints([]);
    session.resume();
    assert.equal(vm.run().returnValue, 10);
    const instructions = vm.instructions;
    vm.restore(snapshot);
    assert.equal(vm.state, 'paused');
    assert.deepEqual(wasmSafepoint(vm), point);
    session.resume();
    assert.equal(vm.run().returnValue, 10);
    assert.equal(vm.instructions, instructions);
  } finally { session.stop(); }
});

test('T11.4 manual pause, stepping and host pause transitions deopt automatically', async () => {
  for (const route of ['pause', 'step', 'host']) {
    const session = new CilDebugSession(loopFixture(), {wasmTiering: true});
    const vm = session.vm;
    try {
      await prepareWasmTier(vm);
      let point;
      if (route === 'step') {
        session.resume('stepIn', {granularity: 'instruction'});
        session.pump(slice);
        assert.equal(session.reason.reason, 'step');
        assert.equal(vm.instructions, 1);
      } else {
        session.start(false);
        session.pump({instructionBudget: 5, timeBudgetMs: 1000});
        assert.equal(vm.instructions, 5);
        assert.equal(wasmTierStatistics(vm).deoptimizations, 0);
        point = wasmSafepoint(vm);
        if (route === 'host') vm.state = 'paused';
        else session.pause();
      }
      assert.equal(vm.state, 'paused', route);
      assert.equal(wasmTierStatistics(vm).deoptimizations, 1, route);
      if (route !== 'step') assert.deepEqual(wasmSafepoint(vm), point);
      session.resume();
      assert.equal(vm.run().returnValue, 10);
    } finally { session.stop(); }
  }
});

test('T11.4 a data breakpoint deopts within a Wasm host import after exactly one write', async () => {
  const session = new CilDebugSession(loopFixture(), {wasmTiering: true});
  const vm = session.vm;
  try {
    await prepareWasmTier(vm);
    const [breakpoint] = session.setDataBreakpoints([{kind: 'local', index: 0, frameId: vm.top.id}]);
    assert.equal(breakpoint.verified, true, breakpoint.message);
    session.start(false);
    session.pump(slice);
    assert.equal(session.reason.reason, 'data breakpoint');
    assert.equal(vm.state, 'paused');
    assert.equal(vm.instructions, 2);
    assert.equal(vm.top.pc, 2);
    assert.deepEqual([...vm.top.locals], [0]);
    assert.deepEqual([...vm.top.stack], []);
    assert.equal(wasmTierStatistics(vm).deoptimizations, 1);
    session.setDataBreakpoints([]);
    session.resume();
    assert.equal(vm.run().returnValue, 10);
  } finally { session.stop(); }
});

test('T11.4 first-chance debugger pause also deopts the active tiered caller', async () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('ldc.i4.7').op('call', context.methods.Fail).op('ret')},
    {name: 'Fail', result: 'int', parameters: ['int'], body: writer => writer
      .op('ldarg.0').op('ldc.i4.0').op('div').op('ret')}
  ]});
  const session = new CilDebugSession(bytes, {wasmTiering: true}), vm = session.vm;
  try {
    assert.equal((await prepareWasmTier(vm)).status, 'ready');
    assert.equal((await prepareWasmTier(vm, 0x06000002)).status, 'ready');
    session.setExceptionBreakpoints({mode: 'all'});
    session.start(false);
    session.pump(slice);
    assert.equal(vm.state, 'paused');
    assert.equal(session.reason.reason, 'exception');
    assert.equal(vm.pendingFault.name, 'DivideByZeroException');
    assert.equal(vm.frames.length, 2);
    assert.equal(wasmTierStatistics(vm).entryTransitions, 2);
    assert.equal(wasmTierStatistics(vm).deoptimizations, 2);
    session.resume();
    assert.equal(vm.run().fault.name, 'DivideByZeroException');
  } finally { session.stop(); }
});

test('T10.2 TierUp is delivered only for actual entry and resumed loop OSR at host boundaries', async () => {
  const vm = new CilVirtualMachine(loopFixture(), {wasmTiering: true, profile: true}), delivered = [];
  const unsubscribe = vm.profiler.events.subscribe(event => delivered.push(event), {replay: true});
  try {
    assert.equal((await prepareWasmTier(vm)).status, 'ready');
    assert.deepEqual(tierEvents(vm), []);
    vm.runSlice({instructionBudget: 5, timeBudgetMs: 1000});
    assert.deepEqual(tierEvents(vm).map(event => event.payload.kind), ['entry']);
    assert.equal(delivered.filter(event => event.name === RuntimeEventName.TierUp).length, 1);
    const deliveredBefore = delivered.length;
    vm.state = 'paused';
    assert.equal(delivered.length, deliveredBefore);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 10);
    const events = tierEvents(vm);
    assert.deepEqual(events.map(event => event.payload.kind), ['entry', 'osr']);
    assert.deepEqual(events.map(event => event.payload.ilOffset), [0, vm.inspector.getMethod(0x06000001).instructions[2].offset]);
    assert(events.every(event => event.payload.methodToken === 0x06000001));
    assert.equal(new Set(events.map(event => event.payload.frame)).size, 1);
    assert(events[1].instruction > events[0].instruction);
    assert(delivered.every((event, index) => !index || event.sequence > delivered[index - 1].sequence));
  } finally { unsubscribe(); vm.stop(); }
});

test('T10.2 unsupported and disposed tiers emit no TierUp; profile-off stays off', async () => {
  const unsupported = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldloca.s', 0).op('pop').op('ldc.i4.7').op('ret')}]});
  for (const [bytes, disposed] of [[unsupported, false], [loopFixture(), true]]) {
    const vm = new CilVirtualMachine(bytes, {wasmTiering: true, profile: true});
    try {
      const prepared = await prepareWasmTier(vm);
      assert.equal(prepared.status, disposed ? 'ready' : 'fallback');
      if (disposed) disposeWasmTier(vm);
      assert.equal(vm.run().state, 'terminated');
      assert.deepEqual(tierEvents(vm), []);
    } finally { vm.stop(); }
  }
  const plain = new CilVirtualMachine(loopFixture(), {wasmTiering: true});
  try {
    await prepareWasmTier(plain);
    assert.equal(plain.run().returnValue, 10);
    assert.equal(plain.profiler, null);
  } finally { plain.stop(); }
});

test('T10.2 TierUp subscriber errors escape to the host after guest dispatch', async () => {
  const vm = new CilVirtualMachine(loopFixture(), {wasmTiering: true, profile: true});
  const failure = new Error('tier observer');
  const unsubscribe = vm.profiler.events.subscribe(event => {
    if (event.name === RuntimeEventName.TierUp) throw failure;
  });
  try {
    await prepareWasmTier(vm);
    assert.throws(() => vm.runSlice(slice), error => error === failure);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.returnValue, 10);
    assert.equal(vm.fault, null);
  } finally { unsubscribe(); vm.stop(); }
});

test('T11.4 state accessors preserve prototype-based non-tiered callers', () => {
  const vm = Object.create(CilVirtualMachine.prototype);
  vm.state = 'ready';
  assert.equal(vm.state, 'ready');
  const context = Object.create(vm);
  assert.equal(context.state, 'ready');
  context.state = 'waiting';
  assert.equal(context.state, 'waiting');
  assert.equal(vm.state, 'ready');
  vm.state = 'paused';
  assert.equal(vm.state, 'paused');
  assert.deepEqual(Object.keys(vm), []);
});
