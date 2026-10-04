import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
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

  test(`SF-A08-B03 ${engine}: removed Dictionary keys and values stop retaining managed objects`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'string, object');
    try {
      const removedKey = platform.managed('removed key', 'string');
      const removed = platform.managed('removed value', 'string');
      call('Add', removedKey, removed);
      const retainedKey = platform.managed('retained key', 'string');
      const retained = platform.managed('retained value', 'string');
      call('Add', retainedKey, retained);
      const weakKey = platform.heap.createHandle(removedKey, {weak: true});
      const weak = platform.heap.createHandle(removed, {weak: true});
      const writes = [];
      vm.notifyWrite = event => writes.push(event);
      call('Remove', removedKey);
      platform.heap.collect([reference]);
      assert.equal(platform.heap.getHandle(weakKey), null);
      assert.equal(platform.heap.getHandle(weak), null);
      assert.equal(platform.native(call('get_Item', retainedKey)), 'retained value');
      assert.deepEqual([...dictionaryEntries(platform, reference)], [[retainedKey, retained]]);
      const cleared = writes.filter(event => event.kind === 'array' && event.value === null);
      assert.equal(cleared.length, 2, 'Payload removal retains debugger write notifications');
      platform.heap.releaseHandle(weakKey);
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

  test(`SF-A08-B03 ${engine}: JSON traverses only live Dictionary slots in native order`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'string, int');
    try {
      const key = value => platform.managed(value, 'string');
      call('Add', key('a'), 1); call('Add', key('b'), 2); call('Add', key('c'), 3);
      call('Remove', key('b')); call('Add', key('d'), 4); call('Remove', key('a'));
      const serializer = findContracts('System.Text.Json.JsonSerializer', 'Serialize')
        .find(member => member.parameters.length === 1 && member.parameters[0] === 'object');
      assert(serializer);
      assert.equal(platform.native(platform.invoke(serializer, [reference])), '{"d":4,"c":3}');
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: failed slot growth leaves existing Dictionary entries intact`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'int, int');
    const allocate = platform.heap.allocate;
    try {
      for (let key = 0; key < 4; key++) call('Add', key, key + 10);
      const index = platform.bclIndexes.get(platform.record(reference)).index;
      let reject = true;
      platform.heap.allocate = function(kind, type, ...args) {
        if (reject && type === 'int[]') {
          reject = false;
          throw new ManagedFault('OutOfMemoryException', 'Injected slot-storage allocation failure');
        }
        return allocate.call(this, kind, type, ...args);
      };
      assert.throws(() => call('Add', 4, 14), {name: 'OutOfMemoryException'});
      assert.equal(call('get_Count'), 4);
      assert.equal(Boolean(platform.native(call('ContainsKey', 4))), false);
      assert.strictEqual(platform.bclIndexes.get(platform.record(reference)).index, index);
      assert.deepEqual([...dictionaryEntries(platform, reference)], [[0, 10], [1, 11], [2, 12], [3, 13]]);
      call('Add', 4, 14);
      assert.equal(call('get_Item', 4), 14);
      assert.equal(call('get_Count'), 5);
    } finally {
      platform.heap.allocate = allocate;
      vm.stop();
    }
  });

  for (const field of ['$used', '$free', '$slots']) {
    test(`SF-A08-B03 ${engine}: failed legacy snapshot ${field} attachment preserves entries`, () => {
      const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'int, int');
      const replaceData = platform.heap.replaceData;
      try {
        call('Add', 0, 10); call('Add', 1, 11); call('Add', 2, 12);
        const current = platform.record(reference).data;
        const legacy = [];
        for (let index = 0; index < current.length; index += 2) {
          if (['$count', '$version', '$data'].includes(current[index])) legacy.push(current[index], current[index + 1]);
        }
        platform.heap.replaceData(reference, legacy);
        platform.heap.restore(platform.heap.snapshot());
        let reject = true;
        platform.heap.replaceData = function(target, items) {
          if (reject && target.h === reference.h && items.at(-2) === field) {
            reject = false;
            throw new ManagedFault('OutOfMemoryException', 'Injected legacy metadata attachment failure');
          }
          return replaceData.call(this, target, items);
        };
        const mutate = field === '$slots' ? () => call('Clear') : () => call('Remove', 1);
        assert.throws(mutate, {name: 'OutOfMemoryException'});
        assert.equal(call('get_Count'), 3);
        assert.deepEqual([...dictionaryEntries(platform, reference)], [[0, 10], [1, 11], [2, 12]]);
        assert.equal(call('get_Item', 1), 11);
        assert.equal(Boolean(platform.native(call('Remove', 1))), true);
        assert.equal(call('get_Count'), 2);
        assert.deepEqual([...dictionaryEntries(platform, reference)], [[0, 10], [2, 12]]);
      } finally {
        platform.heap.replaceData = replaceData;
        vm.stop();
      }
    });
  }
}
