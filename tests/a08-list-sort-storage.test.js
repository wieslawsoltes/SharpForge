import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const marker = '// Explicit ordinal calls are qualified through managed-platform dispatch.';
const source = readFileSync(new URL('list-sort-storage/Program.cs', fixture), 'utf8').split(marker)[0];
const oracle = () => readFileSync(new URL('list-sort-storage-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
let compiled;

function ordinal(platform) {
  return platform.invoke(findContracts('System.StringComparer', 'get_Ordinal')[0], []);
}

function move(platform, iterator) {
  return platform.invoke(findContracts(platform.record(iterator).type, 'MoveNext')[0], [iterator]);
}

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: default Sort and empty/singleton versions match native`, () => {
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, oracle().split('ordinal\n')[0]);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: explicit ordinal Sort matches the independent native section`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    try {
      const comparer = ordinal(platform);
      const iterator = call('GetEnumerator');
      const output = [];
      call('Sort', comparer);
      output.push(call('get_Count'), call('get_Capacity'));
      try { move(platform, iterator); } catch (error) { output.push(error.name); }
      call('set_Capacity', 12);
      for (const value of ['b', 'A', null, 'a', '', 'A']) call('Add', platform.managed(value, 'string'));
      call('Sort', comparer);
      const values = platform.heap.get(platform.get(reference, '$data')).data.slice(0, 6).map(value => platform.native(value));
      output.push(values.join('|'), call('get_Count'), call('get_Capacity'));
      platform.heap.collect([reference]);
      output.push(platform.native(call('get_Item', 5)));
      assert.equal(output.join('\n') + '\n', oracle().split('ordinal\n')[1]);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: Sort retains backing identity and writes only the live prefix`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      call('set_Capacity', 64);
      for (const value of [3, 1, 2, 1]) call('Add', value);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const revision = platform.get(reference, '$version');
      const allocations = platform.heap.stats.allocations;
      const writes = [];
      const fields = [];
      vm.onWrite = event => {
        if (event.kind === 'array') writes.push(event);
        else if (event.kind === 'field') fields.push([event.property, event.oldValue, event.value]);
      };
      call('Sort');
      assert.strictEqual(platform.get(reference, '$data'), storage);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items.slice(0, 4), [1, 1, 2, 3]);
      assert(items.slice(4).every(value => value === null));
      assert.deepEqual(writes.map(event => [event.index, event.oldValue, event.value]),
        [[0, 3, 1], [1, 1, 1], [2, 2, 2], [3, 1, 3]]);
      assert(writes.every(event => event.handle === storage.h && event.generation === storage.g));
      assert.deepEqual(fields, [['$count', 4, 4], ['$version', revision, revision + 1]]);
      assert.equal(call('get_Count'), 4);
      assert.equal(call('get_Capacity'), 64);
      assert.equal(platform.get(reference, '$version'), revision + 1);
      assert.equal(platform.heap.stats.allocations, allocations);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: default and ordinal Sort need no backing allocation and replay after restore`, () => {
    for (const explicit of [false, true]) {
      const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
      const allocate = platform.heap.allocate;
      const replaceData = platform.heap.replaceData;
      try {
        call('set_Capacity', 32);
        for (const value of ['3', '1', '2']) call('Add', platform.managed(value, 'string'));
        const comparer = ordinal(platform);
        const saved = platform.heap.snapshot();
        const finish = () => {
          const storage = platform.get(reference, '$data');
          const items = platform.heap.get(storage).data;
          explicit ? call('Sort', comparer) : call('Sort');
          assert.strictEqual(platform.heap.get(storage).data, items);
          return items.slice(0, 3).map(value => platform.native(value));
        };
        platform.heap.allocate = platform.heap.replaceData = () => {
          throw new ManagedFault('OutOfMemoryException', 'Storage allocation disabled during Sort');
        };
        assert.deepEqual(finish(), ['1', '2', '3']);
        platform.heap.restore(saved);
        assert.deepEqual(finish(), ['1', '2', '3']);
      } finally {
        platform.heap.allocate = allocate;
        platform.heap.replaceData = replaceData;
        vm.stop();
      }
    }
  });

  test(`SF-A08-B03 ${engine}: observer GC cannot collect pending Sort values`, () => {
    for (const explicit of [false, true]) {
      const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
      try {
        for (const value of ['d', 'c', 'b', 'a']) call('Add', platform.managed(value, 'string'));
        const storage = platform.get(reference, '$data');
        const original = platform.heap.get(storage).data.slice();
        const comparer = ordinal(platform);
        const before = platform.heap.pins.length;
        const roots = [];
        vm.onWrite = event => {
          if (event.kind !== 'array') return;
          roots.push(platform.heap.pins.length);
          platform.heap.collect();
          for (const value of original) assert.doesNotThrow(() => platform.heap.get(value));
        };
        explicit ? call('Sort', comparer) : call('Sort');
        assert.equal(roots.length, 4);
        assert(roots.every(length => length === roots[0]), 'One root set is reused for every write');
        assert.equal(platform.heap.pins.length, before);
        assert.deepEqual(platform.heap.get(storage).data.map(value => platform.native(value)), ['a', 'b', 'c', 'd']);
      } finally { vm.stop(); }
    }
  });

  test(`SF-A08-B03 ${engine}: comparison faults leave storage/version unchanged and release temporary roots`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'object');
    try {
      call('Add', platform.heap.allocate('object', 'object', []));
      call('Add', platform.heap.allocate('object', 'object', []));
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const saved = items.slice();
      const revision = platform.get(reference, '$version');
      const roots = platform.heap.pins.length;
      let writes = 0;
      vm.onWrite = event => { if (event.kind === 'array') writes++; };
      assert.throws(() => call('Sort'), {name: 'InvalidOperationException'});
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, saved);
      assert.equal(platform.get(reference, '$version'), revision);
      assert.equal(platform.heap.pins.length, roots);
      assert.equal(writes, 0);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: fresh empty Sort increments version without storage and rejects unsupported comparers`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    try {
      const bad = platform.heap.allocate('object', 'object', []);
      const revision = platform.get(reference, '$version');
      assert.throws(() => call('Sort', bad), {name: 'NotSupportedException'});
      assert.equal(platform.get(reference, '$version'), revision);
      const allocations = platform.heap.stats.allocations;
      const roots = platform.heap.pins.length;
      call('Sort');
      assert.equal(platform.get(reference, '$version'), revision + 1);
      assert.equal(platform.get(reference, '$data'), null);
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(platform.heap.pins.length, roots);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: observer failures release temporary Sort roots`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    try {
      for (const value of ['d', 'c', 'b', 'a']) call('Add', platform.managed(value, 'string'));
      const storage = platform.get(reference, '$data');
      const overwritten = platform.heap.createHandle(platform.heap.get(storage).data[0], {weak: true});
      const roots = platform.heap.pins.length;
      const fault = new Error('Observer stopped Sort');
      vm.onWrite = event => { if (event.kind === 'array') throw fault; };
      assert.throws(() => call('Sort'), error => error === fault);
      assert.equal(platform.heap.pins.length, roots);
      platform.heap.collect([reference]);
      assert.equal(platform.heap.getHandle(overwritten), null);
      platform.heap.releaseHandle(overwritten);
    } finally { vm.stop(); }
  });
}
