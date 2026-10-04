import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {compileToIL} from '@sharpforge/compiler';
import {CilDebugSession} from '@sharpforge/debugger';
import {CilVirtualMachine, deoptWasmFrames, wasmTieringStatistics, invalidateExecutionCode,
  prepareWasmMethod, runWasmSlice, disposeWasmMethod, framePoolStatistics} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const settings = {wasmTiering: {callThreshold: 10000, backedgeThreshold: 2, osr: true}};
const loopFixture = () => managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
  .op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
  .op('ldloc.0').op('ldc.i4.6').op('blt.s', 'loop').op('ldloc.0').op('ret')}]});

async function selectOsr(vm) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: () => wasmTieringStatistics(vm).methods.some(method => method.backedges === 2)});
  assert.equal(vm.state, 'paused');
  for (let attempt = 0; attempt < 2000 && !wasmTieringStatistics(vm).methods.some(method => method.status === 'ready'); attempt++) {
    await delay(1);
  }
  assert(wasmTieringStatistics(vm).methods.some(method => method.status === 'ready'));
  vm.state = 'running';
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: () => wasmTieringStatistics(vm).osrTransitions === 1});
  assert.equal(vm.state, 'paused');
  assert.equal(wasmTieringStatistics(vm).osrTransitions, 1);
}

function observeArithmetic(vm) {
  const binary = vm.binary.bind(vm);
  let calls = 0;
  vm.binary = (...args) => { calls++; return binary(...args); };
  return () => calls;
}

test('forced deopt preserves canonical values and suppresses both automatic and manual selection', async () => {
  const vm = new CilVirtualMachine(loopFixture(), settings);
  let handle;
  try {
    await selectOsr(vm);
    const frame = vm.top, locals = frame.locals, stack = frame.stack, keys = Object.keys(frame);
    assert.deepEqual(locals, [3]);
    assert.equal(frame.pc, 2);
    assert.equal(deoptWasmFrames(vm), 1);
    assert.equal(deoptWasmFrames(vm), 0);
    handle = await prepareWasmMethod(vm);
    const arithmetic = observeArithmetic(vm);
    vm.state = 'running';
    assert.equal(runWasmSlice(vm, handle, {timeBudgetMs: 0}), 'running');
    assert.equal(vm.top, frame);
    assert.equal(frame.locals, locals);
    assert.equal(frame.stack, stack);
    assert.deepEqual(Object.keys(frame), keys);
    vm.runSlice({instructionBudget: 7, timeBudgetMs: 1000});
    assert.deepEqual(locals, [4]);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 0);
    runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(vm.returnValue, 6);
    assert.equal(arithmetic(), 3);
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 1, 'later hot edges cannot reselect this invocation');
  } finally { if (handle) disposeWasmMethod(handle); vm.stop(); }
});

test('code invalidation and repeated live restore retain host deopt policy; stopped restore starts independently', async () => {
  const vm = new CilVirtualMachine(loopFixture(), settings);
  let handle;
  try {
    await selectOsr(vm);
    const snapshot = vm.snapshot(), frameId = vm.top.id;
    deoptWasmFrames(vm);
    invalidateExecutionCode(vm, 'debugger edit');
    assert.equal(deoptWasmFrames(vm), 0);
    for (let repeat = 0; repeat < 2; repeat++) {
      vm.restore(snapshot);
      assert.equal(vm.top.id, frameId);
      assert.equal(deoptWasmFrames(vm), 0, 'restoring a pre-deopt snapshot must not clear a live invocation mark');
    }
    handle = await prepareWasmMethod(vm);
    const arithmetic = observeArithmetic(vm);
    vm.state = 'running';
    runWasmSlice(vm, handle, {instructionBudget: 7, timeBudgetMs: 1000});
    assert.equal(arithmetic(), 1);
    delete vm.binary;
    disposeWasmMethod(handle);
    handle = null;
    vm.stop();
    vm.restore(snapshot);
    handle = await prepareWasmMethod(vm);
    const restartedArithmetic = observeArithmetic(vm);
    vm.state = 'running';
    runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(vm.returnValue, 6);
    assert.equal(restartedArithmetic(), 0, 'stop ended the marked invocation; restored storage can tier anew');
  } finally { if (handle) disposeWasmMethod(handle); vm.stop(); }
});

const callsFixture = () => managedFixture({methods: [
  {name: 'Main', result: 'int', body: (writer, context) => writer
    .op('ldc.i4.2').op('call', context.methods.Twice).op('pop')
    .op('ldc.i4.3').op('call', context.methods.Twice).op('pop')
    .op('ldc.i4.4').op('call', context.methods.Twice).op('ret')},
  {name: 'Twice', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ldc.i4.2').op('mul').op('ret')}
]});

test('pooled reuse and new calls do not inherit a returned invocation mark', async () => {
  const vm = new CilVirtualMachine(callsFixture());
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: (_, frame) => frame.method.name === 'Twice'});
  const handle = await prepareWasmMethod(vm), firstId = vm.top.id;
  try {
    assert.equal(deoptWasmFrames(vm), 2);
    const arithmetic = observeArithmetic(vm), ids = new Set([firstId]);
    vm.state = 'running';
    runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: (_, frame) => {
      if (frame.method.name === 'Twice') ids.add(frame.id);
      return false;
    }});
    assert.equal(vm.returnValue, 8);
    assert.equal(arithmetic(), 1, 'only the first invocation was forced to the canonical multiply');
    assert.equal(ids.size, 3);
    assert(framePoolStatistics(vm).reused >= 2);
  } finally { disposeWasmMethod(handle); vm.stop(); }
});

test('deopt covers parked scheduler frames and transfers their marks through live restore', () => {
  const vm = new CilVirtualMachine(callsFixture());
  try {
    const target = [...vm.inspector.methods.values()].find(method => method.name === 'Twice');
    const delegate = vm.platform.delegate('System.Func`2<int,int>', target.token, null);
    vm.scheduler.enqueue(delegate, [7]);
    const snapshot = vm.snapshot();
    assert.equal(deoptWasmFrames(vm), 2);
    vm.restore(snapshot);
    assert.equal(deoptWasmFrames(vm), 0);
    vm.scheduler.enqueue(delegate, [9]);
    assert.equal(deoptWasmFrames(vm), 1, 'only the new parked invocation is unmarked');
  } finally { vm.stop(); }
});

test('reentrant deopt completes an active imported output instruction exactly once', async () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body: (writer, context) => writer
    .op('ldc.i4.2').op('ldc.i4.3').op('mul').op('call', context.member('System.Console', 'Write', 'void', ['int']))
    .op('ldc.i4.4').op('ldc.i4.5').op('add').op('ret')}]});
  const vm = new CilVirtualMachine(bytes), handle = await prepareWasmMethod(vm);
  try {
    let notifications = 0;
    vm.onOutput = () => { notifications++; assert.equal(deoptWasmFrames(vm), 1); };
    const arithmetic = observeArithmetic(vm);
    runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(vm.output.join(''), '6');
    assert.equal(vm.returnValue, 9);
    assert.equal(notifications, 1);
    assert.equal(arithmetic(), 1, 'the pre-callback multiply stayed native and the following add was interpreted');
  } finally { disposeWasmMethod(handle); vm.stop(); }
});

test('CIL instruction breakpoint deopts a selected invocation and preserves single-step inspection', async () => {
  const session = new CilDebugSession(loopFixture(), settings), vm = session.vm;
  try {
    await selectOsr(vm);
    const frame = vm.top, target = frame.method.instructions[frame.pc];
    const [breakpoint] = session.setInstructionBreakpoints([{methodToken: frame.method.token, ilOffset: target.offset}]);
    assert.equal(breakpoint.verified, true);
    session.resume();
    session.pump({instructionBudget: 100, timeBudgetMs: 1000});
    assert.equal(session.reason.reason, 'instruction breakpoint');
    assert.equal(vm.top, frame);
    assert.deepEqual(vm.top.locals, [3]);
    assert.equal(vm.top.pc, 2);
    assert.equal(deoptWasmFrames(vm), 0);
    session.resume('stepIn', {granularity: 'instruction'});
    session.pump({instructionBudget: 100, timeBudgetMs: 1000});
    assert.equal(vm.top.pc, 3);
    assert.deepEqual(vm.top.stack, [3]);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 0);
    session.setInstructionBreakpoints([]);
    session.resume();
    assert.equal(session.runUntilStop().state, 'terminated');
    assert.equal(vm.returnValue, 6);
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 1);
  } finally { session.stop(); }
});

test('a source breakpoint in an OSR-selected method retains its sequence point and variable values', async () => {
  const source = 'int x = 0;\nwhile (x < 6)\n{\n  x = x + 1;\n}\nConsole.WriteLine(x);';
  const compilation = compileToIL(source);
  assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
  const session = new CilDebugSession(compilation.assembly, {...settings, pdb: compilation.pdb}), vm = session.vm;
  try {
    await selectOsr(vm);
    const [breakpoint] = session.setBreakpoints('Program.cs', [{line: 4}]);
    assert.equal(breakpoint.verified, true);
    session.resume();
    const state = session.runUntilStop();
    assert.equal(state.state, 'paused');
    assert.equal(state.frames[0].line, 4);
    assert.equal(session.evaluate('x').value, 3);
    assert.equal(deoptWasmFrames(vm), 0);
    const selected = wasmTieringStatistics(vm).selectedInstructions;
    session.setBreakpoints('Program.cs', []);
    session.resume();
    assert.equal(session.runUntilStop().output, '6\n');
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, selected);
  } finally { session.stop(); }
});

test('host pause marks the invocation before returning; invalid engines are rejected', async () => {
  for (const invalid of [null, {}, {inspector: {}}]) assert.throws(() => deoptWasmFrames(invalid), {code: 'WASM_ENGINE'});
  const session = new CilDebugSession(loopFixture(), settings);
  try {
    await selectOsr(session.vm);
    session.resume();
    session.pause();
    assert.equal(session.vm.state, 'paused');
    assert.equal(deoptWasmFrames(session.vm), 0);
    session.resume();
    session.runUntilStop();
    assert.equal(wasmTieringStatistics(session.vm).selectedInstructions, 0);
  } finally { session.stop(); }
});

test('a data breakpoint after a selected store suppresses the rest of that invocation', async () => {
  const session = new CilDebugSession(loopFixture(), settings), vm = session.vm;
  try {
    await selectOsr(vm);
    const [breakpoint] = session.setDataBreakpoints([{kind: 'local', index: 0, frameId: vm.top.id}]);
    assert.equal(breakpoint.verified, true);
    session.resume();
    session.pump({instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(session.reason.reason, 'data breakpoint');
    assert.deepEqual(vm.top.locals, [4]);
    assert.equal(deoptWasmFrames(vm), 0);
    const selected = wasmTieringStatistics(vm).selectedInstructions;
    assert(selected > 0);
    session.setDataBreakpoints([]);
    session.resume();
    session.runUntilStop();
    assert.equal(vm.returnValue, 6);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, selected);
  } finally { session.stop(); }
});

test('a compiled helper exception stop marks live frames before pending fault delivery', async () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body: writer => writer
    .op('ldc.i4.1').op('ldc.i4.0').op('div').op('ret')}]});
  const session = new CilDebugSession(bytes), vm = session.vm, handle = await prepareWasmMethod(vm);
  try {
    session.setExceptionBreakpoints({mode: 'all'});
    runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.pendingFault.name, 'DivideByZeroException');
    assert.equal(deoptWasmFrames(vm), 0);
    session.setExceptionBreakpoints({mode: 'none'});
    session.resume();
    session.runUntilStop();
    assert.equal(vm.state, 'faulted');
    assert.equal(vm.fault.name, 'DivideByZeroException');
    assert.equal(vm.instructions, 3, 'resuming delivers the pending fault without replaying its instruction');
  } finally { disposeWasmMethod(handle); session.stop(); }
});
