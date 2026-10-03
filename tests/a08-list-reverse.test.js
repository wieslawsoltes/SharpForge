import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('list-reverse/Program.cs', fixture), 'utf8');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: List Reverse matches .NET 10.0.5 values and capacity`, () => {
    const expected = readFileSync(new URL('list-reverse-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: Reverse swaps only the live prefix without replacing its storage`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      call('set_Capacity', 8);
      for (let value = 1; value <= 5; value++) call('Add', value);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const allocations = platform.heap.stats.allocations;
      const writes = [];
      const fields = [];
      vm.onWrite = event => {
        if (event.kind === 'array') writes.push([event.index, event.oldValue, event.value]);
        else if (event.kind === 'field') fields.push([event.property, event.oldValue, event.value]);
      };
      call('Reverse');
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [5, 4, 3, 2, 1, null, null, null]);
      assert.deepEqual(writes, [[0, 1, 5], [4, 5, 1], [1, 2, 4], [3, 4, 2]]);
      assert.deepEqual(fields, [['$count', 5, 5], ['$version', 5, 6]]);
      assert.equal(call('get_Count'), 5);
      assert.equal(call('get_Capacity'), 8);
      assert.equal(platform.heap.stats.allocations, allocations);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: empty and singleton Reverse perform no slot writes but invalidate enumeration`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      let writes = 0;
      vm.onWrite = event => { if (event.kind === 'array') writes++; };
      const initial = platform.get(reference, '$version');
      const iterator = call('GetEnumerator');
      const move = findContracts(platform.record(iterator).type, 'MoveNext')[0];
      call('Reverse');
      assert.equal(platform.get(reference, '$data'), null);
      assert.equal(platform.get(reference, '$version'), initial + 1);
      assert.throws(() => platform.invoke(move, [iterator]), {name: 'InvalidOperationException'});
      call('set_Capacity', 8);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      call('Reverse');
      assert.equal(writes, 0);
      call('Add', 7);
      writes = 0;
      const revision = platform.get(reference, '$version');
      call('Reverse');
      assert.equal(writes, 0);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [7, null, null, null, null, null, null, null]);
      assert.equal(platform.get(reference, '$version'), revision + 1);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: a null Reverse receiver faults before mutation`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      call('Add', 1);
      const revision = platform.get(reference, '$version');
      const descriptor = findContracts(platform.record(reference).type, 'Reverse')[0];
      assert.throws(() => platform.invoke(descriptor, [null]), {name: 'NullReferenceException'});
      assert.equal(call('get_Item', 0), 1);
      assert.equal(platform.get(reference, '$version'), revision);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: Reverse protects displaced references when every write observer collects`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    const weak = [];
    try {
      for (const text of ['first', 'second', 'middle', 'fourth', 'last']) {
        const value = platform.managed(text, 'string');
        call('Add', value);
        weak.push(platform.heap.createHandle(value, {weak: true}));
      }
      const pins = platform.heap.pins.length;
      const handles = platform.heap.stats.hostStrongHandles;
      const rootLengths = [];
      let writes = 0;
      vm.onWrite = event => {
        if (event.kind !== 'array') return;
        writes++;
        rootLengths.push(platform.heap.pins.length);
        platform.heap.collect();
        assert(weak.every(handle => platform.heap.getHandle(handle) !== null));
        assert.equal(call('get_Count'), 5);
      };
      call('Reverse');
      assert.equal(writes, 4);
      assert.deepEqual(rootLengths, [pins + 2, pins + 2, pins + 2, pins + 2]);
      assert.equal(platform.heap.pins.length, pins);
      assert.equal(platform.heap.stats.hostStrongHandles, handles);
      const values = platform.heap.get(platform.get(reference, '$data')).data.slice(0, 5).map(value => platform.native(value));
      assert.deepEqual(values, ['last', 'fourth', 'middle', 'second', 'first']);
    } finally {
      for (const handle of weak) platform.heap.releaseHandle(handle);
      vm.stop();
    }
  });

  test(`SF-A08-B03 ${engine}: Reverse releases its temporary root when a write observer throws`, () => {
    const {vm, platform, call} = createClosedCollection(engine, 'List', 'string');
    try {
      call('Add', platform.managed('first', 'string'));
      call('Add', platform.managed('last', 'string'));
      const pins = platform.heap.pins.length;
      const failure = new Error('Observer stopped execution');
      vm.onWrite = event => { if (event.kind === 'array') throw failure; };
      assert.throws(() => call('Reverse'), error => error === failure);
      assert.equal(platform.heap.pins.length, pins);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: Reverse needs no allocation and replays after heap restore`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    const allocate = platform.heap.allocate;
    const replaceData = platform.heap.replaceData;
    try {
      for (let value = 0; value < 4; value++) call('Add', value);
      const saved = platform.heap.snapshot();
      const reverse = () => {
        call('Reverse');
        return platform.heap.get(platform.get(reference, '$data')).data.slice();
      };
      platform.heap.allocate = platform.heap.replaceData = () => {
        throw new ManagedFault('OutOfMemoryException', 'Allocation disabled during Reverse');
      };
      const expected = reverse();
      platform.heap.restore(saved);
      assert.deepEqual(reverse(), expected);
      assert.deepEqual(expected, [3, 2, 1, 0]);
      assert.equal(platform.get(reference, '$version'), 5);
      assert.equal(call('get_Capacity'), 4);
    } finally {
      platform.heap.allocate = allocate;
      platform.heap.replaceData = replaceData;
      vm.stop();
    }
  });
}
