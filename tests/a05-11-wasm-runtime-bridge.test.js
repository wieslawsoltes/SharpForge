import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareWasmMethod, runWasmSlice, disposeWasmMethod,
  invalidateExecutionCode, framePoolStatistics, instructionProfile} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';
import {managedFixture} from './managed-fixtures.js';
import {wasmHeapFixture} from './support/wasm-heap-fixture.js';

function loopFixture(limit = 10) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4', limit).op('blt.s', 'loop').op('ldloc.0').op('ret')}]});
}

function run(vm, handle, options = {}) {
  for (let slices = 0; ['ready', 'running'].includes(vm.state) && slices < 1000; slices++) {
    const settings = {instructionBudget: 17, timeBudgetMs: 1000, ...options};
    if (handle) runWasmSlice(vm, handle, settings);
    else vm.runSlice(settings);
  }
  return {state: vm.state, value: vm.returnValue, output: vm.output.join(''), fault: vm.fault};
}

test('manual selection executes actual native arithmetic within ordinary budgets and profiler accounting', async () => {
  const bytes = loopFixture();
  const baseline = new CilVirtualMachine(bytes, {profile: true});
  const vm = new CilVirtualMachine(bytes, {profile: true});
  const keys = Object.keys(vm), snapshotKeys = Object.keys(vm.snapshot());
  const handle = await prepareWasmMethod(vm);
  assert(Object.isFrozen(handle));
  assert(handle.byteLength > 8);
  assert.equal(vm.instructions, 0);
  assert.deepEqual(Object.keys(vm), keys);
  assert.deepEqual(Object.keys(vm.snapshot()), snapshotKeys);
  let hostArithmetic = 0;
  const binary = vm.binary.bind(vm);
  vm.binary = (...args) => { hostArithmetic++; return binary(...args); };
  try {
    assert.equal(runWasmSlice(vm, handle, {timeBudgetMs: 0}), 'running');
    assert.equal(vm.instructions, 0);
    assert.deepEqual(run(vm, handle), run(baseline));
    assert.equal(vm.returnValue, 10);
    assert.equal(vm.instructions, baseline.instructions);
    assert.deepEqual(instructionProfile(vm), instructionProfile(baseline));
    assert.equal(hostArithmetic, 0, 'the selected add operations must use Wasm rather than vm.binary');
  } finally { disposeWasmMethod(handle); vm.stop(); baseline.stop(); }
});

test('field/array/allocation imports preserve GC roots and write notifications', async () => {
  const bytes = wasmHeapFixture();
  const baseline = new CilVirtualMachine(bytes, {initialThreshold: 1});
  const vm = new CilVirtualMachine(bytes, {initialThreshold: 1});
  const expectedWrites = [], writes = [];
  baseline.onWrite = event => expectedWrites.push(event.kind);
  vm.onWrite = event => writes.push(event.kind);
  const handle = await prepareWasmMethod(vm);
  try {
    run(baseline, null, {onInstruction: () => { baseline.heap.collect(); }});
    run(vm, handle, {onInstruction: () => { vm.heap.collect(); }});
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.fault, null);
    assert.equal(vm.value(vm.returnValue), 'rooted');
    assert.equal(vm.value(vm.returnValue), baseline.value(baseline.returnValue));
    assert.deepEqual(writes, expectedWrites);
    for (const kind of ['array', 'field', 'static']) assert(writes.includes(kind));
    assert.equal(vm.heap.stats.allocations, baseline.heap.stats.allocations);
    assert.equal(vm.heap.stats.collections, baseline.heap.stats.collections);
    assert.equal(vm.heap.mutationRevision, baseline.heap.mutationRevision);
  } finally { disposeWasmMethod(handle); vm.stop(); baseline.stop(); }
});

test('selected callees return through pooled frames without retaining old execution values', async () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('ldc.i4.2').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.3').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.4').op('call', context.methods.Twice).op('ret')},
    {name: 'Twice', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ldc.i4.2').op('mul').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes);
  const method = [...vm.inspector.methods.values()].find(method => method.name === 'Twice');
  const handle = await prepareWasmMethod(vm, vm.inspector.getMethod(method.token));
  try {
    assert.equal(run(vm, handle).value, 8);
    assert.equal(vm.fault, null);
    assert(framePoolStatistics(vm).reused >= 2);
  } finally { disposeWasmMethod(handle); vm.stop(); }
});

test('debugger pause and snapshot restore preserve frames and invalidate compiled handles', async () => {
  const vm = new CilVirtualMachine(loopFixture());
  const handle = await prepareWasmMethod(vm);
  let restored;
  try {
    const state = runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: (instruction, frame) => instruction.name === 'ldloc.0' && frame.locals[0] === 3});
    assert.equal(state, 'paused');
    const snapshot = vm.snapshot();
    const pc = vm.top.pc;
    vm.state = 'running';
    assert.equal(run(vm, handle).value, 10);
    vm.restore(snapshot);
    assert.throws(() => runWasmSlice(vm, handle), error => error.code === 'WASM_STALE');
    assert.equal(vm.top.pc, pc);
    assert.deepEqual(vm.top.locals, [3]);
    restored = await prepareWasmMethod(vm);
    vm.state = 'running';
    assert.equal(run(vm, restored).value, 10);
  } finally { if (restored) disposeWasmMethod(restored); disposeWasmMethod(handle); vm.stop(); }
});

test('failed operand guards leave numeric inputs intact for the canonical handler', async () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int',
    body: writer => writer.op('ldc.i4.2').op('ldc.i4.3').op('mul').op('ret')}]}));
  const handle = await prepareWasmMethod(vm);
  try {
    runWasmSlice(vm, handle, {instructionBudget: 2, timeBudgetMs: 1000});
    vm.top.stack.splice(0, 2, float(1.5), float(2));
    runWasmSlice(vm, handle, {instructionBudget: 1, timeBudgetMs: 1000});
    assert.deepEqual(vm.top.stack, [float(3)]);
    assert.equal(vm.top.pc, 3);
  } finally { disposeWasmMethod(handle); vm.stop(); }
});

test('instruction and heap faults retain canonical frame offsets and debugger behavior', async () => {
  const bounds = managedFixture({methods: [{name: 'Main', result: 'int', body: (writer, context) => writer
    .op('ldc.i4.1').op('newarr', context.resolve('System.Int32')).op('ldc.i4.1').op('ldelem.i4').op('ret')} ]});
  const allocation = managedFixture({methods: [{name: 'Main', body: (writer, context) => writer
    .op('ldc.i4', 1000).op('newarr', context.resolve('System.Int32')).op('pop').op('ret')} ]});
  for (const [bytes, options, expectedFault, heapBytes] of [
    [loopFixture(), {maxInstructions: 19}, 'InstructionLimitException'],
    [bounds, {}, 'IndexOutOfRangeException'],
    [allocation, {}, 'OutOfMemoryException', 128]
  ]) {
    const baseline = new CilVirtualMachine(bytes, options);
    const vm = new CilVirtualMachine(bytes, options);
    // maxBytes also bounds PE loading; lower the heap alone after loading the fixture.
    if (heapBytes !== undefined) baseline.heap.maxBytes = vm.heap.maxBytes = heapBytes;
    const handle = await prepareWasmMethod(vm);
    try {
      const expected = run(baseline), actual = run(vm, handle);
      assert.equal(actual.state, 'faulted');
      assert.equal(actual.fault.name, expectedFault);
      assert.equal(actual.fault.name, expected.fault.name);
      assert.equal(actual.fault.message, expected.fault.message);
      assert.deepEqual(actual.fault.frames, expected.fault.frames);
      assert.equal(vm.instructions, baseline.instructions);
    } finally { disposeWasmMethod(handle); vm.stop(); baseline.stop(); }
  }
});

test('a host lowering its stack quota after preparation still faults at ordinary admission', async () => {
  const vm = new CilVirtualMachine(loopFixture()), baseline = new CilVirtualMachine(loopFixture());
  const handle = await prepareWasmMethod(vm);
  vm.options.maxStackValues = baseline.options.maxStackValues = 1;
  try {
    const actual = run(vm, handle), expected = run(baseline);
    assert.equal(actual.state, 'faulted');
    assert.equal(actual.fault.name, expected.fault.name);
    assert.equal(actual.fault.message, expected.fault.message);
    assert.deepEqual(actual.fault.frames, expected.fault.frames);
  } finally { disposeWasmMethod(handle); vm.stop(); baseline.stop(); }
});

test('foreign, copied, stale and disposed handles reject before changing a frame', async () => {
  const vm = new CilVirtualMachine(loopFixture()), other = new CilVirtualMachine(loopFixture());
  const handle = await prepareWasmMethod(vm);
  try {
    assert.throws(() => runWasmSlice(other, handle), error => error.code === 'WASM_OWNER');
    assert.throws(() => runWasmSlice(vm, {...handle}), error => error.code === 'WASM_HANDLE');
    assert.equal(other.top.pc, 0);
    vm.report = {...vm.report};
    assert.throws(() => runWasmSlice(vm, handle), error => error.code === 'WASM_STALE');
    assert.equal(vm.top.pc, 0);
    assert.equal(vm.instructions, 0);
    assert.equal(disposeWasmMethod(handle), true);
    assert.equal(disposeWasmMethod(handle), false);
    assert.throws(() => runWasmSlice(vm, handle), error => error.code === 'WASM_DISPOSED');
  } finally { disposeWasmMethod(handle); vm.stop(); other.stop(); }
});

test('stop invalidates an asynchronous preparation before its handle can publish', async () => {
  const vm = new CilVirtualMachine(loopFixture());
  const pending = prepareWasmMethod(vm);
  vm.stop();
  await assert.rejects(pending, error => error.code === 'WASM_STALE');
  assert.equal(vm.frames.length, 0);
  assert.equal(vm.state, 'terminated');
  await assert.rejects(prepareWasmMethod({}), error => error.code === 'WASM_ENGINE');
});

test('body replacement invalidates an existing handle and unsupported methods never publish one', async () => {
  const vm = new CilVirtualMachine(loopFixture());
  const handle = await prepareWasmMethod(vm);
  try {
    vm.top.method.instructions = [...vm.top.method.instructions];
    assert.throws(() => runWasmSlice(vm, handle), error => error.code === 'WASM_STALE');
    assert.equal(vm.top.pc, 0);
    await assert.rejects(prepareWasmMethod(vm), error => error.reasons.some(reason => reason.code === 'WASM_UNVERIFIED'));
  } finally { disposeWasmMethod(handle); vm.stop(); }
  const byref = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', locals: ['int'],
    body: writer => writer.op('ldloca.s', 0).op('pop').op('ret')}]}));
  try {
    await assert.rejects(prepareWasmMethod(byref), error => error.reasons.some(reason => reason.code === 'WASM_OPCODE'));
    assert.equal(byref.top.pc, 0);
  } finally { byref.stop(); }
});

test('callback invalidation is a host error before the next counter or PC change', async () => {
  const vm = new CilVirtualMachine(loopFixture());
  const handle = await prepareWasmMethod(vm);
  try {
    assert.throws(() => runWasmSlice(vm, handle, {onInstruction: () => { invalidateExecutionCode(vm, 'edited'); }}),
      error => error.code === 'WASM_STALE');
    assert.equal(vm.top.pc, 0);
    assert.equal(vm.instructions, 0);
    assert.equal(vm.fault, null);
  } finally { disposeWasmMethod(handle); vm.stop(); }
});

test('ordinary custom steps are preserved and slice callbacks cannot reenter compiled execution', async () => {
  for (const compiled of [false, true]) {
    const vm = new CilVirtualMachine(loopFixture());
    const handle = await prepareWasmMethod(vm);
    try {
      const options = {onInstruction: () => {
        assert.throws(() => runWasmSlice(vm, handle), error => error.code === 'WASM_REENTRANT');
        assert.throws(() => disposeWasmMethod(handle), error => error.code === 'WASM_REENTRANT');
        assert.equal(vm.top.pc, 0);
        return true;
      }};
      assert.equal(compiled ? runWasmSlice(vm, handle, options) : vm.runSlice(options), 'paused');
      assert.equal(vm.instructions, 0);
      vm.state = 'running';
      let calls = 0;
      const step = vm.step.bind(vm);
      vm.step = () => { calls++; return step(); };
      vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
      assert.equal(calls, 2);
    } finally { disposeWasmMethod(handle); vm.stop(); }
  }
});

test('a direct CIL step host callback cannot reenter or dispose its compiled handle', async () => {
  const bytes = managedFixture({methods: [{name: 'Main', body: (writer, context) => writer
    .op('ldc.i4.1').op('pop').op('ldstr', 0x70000000 + context.md.userString('callback'))
    .op('call', context.member('System.Console', 'Write', 'void', ['string'])).op('ret')}]});
  const vm = new CilVirtualMachine(bytes);
  const handle = await prepareWasmMethod(vm);
  let callbacks = 0;
  vm.onOutput = () => {
    const pc = vm.top.pc;
    assert.throws(() => runWasmSlice(vm, handle), error => error.code === 'WASM_REENTRANT');
    assert.throws(() => disposeWasmMethod(handle), error => error.code === 'WASM_REENTRANT');
    assert.equal(vm.top.pc, pc);
    callbacks++;
  };
  try {
    for (let steps = 0; vm.frames.length && steps < 20; steps++) vm.step();
    assert.equal(callbacks, 1);
    assert.equal(vm.state, 'terminated');
  } finally { disposeWasmMethod(handle); vm.stop(); }
});
