import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, decimalParse} from '@sharpforge/bytecode';
import {CilVirtualMachine, VirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool} from '../packages/runtime/src/execution/frame-pool.js';
import {managedFixture} from './managed-fixtures.js';

const overflow = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};
function sourceImage() {
  const method = id => ({id, name: 'Method' + id, qualifiedName: 'Method' + id, owner: null,
    isStatic: true, returnType: 'int', parameters: [], locals: [], handlers: [],
    code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])});
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [42], methods: [method(0), method(1)],
    types: [], statics: [], sources: [], sequencePoints: []};
}

const local = () => ({type: 'decimal', name: 'added', slot: 0});
const leave = vm => { popPooledFrame(vm); flushFramePool(vm); };

test('source: warmed method quota includes an in-place declared local growth before frame allocation', () => {
  const vm = new VirtualMachine(sourceImage(), {maxStackBytes: 64});
  try {
    vm.call(1, []);
    leave(vm);
    const allocated = framePoolStatistics(vm).framesAllocated;
    vm.image.methods[1].locals.push(local());
    vm.options.maxStackBytes = 63; // Main24 + changed callee40.
    assert.throws(() => vm.call(1, []), overflow);
    assert.equal(vm.frames.length, 1);
    assert.equal(framePoolStatistics(vm).framesAllocated, allocated);
    vm.options.maxStackBytes = 64;
    vm.call(1, []);
    assert.equal(vm.frames.length, 2);
    leave(vm);
    assert.equal(vm.run().state, 'terminated');
  } finally { vm.stop(); }
});

test('source: a live frame observes metadata-only growth before another instruction or counter update', () => {
  const vm = new VirtualMachine(sourceImage(), {maxStackBytes: 24});
  try {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
    const frame = vm.top, pc = frame.pc, instructions = vm.instructions;
    assert.equal(frame.locals.length, 0);
    vm.image.methods[0].locals.push(local());
    assert.equal(vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity}), 'faulted');
    assert.equal(vm.fault.name, overflow.name);
    assert.equal(vm.fault.message, overflow.message);
    assert.equal(frame.pc, pc);
    assert.equal(vm.instructions, instructions);
    vm.options.maxStackBytes = 40;
    vm.state = 'running';
    assert.equal(vm.run().state, 'terminated');
    assert.equal(vm.returnValue, 42);
  } finally { vm.stop(); }
});

function cilImage() {
  return managedFixture({methods: [
    {name: 'Main', maxStack: 1, result: 'int', body: writer => writer.integer(42).op('ret')},
    {name: 'Target', maxStack: 1, result: 'int', body: writer => writer.integer(42).op('ret')}
  ]});
}

for (const member of ['locals', 'parameters']) {
  test(`CIL: a warmed method reserves widened ${member} at the exact byte boundary`, () => {
    const vm = new CilVirtualMachine(cilImage(), {maxStackBytes: 64, maxStackValues: 1});
    try {
      const target = [...vm.inspector.methods.values()].find(method => method.name === 'Target');
      const method = vm.inspector.getMethod(target.token);
      vm.call(method.token, []);
      leave(vm);
      const allocated = framePoolStatistics(vm).framesAllocated;
      const values = member === 'locals' ? method.locals : method.signature.parameters;
      values.push('decimal');
      const args = member === 'parameters' ? [decimalParse('1.25')] : [];
      vm.options.maxStackBytes = 63; // Main24 + changed callee40.
      assert.throws(() => vm.call(method.token, args), overflow);
      assert.equal(vm.frames.length, 1);
      assert.equal(framePoolStatistics(vm).framesAllocated, allocated);
      vm.options.maxStackBytes = 64;
      vm.call(method.token, args);
      assert.equal(vm.frames.length, 2);
      leave(vm);
      assert.equal(vm.run().returnValue, 42);
    } finally { vm.stop(); }
  });

  test(`CIL: live ${member} growth is admitted again before step or direct push`, () => {
    const vm = new CilVirtualMachine(cilImage(), {maxStackBytes: 24});
    try {
      vm.step();
      const frame = vm.top, pc = frame.pc, instructions = vm.instructions;
      const values = member === 'locals' ? frame.method.locals : frame.method.signature.parameters;
      values.push('decimal');
      assert.throws(() => vm.step(), overflow);
      assert.throws(() => vm.push(7), overflow);
      assert.equal(frame.pc, pc);
      assert.equal(vm.instructions, instructions);
      assert.deepEqual(frame.stack, [42]);
      vm.options.maxStackBytes = 40;
      assert.equal(vm.run().returnValue, 42);
    } finally { vm.stop(); }
  });
}
