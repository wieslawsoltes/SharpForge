import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {FramePool, framePoolStatistics} from '../packages/runtime/src/execution/frame-pool.js';
import {typedNumericSlots, numericSlots} from '../packages/runtime/src/execution/typed-stack.js';

const method = {signature: {isStatic: true, parameters: ['object']}, locals: ['object', 'double'], maxStack: 4};

test('T09 pool reuses frame and slot arrays after the continuation boundary and clears typed payloads', () => {
  const vm = {options: {}, inspector: {}};
  const pool = new FramePool(vm), first = pool.acquire(method);
  const locals = first.locals, args = first.args;
  first.args.push({h: 1, g: 1});
  first.locals[0] = {h: 2, g: 1};
  first.locals[1] = {float: 'r8', value: 1.5};
  first.locals = typedNumericSlots(first.locals).array;
  first.delegateContinuation = {args: [{h: 3, g: 1}]};
  pool.retire(first);
  assert.equal(first.args.length, 1, 'return/EH continuation may still inspect popped slots');
  pool.flush();
  assert.equal(first.args.length, 0);
  assert.equal(first.locals.length, 0);
  assert.equal(first.delegateContinuation, undefined);
  assert(numericSlots(first.locals).tags.every(tag => tag === 0));
  const second = pool.acquire(method);
  assert.equal(first, second);
  assert.equal(second.args, args);
  assert.equal(numericSlots(second.locals).values, locals);
  assert.equal(second.locals[0], undefined);
  assert.equal(pool.statistics.framesAllocated, 1);
  assert.equal(pool.statistics.reused, 1);
});

test('T09 pool rejects malformed capacities and bounds retained storage', () => {
  assert.throws(() => new FramePool({options: {framePoolBytes: -1}}), RangeError);
  const pool = new FramePool({options: {framePoolBytes: 0}, inspector: {}});
  for (const maxStack of [-1, NaN, 1.5, 65536]) {
    assert.throws(() => pool.acquire({...method, maxStack}), /maxstack/);
  }
  const frame = pool.acquire(method);
  pool.retire(frame);
  pool.flush();
  assert.equal(pool.bytes, 0);
  assert.notEqual(pool.acquire(method), frame);
});

const source = `class Program {
  static int Sum(int depth) { if (depth == 0) return 0; return depth + Sum(depth - 1); }
  static void Main() { for (int i = 0; i < 3; i++) System.Console.WriteLine(Sum(80)); }
}`;
for (const engine of ['source', 'cil']) {
  test(`T09 ${engine}: warm recursion reuses slots; stop and restore discard derived storage`, () => {
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    const snapshot = vm.snapshot();
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '3240\n3240\n3240\n');
    const statistics = framePoolStatistics(vm);
    assert(statistics.reused >= 162);
    assert(statistics.framesAllocated < 100);
    for (const frame of vm.framePool.cached) {
      assert.equal(frame.locals.length, 0);
      assert.equal(frame.args.length, 0);
      assert.equal(frame.stack.length, 0);
    }
    vm.restore(snapshot);
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
    assert.equal(vm.run().output, result.output);
    vm.stop();
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
  });
  test(`T09 ${engine}: cancellation releases active and parked slots without invalidating a saved snapshot`, () => {
    const compiled = compileToIL(source);
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    vm.runSlice({instructionBudget: 25, timeBudgetMs: 1000});
    vm.scheduler.ensure();
    const snapshot = vm.snapshot();
    vm.stop();
    vm.heap.collect();
    assert.equal(vm.frames.length, 0);
    assert.equal(vm.frameIndex.size, 0);
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
    vm.restore(snapshot);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '3240\n3240\n3240\n');
  });
}
