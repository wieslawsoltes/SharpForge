import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {valueLayout} from '../packages/runtime/src/execution/value-layout.js';
import {controlFixture} from './support/control-fixture.js';

const overflow = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};
const types = [['System.ArgIterator', 24], ['System.RuntimeArgumentHandle', 8],
  ['System.TypedReference', 16], ['typedref', 16]];

function sourceImage(type) {
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [42], types: [], statics: [],
    sources: [], sequencePoints: [], methods: [{id: 0, name: 'Main', qualifiedName: 'Main', owner: null,
      isStatic: true, returnType: 'int', parameters: [], handlers: [], locals: [{name: 'carrier', type, slot: 0}],
      code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])}]};
}

for (const engine of ['source', 'cil']) for (const nativeIntBits of [32, 64]) for (const [type, bytes] of types) {
  test(`${engine} ABI${nativeIntBits}: ${type} reserves its exact logical stack width`, () => {
    const input = engine === 'source' ? sourceImage(type) : controlFixture([{name: 'Program', methods: [
      {name: 'Main', result: 'int', maxStack: 1, locals: [type], body: writer => writer.op('ldc.i4', 42).op('ret')}
    ]}]);
    const VM = engine === 'source' ? VirtualMachine : CilVirtualMachine;
    // 16-byte header + one 8-byte evaluation slot + the runtime carrier.
    assert.throws(() => new VM(input, {nativeIntBits, maxStackBytes: 24 + bytes - 1}), overflow);
    const vm = new VM(input, {nativeIntBits, maxStackBytes: 24 + bytes});
    try {
      assert.throws(() => valueLayout(vm, type), {name: 'NotSupportedException'},
        'logical stack admission must not grant unsupported raw layout access');
      const snapshot = vm.snapshot();
      vm.options.maxStackBytes--;
      const frames = vm.frames;
      assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
      assert.equal(vm.frames, frames, 'rejected byte admission does not replace live frame storage');
      vm.options.maxStackBytes++;
      vm.restore(snapshot);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.returnValue, 42);
    } finally { vm.stop(); }
  });
}
