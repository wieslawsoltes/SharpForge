import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {qualificationAssembly} from '../bench/vm/qualification-assembly.js';
import {floatSlots} from '../packages/runtime/src/execution/typed-stack.js';

test('typed slot visitors retain inherited references in logical holes like the ordinary roots iterator', () => {
  const assembly = qualificationAssembly({result: 'void', locals: ['object'], body: writer => writer.op('ret')});
  for (const preciseRoots of [false, true]) {
    const vm = new CilVirtualMachine(assembly, {typedNumericStack: true, preciseRoots});
    const reference = vm.heap.string('inherited root');
    const locals = vm.top.locals;
    const slots = floatSlots(locals);
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, '0');
    delete locals[0];
    try {
      Object.defineProperty(Array.prototype, '0', {value: reference, writable: true, configurable: true});
      assert.equal(locals[0], reference);
      assert.equal(Object.hasOwn(locals, '0'), false);
      assert.equal(slots.values[0], undefined, 'the retained raw backing has a cleared placeholder');
      vm.heap.collect();
      assert.equal(vm.heap.get(locals[0]).data, 'inherited root');
    } finally {
      if (descriptor) Object.defineProperty(Array.prototype, '0', descriptor);
      else delete Array.prototype[0];
      vm.stop();
    }
  }
});
