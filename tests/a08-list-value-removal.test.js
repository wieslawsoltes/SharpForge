import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine, ManagedFault} from '@sharpforge/runtime';
import {createClosedCollection} from './helpers/closed-collection.js';

const fixture = new URL('../packages/bcl-collections/reference/', import.meta.url);
const source = readFileSync(new URL('list-value-removal/Program.cs', fixture), 'utf8');
let compiled;

for (const engine of ['source', 'cil']) {
  test(`SF-A08-B03 ${engine}: List Remove(value)/Clear results match .NET 10.0.5`, () => {
    const expected = readFileSync(new URL('list-value-removal-net10.txt', fixture), 'utf8').replaceAll('\r\n', '\n');
    compiled ??= compileToIL(source);
    assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
    const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.output, expected);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List value removal and Clear preserve backing storage and notify writes`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      for (const value of [1, 2, 1, 3]) call('Add', value);
      const storage = platform.get(reference, '$data');
      const items = platform.heap.get(storage).data;
      const writes = [];
      vm.onWrite = event => { if (event.kind === 'array') writes.push(event); };
      assert.equal(Boolean(platform.native(call('Remove', 1))), true);
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(items, [2, 1, 3, null]);
      assert.deepEqual(writes.map(event => [event.index, event.value]), [[0, 2], [1, 1], [2, 3], [3, null]]);
      writes.length = 0;
      call('Clear');
      assert.strictEqual(platform.heap.get(storage).data, items);
      assert.deepEqual(writes.map(event => [event.index, event.value]), [[0, null], [1, null], [2, null]]);
      assert.deepEqual(items, [null, null, null, null]);
      assert.equal(call('get_Count'), 0);
      assert.equal(call('get_Capacity'), 4);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: missing List values and empty Clear preserve released versions`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    try {
      const initial = platform.get(reference, '$version');
      call('Clear');
      assert.equal(Boolean(platform.native(call('Remove', 1))), false);
      assert.equal(platform.get(reference, '$version'), initial);
      assert.equal(platform.get(reference, '$data'), null);
      call('Add', 1); call('Add', 2);
      const revision = platform.get(reference, '$version');
      let iterator = call('GetEnumerator');
      const move = () => platform.invoke(findContracts(platform.record(iterator).type, 'MoveNext')[0], [iterator]);
      assert.equal(Boolean(platform.native(call('Remove', 9))), false);
      assert.equal(platform.get(reference, '$version'), revision);
      assert.equal(Boolean(platform.native(move())), true);
      call('Remove', 1);
      assert.equal(platform.get(reference, '$version'), revision + 1);
      assert.throws(move, {name: 'InvalidOperationException'});
      iterator = call('GetEnumerator');
      call('Clear');
      assert.equal(platform.get(reference, '$version'), revision + 2);
      assert.throws(move, {name: 'InvalidOperationException'});
      call('Clear');
      assert.equal(platform.get(reference, '$version'), revision + 2);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List value removal retains NaN and signed-zero equality`, () => {
    const {vm, platform, call} = createClosedCollection(engine, 'List', 'double');
    const number = value => platform.managed(value, 'double');
    try {
      for (const value of [NaN, -0, 1, NaN]) call('Add', number(value));
      assert.equal(Boolean(platform.native(call('Remove', number(NaN)))), true);
      assert.equal(Boolean(platform.native(call('Contains', number(NaN)))), true);
      assert.equal(Boolean(platform.native(call('Remove', number(0)))), true);
      const items = platform.heap.get(call('ToArray')).data.map(value => platform.native(value));
      assert.equal(items.length, 2);
      assert.equal(items[0], 1);
      assert(Number.isNaN(items[1]));
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List Remove/Clear stop retaining all removed managed references`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
    try {
      const first = platform.managed('first', 'string');
      call('Add', first);
      const second = platform.managed('second', 'string');
      call('Add', second);
      const weakFirst = platform.heap.createHandle(first, {weak: true});
      const weakSecond = platform.heap.createHandle(second, {weak: true});
      call('Remove', first);
      platform.heap.collect([reference]);
      assert.equal(platform.heap.getHandle(weakFirst), null);
      assert.equal(platform.native(call('get_Item', 0)), 'second');
      call('Clear');
      platform.heap.collect([reference]);
      assert.equal(platform.heap.getHandle(weakSecond), null);
      assert(platform.heap.get(platform.get(reference, '$data')).data.every(value => value === null));
      platform.heap.releaseHandle(weakFirst); platform.heap.releaseHandle(weakSecond);
    } finally { vm.stop(); }
  });

  test(`SF-A08-B03 ${engine}: List Remove/Clear succeed with storage allocation disabled and replay after restore`, () => {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
    const allocate = platform.heap.allocate;
    const replaceData = platform.heap.replaceData;
    try {
      for (let value = 0; value < 4; value++) call('Add', value);
      const saved = platform.heap.snapshot();
      const finish = () => {
        assert.equal(Boolean(platform.native(call('Remove', 2))), true);
        call('Clear'); call('Clear');
        return platform.heap.get(platform.get(reference, '$data')).data.slice();
      };
      platform.heap.allocate = platform.heap.replaceData = () => {
        throw new ManagedFault('OutOfMemoryException', 'Allocation disabled during removal');
      };
      const expected = finish();
      platform.heap.restore(saved);
      assert.deepEqual(finish(), expected);
      assert.deepEqual(expected, [null, null, null, null]);
      assert.equal(call('get_Count'), 0);
    } finally {
      platform.heap.allocate = allocate;
      platform.heap.replaceData = replaceData;
      vm.stop();
    }
  });
}
