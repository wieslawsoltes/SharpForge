import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {dictionaryEntries} from '@sharpforge/bcl-collections';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('dictionary-removal/Program.cs', fixture), 'utf8');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: Dictionary free-slot reuse matches .NET 10.0.5`, () => {
    const expected = readFileSync(new URL('dictionary-removal-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: Dictionary removals retain backing arrays and the existing index`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'int, int');
    try {
      for (let key = 0; key < 512; key++) call('Add', key, key * 2);
      const record = platform.record(reference);
      const index = platform.bclIndexes.get(record).index;
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const allocations = platform.heap.stats.allocations;
      const revision = platform.get(reference, '$version');
      assert.equal(Boolean(platform.native(call('Remove', -1))), false);
      assert.equal(platform.get(reference, '$version'), revision);
      for (let key = 0; key < 512; key++) {
        assert.equal(Boolean(platform.native(call('Remove', key))), true);
        assert.equal(Boolean(platform.native(call('ContainsKey', key))), false);
        assert.strictEqual(platform.bclIndexes.get(record).index, index, 'Removal must not rebuild the lookup Map');
        assert.strictEqual(platform.heap.get(storage).data, items, 'Removal must not replace the backing array');
      }
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(index.size, 0);
      assert.equal(call('get_Count'), 0);
      call('Add', 1024, 2048);
      assert.equal(platform.heap.stats.allocations, allocations, 'A free slot is reused without managed allocation');
      assert.deepEqual([...dictionaryEntries(platform, reference)], [[1024, 2048]]);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: removed Dictionary values stop retaining managed objects`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'int, object');
    try {
      const removed = platform.managed('removed value', 'string');
      call('Add', 1, removed);
      const retained = platform.managed('retained value', 'string');
      call('Add', 2, retained);
      const weak = platform.heap.createHandle(removed, {weak: true});
      call('Remove', 1);
      platform.heap.collect([reference]);
      assert.equal(platform.heap.getHandle(weak), null);
      assert.equal(platform.native(call('get_Item', 2)), 'retained value');
      assert.deepEqual([...dictionaryEntries(platform, reference)], [[2, retained]]);
      platform.heap.releaseHandle(weak);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: Dictionary holes and free slots survive heap restore`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'int, int');
    try {
      for (let key = 0; key < 5; key++) call('Add', key, key + 10);
      call('Remove', 1); call('Remove', 3);
      const saved = platform.heap.snapshot();
      const finish = () => {
        call('Add', 6, 16); call('Add', 7, 17); call('Remove', 0);
        return [...dictionaryEntries(platform, reference)];
      };
      const expected = finish();
      platform.heap.restore(saved);
      assert.deepEqual(finish(), expected);
      assert.equal(Boolean(platform.native(call('ContainsKey', 1))), false);
      assert.equal(call('get_Item', 6), 16);
    } finally { vm.stop(); }
  });
}
