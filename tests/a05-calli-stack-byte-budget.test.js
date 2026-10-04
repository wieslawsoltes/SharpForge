import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSignature} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const integer = {kind: 'primitive', name: 'int'};
const array = {kind: 'szarray', element: integer};
const signature = (returnType, parameters) => ({kind: 'method', hasThis: false, returnType, parameters});
const targetSignature = signature(integer, [array]);
const pointer = {kind: 'functionPointer', signature: targetSignature};

function fixture() {
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', maxStack: 3,
      localsSignature: encodeSignature({kind: 'locals', types: [pointer, array]}),
      body(writer, context) {
        writer.op('ldftn', context.methods.get('Program.Target')).op('stloc.0');
        writer.op('ldc.i4.1').op('newarr', context.resolve('System.Int32')).op('stloc.1');
        writer.op('ldloc.1').op('ldc.i4.0').op('ldc.i4', 41).op('stelem.i4');
        writer.op('ldloc.0').op('ldloc.1').op('call', context.methods.get('Program.Apply')).op('ret');
      }},
    {name: 'Apply', maxStack: 2, signature: encodeSignature(signature(integer, [pointer, array])),
      localsSignature: encodeSignature({kind: 'locals', types: [pointer]}),
      body(writer, context) {
        const standalone = context.md.add(17, [context.md.blob(encodeSignature(targetSignature))]);
        writer.op('ldarg.0').op('stloc.0').op('ldarg.1').op('ldloc.0').op('calli', standalone).op('ret');
      }},
    {name: 'Target', result: 'int', parameters: ['int[]'], maxStack: 2, body(writer) {
      writer.op('ldarg.0').op('ldc.i4.0').op('ldelem.i4').op('ldc.i4.1').op('add').op('ret');
    }}
  ]}]);
}

// Main: 16 header + 3 evaluation slots + 2 locals = 56 bytes.
// Apply: 16 header + 2 evaluation slots + 2 arguments + 1 local = 56 bytes.
// Target: 16 header + 2 evaluation slots + 1 argument = 40 bytes.
const suspendedBytes = 112;
const totalBytes = 152;

for (const nativeIntBits of [32, 64]) {
  test(`typed function-pointer locals and arguments retain exact byte admission (${nativeIntBits}-bit ABI)`, () => {
    for (const maxStackBytes of [totalBytes - 1, totalBytes]) {
      const vm = new CilVirtualMachine(fixture(), {nativeIntBits, maxStackBytes});
      try {
        const result = vm.run();
        if (maxStackBytes === totalBytes) {
          assert.equal(result.state, 'terminated', result.fault?.message);
          assert.equal(result.returnValue, 42);
        } else {
          assert.equal(result.state, 'faulted');
          assert.equal(result.fault?.name, 'StackOverflowException');
        }
      } finally { vm.stop(); }
    }
  });

  test(`function-pointer quota preflight and replay preserve owned pointers (${nativeIntBits}-bit ABI)`, () => {
    const vm = new CilVirtualMachine(fixture(), {nativeIntBits, maxStackBytes: totalBytes});
    try {
      vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity,
        onInstruction: instruction => instruction.name === 'calli'});
      assert.equal(vm.state, 'paused');
      assert.equal(vm.frames.length, 2);
      const pointerValue = vm.top.stack.at(-1), snapshot = vm.snapshot();
      const frames = vm.frames, revision = vm.heap.mutationRevision;
      vm.options.maxStackBytes = suspendedBytes - 1;
      assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
      assert.equal(vm.frames, frames);
      assert.equal(vm.heap.mutationRevision, revision);
      for (let replay = 0; replay < 2; replay++) {
        vm.options.maxStackBytes = totalBytes;
        vm.restore(snapshot);
        assert.equal(vm.top.stack.at(-1), pointerValue);
        vm.heap.collect();
        vm.state = 'running';
        assert.equal(vm.run().returnValue, 42);
        assert.equal(vm.state, 'terminated');
      }
    } finally { vm.stop(); }
  });
}
