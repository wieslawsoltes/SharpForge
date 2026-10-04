import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {clearFramePool, framePool, hasPendingFrameRetirement} from '../packages/runtime/src/execution/frame-pool.js';
import {executeSourceFusionBatch} from '../packages/runtime/src/execution/source-fusion-batch.js';
import {getSourceFusionPlan} from '../packages/runtime/src/execution/source-fusion.js';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

function setup(options = {}, image = sourceFusionFixture()) {
  const vm = new VirtualMachine(image, options);
  vm.top.locals[0] = 6;
  vm.top.locals[1] = 7;
  vm.state = 'running';
  return vm;
}

function execute(vm, budget) {
  const frame = vm.top;
  const group = getSourceFusionPlan(vm, vm.image.methods[frame.methodId]).groups[frame.pc];
  assert(group);
  return executeSourceFusionBatch(vm, frame, group, budget);
}

test('successful scalar blocks omit only an empty retirement flush', context => {
  const vm = setup();
  try {
    const pool = framePool(vm), before = framePoolStatistics(vm);
    const flush = context.mock.method(pool, 'flush');
    assert.equal(hasPendingFrameRetirement(vm), false);
    execute(vm, 14);
    assert.equal(flush.mock.callCount(), 0);
    assert.equal(vm.instructions, 14);
    assert.equal(vm.top.pc, 14);
    assert.deepEqual(framePoolStatistics(vm), before);
  } finally { vm.stop(); }
});

test('an initial pending retirement survives as a root and flushes at the scalar block boundary', context => {
  const vm = setup();
  try {
    const pool = framePool(vm), pending = pool.acquire(vm.image.methods[0], 3);
    const reference = vm.heap.object('System.Object', []);
    pending.locals[0] = reference;
    pool.retire(pending);
    vm.heap.collect();
    assert(vm.heap.get(reference));
    const flush = context.mock.method(pool, 'flush');
    execute(vm, 14);
    assert.equal(flush.mock.callCount(), 1);
    assert.equal(hasPendingFrameRetirement(vm), false);
    assert.equal(pending.locals.length, 0);
    assert.equal(framePoolStatistics(vm).released, 1);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), /reference/i);
  } finally { vm.stop(); }
});

for (const replace of [false, true]) {
  test(`scalar block host edits flush the actual current pool, replacement=${replace}`, context => {
    const vm = setup();
    try {
      let once = false, pending, flush;
      Object.defineProperty(vm.top.locals, 0, {configurable: true, get() {
        if (!once) {
          once = true;
          if (replace) clearFramePool(vm);
          const pool = framePool(vm);
          pending = pool.acquire(vm.image.methods[0], 3);
          pending.locals[0] = 99;
          pool.retire(pending);
          flush = context.mock.method(pool, 'flush');
        }
        return 6;
      }});
      execute(vm, 14);
      assert.equal(flush.mock.callCount(), 1);
      assert.equal(pending.locals.length, 0);
      assert.equal(framePoolStatistics(vm).released, 1);
      assert.equal(hasPendingFrameRetirement(vm), false);
    } finally { vm.stop(); }
  });
}

test('a failed scalar block always flushes and preserves its exact fault address', context => {
  const vm = setup({}, sourceFusionFixture({operator: '/'}));
  vm.top.locals[1] = 0;
  try {
    const frame = vm.top;
    const flush = context.mock.method(framePool(vm), 'flush');
    execute(vm, 14);
    assert.equal(flush.mock.callCount(), 1);
    assert.equal(vm.instructions, 3);
    assert.equal(frame.pc, 3);
    assert.equal(vm.state, 'faulted');
    assert.equal(vm.fault.name, 'DivideByZeroException');
  } finally { vm.stop(); }
});

test('call and return blocks keep unconditional retirement boundaries', context => {
  const image = sourceFusionFixture();
  const main = image.methods[0];
  main.locals = [];
  main.code = Int32Array.from([Op.CONST, 0, 0, Op.CALL, 1, 1, Op.NOP, 0, 0, Op.RET, 0, 0]);
  const parameter = {name: 'value', type: 'int', slot: 0};
  image.methods.push({...main, id: 1, name: 'Leaf', qualifiedName: 'Leaf', locals: [parameter], parameters: [parameter],
    code: Int32Array.from([Op.LDLOC, 0, 0, Op.RET, 0, 0])});
  const vm = new VirtualMachine(image);
  vm.state = 'running';
  try {
    const flush = context.mock.method(framePool(vm), 'flush');
    execute(vm, 2);
    const callee = vm.top;
    assert.equal(flush.mock.callCount(), 1);
    assert.equal(callee.methodId, 1);
    assert.equal(framePoolStatistics(vm).released, 0);
    execute(vm, 2);
    assert.equal(flush.mock.callCount(), 2);
    assert.equal(callee.id, undefined);
    assert.equal(callee.locals.length, 0);
    assert.equal(framePoolStatistics(vm).released, 1);
    assert.equal(vm.stack.at(-1), 6);
  } finally { vm.stop(); }
});

test('retirement elision preserves quota, pooling statistics and custom adapter boundaries', () => {
  for (const maxInstructions of [0.5, 2.5, 13.5, 14, 16, 100]) {
    for (const custom of [false, true]) {
      const pair = [false, true].map(sourceFusion => setup({sourceFusion, maxInstructions}));
      try {
        for (const vm of pair) {
          if (custom) {
            const original = vm.binary;
            vm.binary = function(...args) { return original.apply(this, args); };
          }
          vm.runSlice({instructionBudget: 100, timeBudgetMs: Infinity});
        }
        const state = vm => ({state: vm.state, instructions: vm.instructions, result: vm.returnValue,
          fault: vm.fault?.name ?? null, frameId: vm.frameId, stack: [...vm.stack], statistics: framePoolStatistics(vm),
          frames: vm.frames.map(frame => ({id: frame.id, methodId: frame.methodId, pc: frame.pc, locals: [...frame.locals]}))});
        assert.deepEqual(state(pair[1]), state(pair[0]));
      } finally { for (const vm of pair) vm.stop(); }
    }
  }
});

test('a custom adapter that stops execution keeps the ordinary disposal boundary', () => {
  const pair = [false, true].map(sourceFusion => setup({sourceFusion}));
  try {
    const observations = pair.map(vm => {
      const frame = vm.top, original = vm.binary;
      let calls = 0;
      vm.binary = function(...args) {
        calls++;
        const result = original.apply(this, args);
        this.stop();
        return result;
      };
      vm.runSlice({instructionBudget: 100, timeBudgetMs: Infinity});
      return {calls, state: vm.state, instructions: vm.instructions, stack: [...vm.stack], frames: vm.frames.length,
        retiredId: frame.id, retiredLocals: [...frame.locals], statistics: framePoolStatistics(vm)};
    });
    assert.deepEqual(observations[1], observations[0]);
    assert.equal(observations[1].calls, 1);
    assert.equal(observations[1].frames, 0);
    assert.equal(observations[1].retiredId, undefined);
    assert.deepEqual(observations[1].retiredLocals, []);
  } finally { for (const vm of pair) vm.stop(); }
});
