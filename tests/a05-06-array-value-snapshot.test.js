import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {createArray} from '../packages/runtime/src/execution/arrays.js';
import {fillArray} from '../packages/runtime/src/execution/array-runtime.js';

const compiled = compileToIL('Console.WriteLine(42);');
assert(compiled.success, JSON.stringify(compiled.diagnostics));

for (const engine of ['source', 'cil']) for (const type of ['int', 'string']) {
  test(`${engine}: pending ${type} array fill rejects forged value type before replacing captured storage`, () => {
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    const value = type === 'int' ? 7 : vm.heap.string('saved');
    fillArray(vm, createArray(vm, type, [256]), value, {synchronous: false});
    const correct = vm.snapshot(), invalid = vm.snapshot();
    const badValue = type === 'int' ? vm.heap.string('not an integer') : vm.heap.object('object', []);
    // Add the valid but incompatible owner to the capture, isolating the type check from stale-reference checks.
    const withOwner = vm.snapshot();
    withOwner.frames.at(-1).intrinsicContinuation.value = badValue;
    const frames = vm.frames, records = vm.heap.records;
    assert.throws(() => vm.restore(withOwner), /array continuation .*value type/);
    assert.equal(vm.frames, frames);
    assert.equal(vm.heap.records, records);
    invalid.frames.at(-1).intrinsicContinuation.value = undefined;
    assert.throws(() => vm.restore(invalid), /array continuation .*value type/);
    vm.restore(correct);
    assert.equal(vm.top.intrinsicContinuation.operation, 'Fill');
    vm.stop();
  });
}
