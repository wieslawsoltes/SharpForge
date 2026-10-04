import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';

const source = cleanupThrows => `using System;
using System.Runtime.ExceptionServices;
static class Program {
  static void Inner() {
    try { throw new Exception("subscriber"); }
    finally { Console.WriteLine("inner-cleanup"); ${cleanupThrows ? 'throw new Exception("cleanup");' : ''} }
  }
  static void First(object sender, FirstChanceExceptionEventArgs args) {
    Console.WriteLine("first:" + args.Exception.Message);
    if (args.Exception.Message != "original") return;
    try { Inner(); } finally { Console.WriteLine("callback-cleanup"); }
  }
  static void Second(object sender, FirstChanceExceptionEventArgs args) {
    GC.Collect(); Console.WriteLine("second:" + args.Exception.Message);
  }
  static void Last(object sender, UnhandledExceptionEventArgs args) { Console.WriteLine("unhandled"); }
  static void Thrower() {
    try { throw new Exception("original"); } finally { Console.WriteLine("original-cleanup"); }
  }
  static void Main() {
    AppDomain.CurrentDomain.FirstChanceException += First;
    AppDomain.CurrentDomain.FirstChanceException += Second;
    AppDomain.CurrentDomain.UnhandledException += Last;
    try { Thrower(); } catch (Exception error) { Console.WriteLine("outer-catch"); }
  }
}`;
const artifacts = new Map();
function artifact(cleanupThrows = false) {
  if (!artifacts.has(cleanupThrows)) {
    const result = compileToIL(source(cleanupThrows), {pipeline: 'bound'});
    assert(result.success, JSON.stringify(result.diagnostics));
    artifacts.set(cleanupThrows, result);
  }
  return artifacts.get(cleanupThrows);
}
function create(engine, policy, cleanupThrows = false) {
  const compiled = artifact(cleanupThrows);
  const options = {weakStringInterning: true, maxInstructions: 20000, firstChanceFailurePolicy: policy};
  return engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
    : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
}
const nameOf = (vm, frame) => (frame.method ?? vm.image.methods[frame.methodId]).name;
const prefix = 'first:original\nfirst:subscriber\nsecond:subscriber\n';
const after = cleanupThrows => prefix + 'inner-cleanup\n' +
  (cleanupThrows ? 'first:cleanup\nsecond:cleanup\n' : '') + 'callback-cleanup\n';

function verifyFatal(vm, output, failure = 'subscriber', afterUnwind = true) {
  if (vm.state === 'paused') vm.state = 'running';
  const result = vm.run();
  assert.equal(result.state, 'faulted', result.fault?.stack);
  assert.equal(result.output, output);
  assert.equal(result.fault.name, 'ExecutionEngineException');
  assert.equal(result.exitCode, 0x80131506 | 0);
  assert.equal(result.fault.callbackFailure.message, failure);
  assert.equal(result.fault.exceptionEventContinuation.fault.message, 'original');
  assert(vm.frames.some(frame => nameOf(vm, frame) === 'Thrower'), 'original throwing frame remains inspectable');
  if (afterUnwind) assert(!vm.frames.some(frame => nameOf(vm, frame) === 'First'), 'callback boundary is retired');
  const original = result.fault.exceptionEventContinuation.fault.reference;
  vm.heap.collect();
  assert.equal(vm.heap.get(original).methodTable.name, 'System.Exception', 'fatal diagnostics retain original after callback retirement');
  return result.fault;
}

function pauseInCleanup(vm) {
  for (let steps = 0; steps < 3000 && !vm.output.join('').endsWith('inner-cleanup\n'); steps++) {
    assert(['ready', 'running', 'paused'].includes(vm.state));
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
  }
  assert(vm.output.join('').endsWith('inner-cleanup\n'));
  assert(vm.frames.some(frame => frame.unwinds?.some(unwind => unwind.search?.selection?.kind === 'event-failfast')));
  vm.state = 'paused';
}

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: first-chance failure policy validates exact values and preserves the default`, () => {
    for (const policy of [null, false, 0, 'after', {}, []]) {
      assert.throws(() => create(engine, policy), {name: 'RuntimeLaunchError', code: 'FIRST_CHANCE_FAILURE_POLICY'});
    }
    const vm = create(engine);
    try {
      assert.equal(vm.options.firstChanceFailurePolicy, 'before-unwind');
      verifyFatal(vm, prefix, 'subscriber', false);
    } finally { vm.stop(); }
  });

  for (const cleanupThrows of [false, true]) test(`${engine}: after-unwind runs callback cleanup and handles cleanup throws=${cleanupThrows}`, () => {
    const vm = create(engine, 'after-unwind', cleanupThrows);
    try { verifyFatal(vm, after(cleanupThrows), cleanupThrows ? 'cleanup' : 'subscriber'); }
    finally { vm.stop(); }
  });

  test(`${engine}: cleanup suspension preserves captured policy through local and portable restore`, async () => {
    const vm = create(engine, 'after-unwind'), fresh = create(engine, 'before-unwind');
    try {
      pauseInCleanup(vm);
      const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
      verifyFatal(vm, after(false));
      vm.stop();
      vm.heap.collect();
      vm.options.firstChanceFailurePolicy = 'before-unwind';
      vm.restore(saved);
      await restoreSerializedSnapshot(fresh, wire);
      for (const replay of [vm, fresh]) {
        replay.heap.collect();
        verifyFatal(replay, after(false));
      }
    } finally { vm.stop(); fresh.stop(); }
  });

  test(`${engine}: older captured notifications without a policy retain before-unwind behavior`, async () => {
    const vm = create(engine, 'before-unwind'), fresh = create(engine, 'after-unwind');
    try {
      for (let step = 0; step < 3000 && !vm.frames.some(frame => frame.exceptionEventContinuation); step++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      }
      const saved = vm.snapshot();
      const event = saved.frames.find(frame => frame.exceptionEventContinuation).exceptionEventContinuation;
      delete event.failurePolicy;
      const wire = await serializeSnapshot(vm, saved, {json: true});
      vm.restore(saved);
      await restoreSerializedSnapshot(fresh, wire);
      verifyFatal(vm, prefix, 'subscriber', false);
      verifyFatal(fresh, prefix, 'subscriber', false);
    } finally { vm.stop(); fresh.stop(); }
  });

  test(`${engine}: terminal diagnostic graphs survive GC and local/portable snapshots`, async () => {
    const vm = create(engine, 'after-unwind'), fresh = create(engine, 'before-unwind');
    try {
      const fatal = verifyFatal(vm, after(false));
      vm.pendingFault = fatal;
      vm.fault = null;
      vm.heap.collect();
      assert.equal(vm.heap.get(fatal.exceptionEventContinuation.fault.reference).kind, 'exception');
      vm.fault = fatal;
      vm.pendingFault = null;
      const saved = vm.snapshot(), wire = await serializeSnapshot(vm, saved, {json: true});
      vm.stop();
      vm.heap.collect();
      vm.restore(saved);
      await restoreSerializedSnapshot(fresh, wire);
      for (const replay of [vm, fresh]) {
        replay.heap.collect();
        assert.equal(replay.state, 'faulted');
        assert.equal(replay.fault.callbackFailure.message, 'subscriber');
        assert.equal(replay.fault.exceptionEventContinuation.fault.message, 'original');
        assert.equal(replay.heap.get(replay.fault.exceptionEventContinuation.fault.reference).kind, 'exception');
      }
      assert.notEqual(vm.fault, fatal);
      vm.stop();
      vm.platform.singletons.delete('AppDomain.CurrentDomain');
      vm.heap.collect();
      const stopped = vm.snapshot();
      vm.restore(stopped);
      assert.equal(vm.fault.exceptionEventContinuation.fault.message, 'original');
    } finally { vm.stop(); fresh.stop(); }
  });

  test(`${engine}: malformed captured policies and failfast boundaries reject atomically`, () => {
    const vm = create(engine, 'after-unwind');
    try {
      pauseInCleanup(vm);
      const saved = vm.snapshot(), current = vm.top, output = vm.output.join('');
      const event = saved.frames.find(frame => frame.exceptionEventContinuation?.fault.message === 'original').exceptionEventContinuation;
      event.failurePolicy = 'unknown';
      assert.throws(() => vm.restore(saved), /failure policy|failfast boundary/);
      assert.equal(vm.top, current);
      assert.equal(vm.output.join(''), output);
      event.failurePolicy = 'before-unwind';
      assert.throws(() => vm.restore(saved), /failfast boundary/);
      assert.equal(vm.top, current);
      verifyFatal(vm, after(false));
      const terminal = vm.snapshot();
      terminal.fault.exceptionEventContinuation.failurePolicy = null;
      assert.throws(() => vm.restore(terminal), /failure policy/);
      terminal.fault.exceptionEventContinuation.failurePolicy = 'after-unwind';
      terminal.fault.callbackFailure = terminal.fault;
      assert.throws(() => vm.restore(terminal), /fatal diagnostic/);
    } finally { vm.stop(); }
  });

  test(`${engine}: runtime resource failure during cleanup bypasses further unwinding and notifications`, () => {
    const vm = create(engine, 'after-unwind');
    try {
      pauseInCleanup(vm);
      vm.options.maxInstructions = vm.instructions;
      vm.state = 'running';
      const result = vm.run();
      assert.equal(result.fault?.name, 'InstructionLimitException');
      assert.equal(result.output, prefix + 'inner-cleanup\n');
      assert(vm.frames.some(frame => nameOf(vm, frame) === 'Thrower'));
    } finally { vm.stop(); }
  });

  test(`${engine}: after-unwind policy leaves ordinary unhandled throwing frames and finally blocks untouched`, () => {
    const compiled = compileToIL('using System; try { throw new Exception("plain"); } finally { Console.WriteLine("cleanup"); }',
      {pipeline: 'bound'});
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const options = {firstChanceFailurePolicy: 'after-unwind'};
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly, options)
      : new VirtualMachine(engine === 'reload' ? loadAssembly(compiled.assembly) : compiled.image, options);
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.message, 'plain');
      assert.equal(result.output, '');
      assert(vm.frames.length > 0);
      assert.equal(result.fault.exceptionEventContinuation, undefined);
    } finally { vm.stop(); }
  });
}
