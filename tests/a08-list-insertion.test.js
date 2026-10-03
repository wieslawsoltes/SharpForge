import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('list-insertion/Program.cs', fixture), 'utf8');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: List Insert/AddRange results and growth match .NET 10.0.5`, () => {
    const expected = readFileSync(new URL('list-insertion-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List insertion reuses spare capacity and reports shifted/appended slots`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      call('set_Capacity', 8);
      for (let value = 0; value < 4; value++) call('Add', value);
      const extra = platform.heap.allocate('array', 'int[]', [8, 7]);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const allocations = platform.heap.stats.allocations;
      const writes = [];
      vm.onWrite = event => { if (event.kind === 'array') writes.push([event.index, event.value]); };
      call('Insert', 1, 9);
      assert.deepEqual(writes, [[4, 3], [3, 2], [2, 1], [1, 9]]);
      writes.length = 0;
      call('AddRange', extra);
      assert.deepEqual(writes, [[5, 8], [6, 7]]);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [0, 9, 1, 2, 3, 8, 7, null]);
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(call('get_Count'), 7);
      assert.equal(call('get_Capacity'), 8);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List insertion reserves one backing array per required growth`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    const allocate = platform.heap.allocate;
    try {
      for (let value = 1; value <= 4; value++) call('Add', value);
      const extra = platform.heap.allocate('array', 'int[]', [6, 7, 8, 9, 10]);
      let allocations = 0;
      platform.heap.allocate = function(kind, type, ...args) {
        if (kind === 'array' && type === 'object[]') allocations++;
        return allocate.call(this, kind, type, ...args);
      };
      call('Insert', 4, 5);
      assert.equal(allocations, 1);
      assert.equal(call('get_Capacity'), 8);
      call('AddRange', extra);
      assert.equal(allocations, 2);
      assert.equal(call('get_Capacity'), 16);
      assert.deepEqual(platform.heap.get(platform.get(reference, '$data')).data.slice(0, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      platform.heap.allocate = allocate;
      vm.stop();
    }
  });

  test(`SF-A08-B03 ${engine}: List insertion validates before mutation and preserves empty-input versions`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      const empty = platform.heap.allocate('array', 'int[]', []);
      call('AddRange', empty);
      assert.equal(call('get_Count'), 0);
      assert.equal(platform.get(reference, '$data'), null);
      call('Add', 1); call('Add', 2);
      const revision = platform.get(reference, '$version');
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      for (const index of [-1, 3, 0.5]) assert.throws(() => call('Insert', index, 7), {name: 'ArgumentOutOfRangeException'});
      assert.throws(() => call('AddRange', null), {name: 'NullReferenceException'});
      const nonArray = platform.managed('not an array', 'string');
      assert.throws(() => call('AddRange', nonArray), {name: 'ArgumentException'});
      assert.equal(platform.get(reference, '$version'), revision);
      assert.deepEqual(items, [1, 2, null, null]);
      call('AddRange', empty);
      assert.equal(platform.get(reference, '$version'), revision + 1);
      assert.strictEqual(platform.heap.get(storage).data, items);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: failed List growth leaves count, values and version intact`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    const allocate = platform.heap.allocate;
    try {
      for (let value = 0; value < 4; value++) call('Add', value);
      const extra = platform.heap.allocate('array', 'int[]', [4, 5]);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const revision = platform.get(reference, '$version');
      platform.heap.allocate = () => { throw new ManagedFault('OutOfMemoryException', 'Growth allocation disabled'); };
      assert.throws(() => call('Insert', 1, 9), {name: 'OutOfMemoryException'});
      assert.throws(() => call('AddRange', extra), {name: 'OutOfMemoryException'});
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [0, 1, 2, 3]);
      assert.equal(call('get_Count'), 4);
      assert.equal(platform.get(reference, '$version'), revision);
      platform.heap.allocate = allocate;
      call('Insert', 1, 9); call('AddRange', extra);
      assert.deepEqual(platform.heap.get(platform.get(reference, '$data')).data, [0, 9, 1, 2, 3, 4, 5, null]);
    } finally {
      platform.heap.allocate = allocate;
      vm.stop();
    }
  });

  test(`SF-A08-B03 ${engine}: List growth preserves managed inputs across collection and heap restore`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    try {
      call('set_Capacity', 1);
      call('Add', platform.managed('existing', 'string'));
      const added = platform.managed('inserted', 'string');
      platform.heap.threshold = platform.heap.stats.liveBytes;
      call('Insert', 0, added);
      const extra = platform.heap.allocate('array', 'string[]', [added, null]);
      const saved = platform.heap.snapshot();
      const finish = () => {
        platform.heap.threshold = platform.heap.stats.liveBytes;
        call('AddRange', extra);
        platform.heap.collect([reference]);
        return platform.heap.get(platform.get(reference, '$data')).data.slice(0, 4).map(value => platform.native(value));
      };
      assert.deepEqual(finish(), ['inserted', 'existing', 'inserted', null]);
      platform.heap.restore(saved);
      assert.deepEqual(finish(), ['inserted', 'existing', 'inserted', null]);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: AddRange reads aliased object storage safely across growth`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'object');
    try {
      call('set_Capacity', 2);
      call('Add', platform.managed('first', 'string'));
      call('Add', platform.managed('second', 'string'));
      const original = platform.get(reference, '$data');
      platform.heap.threshold = platform.heap.stats.liveBytes;
      call('AddRange', original);
      assert.notStrictEqual(platform.get(reference, '$data'), original);
      assert.deepEqual(platform.heap.get(original).data.map(value => platform.native(value)), ['first', 'second']);
      const current = platform.heap.get(platform.get(reference, '$data')).data.map(value => platform.native(value));
      assert.deepEqual(current, ['first', 'second', 'first', 'second']);
    } finally { vm.stop(); }
  });
}
