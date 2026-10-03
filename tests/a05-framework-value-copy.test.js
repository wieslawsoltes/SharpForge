import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {boxValue, copyValue} from '../packages/runtime/src/execution/value-types.js';

for (const engine of ['source', 'cil']) {
  test(`T03 ${engine}: boxing a framework value copies its fields and retains immutable floats`, () => {
    const compiled = compileToIL('Console.WriteLine(1);');
    assert(compiled.success, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(compiled.assembly) : new VirtualMachine(compiled.image);
    const type = 'Microsoft.UI.Xaml.Thickness';
    const original = vm.platform.construct(type, [2]);
    const left = vm.platform.get(original, 'Left');
    if (engine === 'cil') assert(Object.isFrozen(left));
    const boxed = boxValue(vm, original, type), copied = vm.heap.get(boxed).data[0];
    assert.notEqual(copied, original);
    vm.platform.set(original, 'Left', vm.platform.managed(9, 'double'));
    assert.equal(vm.value(vm.platform.get(copied, 'Left')), 2);
    assert.equal(vm.value(vm.platform.get(original, 'Left')), 9);
    vm.heap.collect([boxed]);
    assert.equal(vm.value(vm.platform.get(vm.heap.get(boxed).data[0], 'Left')), 2);
    assert.throws(() => copyValue(vm, {mutable: true}), /Mutable host objects/);
    vm.stop();
  });
}
