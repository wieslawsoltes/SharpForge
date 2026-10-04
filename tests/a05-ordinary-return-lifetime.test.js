import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {Op} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {stackAllocate, stackRegion} from '../packages/runtime/src/execution/stack-memory.js';
import {storePinnedLocal} from '../packages/runtime/src/execution/pinned.js';

const programs = new Map();
function make(route, finalizer) {
  if (!programs.has(finalizer)) {
    const program = compileToIL(`class Program {
      static int[] Make() {
        int[] value = new int[2]; value[0] = 42;
        ${finalizer ? 'try { return value; } finally { Console.Write("finally;"); }' : 'return value;'}
      }
      static int Main() { int[] value = Make(); return value[0]; }
    }`);
    assert.equal(program.success, true, JSON.stringify(program.diagnostics));
    programs.set(finalizer, program);
  }
  const program = programs.get(finalizer), options = {runtimeEvents: true, gcStress: 'instruction'};
  return route === 'cil' ? new CilVirtualMachine(program.assembly, options)
    : new VirtualMachine(route === 'source' ? program.image : program.assembly, options);
}

function returningMake(vm) {
  const frame = vm.top;
  return frame && (vm.inspector ? frame.method.name === 'Make' && frame.method.instructions[frame.pc]?.name === 'ret'
    : vm.image.methods[frame.methodId].name === 'Make' && vm.image.methods[frame.methodId].code[frame.pc * 3] === Op.RET);
}

for (const route of ['source', 'reload', 'cil']) for (const finalizer of [false, true]) {
  test(`${route}: ${finalizer ? 'finally' : 'ordinary'} reference return preserves roots while revoking pins and stack regions`, () => {
    const vm = make(route, finalizer);
    try {
      for (let count = 0; count < 200 && !returningMake(vm); count++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      }
      assert(returningMake(vm), vm.fault?.message);
      const frame = vm.top, id = frame.id, stack = vm.inspector ? frame.stack : vm.stack;
      const reference = stack.at(-1), pointer = stackAllocate(vm, 16);
      storePinnedLocal(vm, frame, 0, reference);
      const regions = frame.stackRegions, pins = frame.pinLeases, lease = pins.get(0);
      assert.equal(vm.heap.stats.hostStrongHandles, 1);
      for (let count = 0; count < 200 && vm.top === frame; count++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      }
      assert.notEqual(vm.top, frame, vm.fault?.message);
      assert.equal(vm.state, 'running');
      assert.equal((vm.inspector ? vm.top.stack : vm.stack).at(-1), reference);
      assert.equal(regions.size, 0);
      assert.equal(pins.size, 0);
      assert.equal(lease.active, false);
      assert.equal(vm.heap.stats.hostStrongHandles, 0);
      assert.throws(() => stackRegion(vm, pointer), {name: 'InvalidProgramException'});
      vm.heap.collect();
      assert.equal(vm.heap.get(reference).data[0], 42);
      const leaves = vm.runtimeEvents.read().filter(event => event.name === 'MethodLeave' && event.payload.frame === id);
      assert.equal(leaves.length, 1);
      assert.equal(leaves[0].payload.reason, 'return');
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(vm.returnValue, 42);
      assert.equal(result.output, finalizer ? 'finally;' : '');
      vm.heap.collect();
      assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
    } finally { vm.stop(); }
  });
}
