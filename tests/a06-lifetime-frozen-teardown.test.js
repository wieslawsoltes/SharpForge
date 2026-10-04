import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {literalString} from '../packages/runtime/src/execution/strings.js';

const engines = [
  ['source', compiled => new VirtualMachine(compiled.image)],
  ['reload', compiled => new VirtualMachine(loadAssembly(compiled.assembly))],
  ['CIL', compiled => new CilVirtualMachine(compiled.assembly)]
];

for (const [engine, create] of engines) {
  test(`A06 ${engine} stop releases restored frozen literals, scalar arrays and initializer sources`, () => {
    const compiled = compileToIL('Console.WriteLine("persistent");');
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = create(compiled);
    try {
      assert.equal(vm.run().state, 'terminated');
      const frozen = vm.heap.spaces.frozen;
      const literal = literalString(vm, 'persistent');
      const array = frozen.array('int', [11, 22]);
      const owner = Object.freeze({});
      const source = frozen.source(owner, 'initializer', Uint8Array.of(1, 2, 3, 4));
      const saved = vm.snapshot();
      const future = frozen.string('discarded-future');
      vm.restore(saved);
      assert.equal(literalString(vm, 'persistent'), literal);
      assert.equal(frozen.findSource(owner, 'initializer'), source);
      assert.equal(frozen.find('discarded-future'), null);
      assert.throws(() => vm.heap.get(future), {name: 'InvalidReferenceException'});
      frozen.sourceMetadata.set(owner, {field: 'derived metadata'});

      vm.heap.collect([], {generation: 2, compacting: true});
      assert.equal(vm.heap.get(literal).data, 'persistent');
      assert.deepEqual([...vm.heap.get(array).data], [11, 22]);
      assert.deepEqual([...vm.heap.get(source).data], [1, 2, 3, 4]);
      assert.ok(vm.heap.spaces.memoryInfo().frozen.reservedBytes > 0);

      vm.stop();
      for (const reference of [literal, array, source]) {
        assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
      }
      assert.equal(frozen.literals.size, 0);
      assert.equal(frozen.dataSources.size, 0);
      assert.equal(frozen.sourceMetadata.has(owner), false);
      assert.equal(vm.heap.spaces.memoryInfo().frozen.reservedBytes, 0);
      assert.equal(vm.heap.spaces.memoryInfo().frozen.objects, 0);
      assert.equal(vm.heap.stats.liveObjects, 0);
      assert.equal(vm.heap.stats.liveBytes, 0);

      const releasedBytes = vm.heap.stats.freedBytes;
      vm.stop();
      assert.equal(vm.heap.stats.freedBytes, releasedBytes, 'Repeated stop cannot reclaim a record twice');
      vm.heap.collect();
      assert.equal(vm.heap.stats.liveObjects, 0, 'Post-stop explicit collection remains supported');
    } finally {
      vm.stop();
      vm.heap.dispose();
    }
  });
}
