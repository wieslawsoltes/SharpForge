import {CilVirtualMachine, prepareWasmMethod, runWasmSlice, disposeWasmMethod,
  instructionProfile, wasmTieringStatistics, deoptWasmFrames} from '@sharpforge/runtime';
import {CilDebugSession} from '@sharpforge/debugger';
import {managedFixture} from '../../managed-fixtures.js';

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

function loopFixture() {
  return managedFixture({name: 'A05BrowserWasm', methods: [{name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.op('ldc.i4.0').op('stloc.0').mark('loop')
      .op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
      .op('ldloc.0').op('ldc.i4.6').op('blt.s', 'loop').op('ldloc.0').op('ret')}]});
}

function finish(vm, handle = null) {
  for (let slices = 0; ['ready', 'running'].includes(vm.state) && slices < 1000; slices++) {
    const options = {instructionBudget: 7, timeBudgetMs: 1000};
    if (handle) runWasmSlice(vm, handle, options);
    else vm.runSlice(options);
  }
  equal(vm.state, 'terminated', 'bounded execution terminates');
  equal(vm.returnValue, 6, 'guest result');
  equal(vm.fault, null, 'guest has no fault');
}

function observeArithmetic(vm) {
  const binary = vm.binary.bind(vm);
  let calls = 0;
  vm.binary = (...args) => { calls++; return binary(...args); };
  return () => calls;
}

export async function wasmExecution() {
  const bytes = loopFixture();
  const reference = new CilVirtualMachine(bytes, {profile: true});
  const vm = new CilVirtualMachine(bytes, {profile: true});
  let handle;
  try {
    check(typeof WebAssembly?.instantiate === 'function', 'actual browser WebAssembly is required');
    handle = await prepareWasmMethod(vm);
    check(handle.byteLength > 8 && Object.isFrozen(handle), 'native method was prepared');
    const arithmetic = observeArithmetic(vm);
    runWasmSlice(vm, handle, {timeBudgetMs: 0});
    equal(vm.instructions, 0, 'zero time budget executes no instructions');
    finish(reference);
    finish(vm, handle);
    equal(vm.instructions, reference.instructions, 'native and interpreted instruction counts');
    equal(instructionProfile(vm), instructionProfile(reference), 'native and interpreted profiles');
    equal(arithmetic(), 0, 'Wasm arithmetic must not silently call the interpreter');
    return {passed: true, byteLength: handle.byteLength, instructions: vm.instructions,
      referenceInstructions: reference.instructions, hostArithmeticCalls: arithmetic(), result: vm.returnValue};
  } finally {
    if (handle) disposeWasmMethod(handle);
    vm.stop();
    reference.stop();
  }
}

const tiering = {wasmTiering: {callThreshold: 10000, backedgeThreshold: 2, osr: true}};

async function waitForTier(vm, status) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (wasmTieringStatistics(vm).methods.some(method => method.status === status)) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Wasm tier did not reach ' + status + ': ' + JSON.stringify(wasmTieringStatistics(vm)));
}

function pauseAtHotBackedge(vm) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: () => wasmTieringStatistics(vm).methods.some(method => method.backedges === 2)});
  equal(vm.state, 'paused', 'pause after two real guest backedges');
}

export async function debuggerDeopt() {
  const session = new CilDebugSession(loopFixture(), tiering), vm = session.vm;
  try {
    pauseAtHotBackedge(vm);
    await waitForTier(vm, 'ready');
    vm.state = 'running';
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: () => wasmTieringStatistics(vm).osrTransitions === 1});
    equal(vm.state, 'paused', 'actual OSR transition pauses at an instruction boundary');
    equal(wasmTieringStatistics(vm).osrTransitions, 1, 'actual OSR transition');
    const frame = vm.top, instruction = frame.method.instructions[frame.pc];
    const [breakpoint] = session.setInstructionBreakpoints([
      {methodToken: frame.method.token, ilOffset: instruction.offset}
    ]);
    check(breakpoint.verified, 'debugger instruction breakpoint is verified');
    session.resume();
    session.pump({instructionBudget: 100, timeBudgetMs: 1000});
    equal(session.reason.reason, 'instruction breakpoint', 'actual debugger stop');
    equal(vm.top.pc, 2, 'canonical PC after stop');
    equal([...vm.top.locals], [3], 'canonical locals after stop');
    equal(deoptWasmFrames(vm), 0, 'debugger already deoptimized the invocation');
    session.resume('stepIn', {granularity: 'instruction'});
    session.pump({instructionBudget: 100, timeBudgetMs: 1000});
    equal(vm.top.pc, 3, 'single step advances exactly one original instruction');
    equal([...vm.top.stack], [3], 'single step exposes the canonical operand');
    const stopped = {pc: vm.top.pc, locals: [...vm.top.locals], stack: [...vm.top.stack]};
    const selected = wasmTieringStatistics(vm).selectedInstructions;
    const arithmetic = observeArithmetic(vm);
    session.setInstructionBreakpoints([]);
    session.resume();
    equal(session.runUntilStop().state, 'terminated', 'debugger resume terminates');
    equal(vm.returnValue, 6, 'debugger resume result');
    check(arithmetic() > 0, 'deoptimized execution uses canonical arithmetic');
    const statistics = wasmTieringStatistics(vm);
    equal(statistics.selectedInstructions, selected, 'deoptimized invocation cannot silently reselect Wasm');
    equal(statistics.osrTransitions, 1, 'no additional OSR after deopt');
    return {passed: true, stopped, hostArithmeticCalls: arithmetic(), statistics, instructions: vm.instructions};
  } finally { session.stop(); }
}

// This runs in a separate real document whose CSP omits wasm-unsafe-eval.
// Nothing replaces or stubs WebAssembly: the browser must deny compilation.
export async function cspDeniedFallback() {
  const vm = new CilVirtualMachine(loopFixture(), tiering);
  let rejection;
  try {
    try {
      const unexpected = await prepareWasmMethod(vm);
      disposeWasmMethod(unexpected);
    } catch (error) {
      rejection = {code: error.code, message: error.message, cause: error.cause?.name};
    }
    equal(rejection?.code, 'WASM_COMPILE', 'real CSP rejects native compilation');
    equal(vm.instructions, 0, 'rejected preparation leaves guest execution untouched');
    pauseAtHotBackedge(vm);
    await waitForTier(vm, 'fallback');
    const statistics = wasmTieringStatistics(vm);
    check(statistics.methods.some(method => method.reason?.code === 'WASM_COMPILE'), 'tier records compile fallback');
    equal(statistics.selectedInstructions, 0, 'denied tier executes no selected instructions');
    const arithmetic = observeArithmetic(vm);
    vm.state = 'running';
    finish(vm);
    check(arithmetic() > 0, 'denied tier continues using actual interpreter arithmetic');
    const finalStatistics = wasmTieringStatistics(vm);
    equal(finalStatistics.selectedInstructions, 0, 'no selected instructions after fallback completes');
    equal(finalStatistics.osrTransitions, 0, 'denied compilation cannot enter through OSR');
    return {passed: true, rejection, statistics: finalStatistics, instructions: vm.instructions,
      hostArithmeticCalls: arithmetic(), result: vm.returnValue};
  } finally { vm.stop(); }
}
