import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('list-removal/Program.cs', fixture), 'utf8');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: List range-removal results match .NET 10.0.5`, () => {
    const expected = readFileSync(new URL('list-removal-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: tail RemoveAt retains List backing and performs one slot write`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      for (let value = 0; value < 128; value++) call('Add', value);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const allocations = platform.heap.stats.allocations;
      let arrayWrites = 0;
      vm.onWrite = event => { if (event.kind === 'array') arrayWrites++; };
      for (let index = 127; index >= 0; index--) {
        call('RemoveAt', index);
        assert.strictEqual(platform.heap.get(storage).data, items, 'Removal must not replace the backing array');
      }
      assert.equal(arrayWrites, 128);
      assert.equal(platform.heap.stats.allocations, allocations);
      assert.equal(call('get_Count'), 0);
      assert.equal(call('get_Capacity'), 128);
      assert(items.every(value => value === null));
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: RemoveRange shifts only the surviving suffix and clears its tail`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      for (let value = 0; value < 8; value++) call('Add', value);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const writes = [];
      vm.onWrite = event => { if (event.kind === 'array') writes.push(event); };
      call('RemoveRange', 2, 3);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [0, 1, 5, 6, 7, null, null, null]);
      assert.deepEqual(writes.map(event => [event.index, event.oldValue, event.value]),
        [[2, 2, 5], [3, 3, 6], [4, 4, 7], [5, 5, null], [6, 6, null], [7, 7, null]]);
      assert.equal(call('get_Count'), 5);
      assert.equal(call('get_Capacity'), 8);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List invalid ranges preserve contents and released empty-range versions`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      call('Add', 1); call('Add', 2);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const revision = platform.get(reference, '$version');
      for (const args of [['RemoveAt', -1], ['RemoveAt', 2], ['RemoveAt', 1.5],
        ['RemoveRange', -1, 0], ['RemoveRange', 3, 0], ['RemoveRange', 0, -1], ['RemoveRange', 1, 2]]) {
        assert.throws(() => call(...args), {name: 'ArgumentOutOfRangeException'});
      }
      assert.equal(platform.get(reference, '$version'), revision);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [1, 2, null, null]);
      const iterator = call('GetEnumerator');
      call('RemoveRange', 2, 0);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.equal(platform.get(reference, '$version'), revision + 1);
      const moveNext = findContracts(platform.record(iterator).type, 'MoveNext')[0];
      assert.throws(() => platform.invoke(moveNext, [iterator]), {name: 'InvalidOperationException'});
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List removed references leave the managed GC graph`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    try {
      const left = platform.managed('left', 'string');
      call('Add', left);
      const first = platform.managed('removed first', 'string');
      call('Add', first);
      const second = platform.managed('removed second', 'string');
      call('Add', second);
      const right = platform.managed('right', 'string');
      call('Add', right);
      const weak = [first, second].map(value => platform.heap.createHandle(value, {weak: true}));
      call('RemoveRange', 1, 2);
      platform.heap.collect([reference]);
      for (const handle of weak) {
        assert.equal(platform.heap.getHandle(handle), null);
        platform.heap.releaseHandle(handle);
      }
      assert.equal(platform.native(call('get_Item', 0)), 'left');
      assert.equal(platform.native(call('get_Item', 1)), 'right');
      assert.deepEqual(platform.heap.get(platform.get(reference, '$data')).data, [left, right, null, null]);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List removal succeeds when allocation and backing replacement fail`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    const allocate = platform.heap.allocate;
    const replaceData = platform.heap.replaceData;
    try {
      for (let value = 0; value < 8; value++) call('Add', value);
      platform.heap.allocate = platform.heap.replaceData = () => {
        throw new ManagedFault('OutOfMemoryException', 'Allocation disabled during removal');
      };
      call('RemoveAt', 7); call('RemoveRange', 1, 3); call('RemoveRange', 4, 0);
      assert.equal(call('get_Count'), 4);
      assert.deepEqual(platform.heap.get(platform.get(reference, '$data')).data, [0, 4, 5, 6, null, null, null, null]);
    } finally {
      platform.heap.allocate = allocate;
      platform.heap.replaceData = replaceData;
      vm.stop();
    }
  });

  test(`SF-A08-B03 ${engine}: List in-place removal replays after heap restore`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      for (let value = 0; value < 6; value++) call('Add', value);
      const saved = platform.heap.snapshot();
      const finish = () => {
        call('RemoveAt', 5); call('RemoveRange', 1, 3);
        return platform.heap.get(platform.get(reference, '$data')).data.slice();
      };
      const expected = finish();
      platform.heap.restore(saved);
      assert.deepEqual(finish(), expected);
      assert.deepEqual(expected, [0, 4, null, null, null, null, null, null]);
    } finally { vm.stop(); }
  });
}
