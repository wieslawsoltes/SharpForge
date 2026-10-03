import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('hashset-removal/Program.cs', fixture), 'utf8');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: HashSet removal and set algebra match .NET 10.0.5 slot order`, () => {
    const expected = readFileSync(new URL('hashset-removal-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: HashSet removal retains its backing array and cached index`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'HashSet', 'int');
    try {
      for (let value = 0; value < 512; value++) call('Add', value);
      const record = platform.record(reference);
      const index = platform.bclIndexes.get(record).index;
      const storage = platform.get(reference, '$data');
      const data = platform.heap.get(storage).data;
      const allocations = platform.heap.stats.allocations;
      for (let value = 0; value < 512; value++) {
        assert.equal(Boolean(platform.native(call('Remove', value))), true);
        assert.equal(Boolean(platform.native(call('Contains', value))), false);
        assert.strictEqual(platform.bclIndexes.get(record).index, index, 'Removal must not rebuild the lookup Map');
        assert.strictEqual(platform.heap.get(storage).data, data, 'Removal must not replace the backing array');
      }
      assert.equal(index.size, 0);
      assert.equal(call('get_Count'), 0);
      assert.equal(platform.heap.stats.allocations, allocations);
      call('Add', 1024);
      assert.equal(platform.heap.stats.allocations, allocations, 'A free slot is reused without managed allocation');
      assert.equal(Boolean(platform.native(call('Contains', 1024))), true);
    } finally { vm.stop(); }
  });
}
