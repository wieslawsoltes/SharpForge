import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';

test('A06 layout: x64 reference, array and UTF-16 string sizes use type widths and alignment', () => {
  const heap = new ManagedHeap({maxBytes: 4_000_000, gcStress: false});
  assert.equal(heap.get(heap.object('object', [])).size, 24);
  assert.equal(heap.get(heap.array('byte', 100)).size, 128);
  assert.equal(heap.get(heap.string('0123456789')).size, 48);
  assert.equal(heap.get(heap.array('byte', 1_000_000)).size, 1_000_024);
  assert.equal(heap.get(heap.array('long', 10)).size, 104);
});

test('A06 layout: x86 accounting is explicit and does not depend on host pointer width', () => {
  const heap = new ManagedHeap({pointerSize: 4, gcStress: false});
  assert.equal(heap.get(heap.object('object', [])).size, 12);
  assert.equal(heap.get(heap.array('byte', 100)).size, 112);
  assert.equal(heap.get(heap.string('0123456789')).size, 36);
  assert.equal(heap.get(heap.array('nint', 10)).size, 52);
  assert.throws(() => new ManagedHeap({pointerSize: 3}), RangeError);
});

test('A06 layout: typed reference maps skip one million primitive array slots', () => {
  const heap = new ManagedHeap({maxBytes: 8_000_000, gcStress: false});
  const array = heap.array('int', 1_000_000);
  heap.rootProvider = () => [array];
  const result = heap.collect();
  assert.equal(result.edgesScanned, 0);
  assert.equal(heap.get(array).data.length, 1_000_000);
  assert.equal(heap.verify().valid, true);
});

test('A06 layout: primitive default values have the correct managed numeric representation', () => {
  const heap = new ManagedHeap({gcStress: false});
  for (const [name, value] of [['bool', false], ['long', 0n], ['ulong', 0n], ['char', 0], ['byte', 0],
    ['sbyte', 0], ['short', 0], ['ushort', 0], ['int', 0], ['uint', 0], ['float', 0], ['double', 0], ['object', null]]) {
    assert.deepEqual([...heap.get(heap.array(name, 2)).data], [value, value], name);
  }
  assert.throws(() => heap.array('byte', -1), {name: 'OverflowException'});
  assert.throws(() => heap.array('byte', 1_000_001), {name: 'OutOfMemoryException'});
  assert.throws(() => heap.array('byte', 1.5), {name: 'OverflowException'});
});

test('A06 layout: failed allocation preserves temporary roots and consistent accounting', () => {
  const heap = new ManagedHeap({maxBytes: 96, initialThreshold: 96, gcStress: false});
  const root = heap.object('Node', [null]);
  const handle = heap.createHandle(root);
  assert.throws(() => heap.array('long', 20), {name: 'OutOfMemoryException'});
  assert.equal(heap.pins.length, 0);
  assert.equal(heap.getHandle(handle), root);
  assert.equal(heap.verify().valid, true);
  heap.releaseHandle(handle);
  heap.collect();
  assert.equal(heap.stats.liveBytes, 0);
  assert.ok(heap.array('byte', 32));
});

test('A06 layout: typed class fields preserve precise edges and declared instance size', () => {
  const heap = new ManagedHeap({gcStress: false});
  heap.methodTables.define({name: 'ThreeInts', fields: [
    {name: 'A', type: 'int'}, {name: 'B', type: 'int'}, {name: 'C', type: 'int'}
  ]});
  const value = heap.object('ThreeInts', [1, 2, 3]);
  assert.equal(heap.get(value).size, 32);
  heap.rootProvider = () => [value];
  assert.equal(heap.collect().edgesScanned, 0);
});

test('A06 layout: framework value arrays trace boxed storage while enum arrays skip primitive slots', () => {
  const heap = new ManagedHeap({gcStress: false});
  const metric = heap.object('System.GCGenerationInfo', [1n, 2n, 3n, 4n]);
  const array = heap.allocate('array', 'System.GCGenerationInfo[]', [metric]);
  heap.rootProvider = () => [array];
  heap.collect();
  assert.equal(heap.get(metric).type, 'System.GCGenerationInfo');
  assert.equal(heap.get(array).descriptor.scan, 'all');
  const modes = heap.array('System.GCCollectionMode', 10);
  heap.rootProvider = () => [modes];
  assert.equal(heap.get(modes).descriptor.scan, 'none');
  assert.equal(heap.collect().edgesScanned, 0);
});
