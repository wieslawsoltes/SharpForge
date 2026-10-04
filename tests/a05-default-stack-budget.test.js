import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {hasPendingFrameRetirement} from '../packages/runtime/src/execution/frame-pool.js';

const defaultStackBytes = 4 * 1024 * 1024;
const engines = ['source', 'reload', 'cil'];
const countSource = depth => `class Program {
  static int Count(int remaining) {
    if (remaining == 0) { Console.WriteLine("bottom"); return 0; }
    return Count(remaining - 1) + 1;
  }
  static void Main() { Console.WriteLine(Count(${depth})); }
}`;

function compiled(source) {
  const artifact = compileToIL(source);
  assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
  return artifact;
}

function machine(artifact, engine, options = {}) {
  return engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
    : new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, options);
}

for (const engine of engines) {
  test(`${engine}: default byte admission executes 10,000 recursive calls plus entry frames`, () => {
    const vm = machine(compiled(countSource(10_000)), engine);
    let deepest = 0;
    vm.onOutput = () => {
      deepest = Math.max(deepest, vm.frames.length);
      vm.heap.collect();
    };
    try {
      assert.equal(vm.options.maxFrames, Infinity);
      assert.equal(vm.options.maxStackBytes, defaultStackBytes);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, 'bottom\n10000\n');
      assert.ok(deepest >= 10_002, 'Count(10000)..Count(0) and its managed caller must coexist');
      assert.equal(vm.frames.length, 0);
      assert.equal(hasPendingFrameRetirement(vm), false);
    } finally { vm.stop(); }
  });

  test(`${engine}: the default byte limit overflows fatally before an enclosing catch can run`, () => {
    const artifact = compiled(`using System; class Program {
      static void Recur() { try { Recur(); } catch (Exception) { Console.WriteLine("caught"); } }
      static void Main() { Recur(); }
    }`);
    const vm = machine(artifact, engine);
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'StackOverflowException');
      assert.equal(result.fault.message, 'Managed stack byte budget exceeded');
      assert.equal(result.fault.fatal, true);
      assert.equal(result.output, '');
      assert.ok(vm.frames.length > 512, 'The removed depth default must not cause this fault');
      assert.ok(vm.frames.length <= defaultStackBytes / 16, 'Every frame has a charged header');
      assert.ok(result.stats.instructions < vm.options.maxInstructions);
      assert.notEqual(result.exitCode, 0);
    } finally { vm.stop(); }
    assert.equal(vm.frames.length, 0);
    assert.equal(hasPendingFrameRetirement(vm), false);
  });

  test(`${engine}: an explicit 512-frame ceiling still rejects atomically and bypasses catch`, () => {
    const artifact = compiled(`using System; class Program {
      static int Count(int n) { if (n == 0) return 0; return Count(n - 1) + 1; }
      static void Main() { try { Console.WriteLine(Count(10000)); } catch (Exception) { Console.WriteLine("caught"); } }
    }`);
    const vm = machine(artifact, engine, {maxFrames: 512});
    try {
      assert.equal(vm.options.maxStackBytes, defaultStackBytes);
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'StackOverflowException');
      assert.equal(result.output, '');
      assert.equal(vm.frames.length, 512);
    } finally { vm.stop(); }
  });

  test(`${engine}: default admission preserves deep roots, snapshot replay and stop releases reservations`, () => {
    const artifact = compiled(`class Box { public int Value; } class Program {
      static int Read(int n, Box box) { if (n == 0) return box.Value; return Read(n - 1, box); }
      static void Main() { Box box = new Box(); box.Value = 42; Console.WriteLine(Read(800, box)); }
    }`);
    const vm = machine(artifact, engine);
    try {
      while (vm.frames.length < 600 && ['ready', 'running'].includes(vm.state)) {
        vm.runSlice({instructionBudget: 100, timeBudgetMs: Infinity});
      }
      assert.ok(vm.frames.length >= 600);
      vm.heap.collect();
      const saved = vm.snapshot();
      assert.equal(vm.run().output, '42\n');
      vm.restore(saved);
      if (vm.state === 'paused') vm.state = 'running';
      vm.heap.collect();
      assert.equal(vm.run().output, '42\n');
      vm.restore(saved);
      vm.stop();
      assert.equal(vm.allFrames().length, 0);
      // A fresh entry after cancellation must not inherit the suspended stack's charge.
      vm.options.maxStackBytes = 256;
      vm.call(engine === 'cil' ? vm.report.entryPoint : vm.image.entryPoint, []);
      assert.equal(vm.frames.length, 1);
    } finally { vm.stop(); }
  });
}

test('source fusion modes share the same default quota and deep-call result', () => {
  const artifact = compiled(countSource(10_000));
  const vm = machine(artifact, 'source', {sourceFusion: false});
  try {
    assert.equal(vm.options.maxStackBytes, defaultStackBytes);
    assert.equal(vm.run().output, 'bottom\n10000\n');
    assert.equal(vm.state, 'terminated', vm.fault?.message);
  } finally { vm.stop(); }
});
