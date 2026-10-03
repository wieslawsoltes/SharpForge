import test from 'node:test';
import assert from 'node:assert/strict';
import {TypeDescriptors, recordSize, valueSize, visitEdges, visitEdgeRange} from '@sharpforge/runtime';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';

for (const pointerSize of [4, 8]) {
  test(`A06 layout core: ${pointerSize * 8}-bit sizes use managed widths and alignment`, () => {
    const tables = new MethodTableRegistry();
    const descriptors = new TypeDescriptors({pointerSize});
    const descriptor = (kind, name) => descriptors.get(kind, tables.get(name));
    assert.equal(recordSize(descriptor('object', 'object'), 0), pointerSize * 3);
    assert.equal(recordSize(descriptor('array', 'byte[]'), 100), pointerSize === 8 ? 128 : 112);
    assert.equal(recordSize(descriptor('string', 'string'), 10), pointerSize === 8 ? 48 : 36);
    assert.equal(recordSize(descriptor('array', 'nint[]'), 10), pointerSize === 8 ? 104 : 52);
    assert.equal(valueSize(tables.get('long'), pointerSize), 8);
    assert.equal(valueSize(tables.get('int*'), pointerSize), pointerSize);
    assert.equal(valueSize(tables.get('object&'), pointerSize), pointerSize);
  });
}

test('A06 layout core: descriptors are cached per immutable type, kind and pointer width', () => {
  const tables = new MethodTableRegistry();
  const type = tables.get('int[]');
  const descriptors = new TypeDescriptors();
  const array = descriptors.get('array', type);
  assert.equal(descriptors.get('array', type), array);
  assert.equal(Object.isFrozen(array), true);
  assert.equal(Object.isFrozen(array.referenceSlots), true);
  assert.notEqual(descriptors.get('object', type), array);
  assert.notEqual(new TypeDescriptors({pointerSize: 4}).get('array', type), array);
  assert.throws(() => new TypeDescriptors({pointerSize: 3}), RangeError);
  for (const length of [-1, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => recordSize(array, length), RangeError);
  }
});

test('A06 layout core: nested value fields retain precise reference slots and pointer widths', () => {
  const tables = new MethodTableRegistry();
  tables.define({
    name: 'Payload', base: 'System.ValueType', flags: {valueType: true},
    fields: [{name: 'Count', type: 'int'}, {name: 'Link', type: 'object'}]
  });
  tables.define({
    name: 'Container', fields: [
      {name: 'Prefix', type: 'byte'}, {name: 'Value', type: 'Payload'},
      {name: 'Address', type: 'int*'}, {name: 'Name', type: 'string'}
    ]
  });
  const descriptor = new TypeDescriptors().get('object', tables.get('Container'));
  assert.deepEqual(descriptor.referenceSlots, [1, 3]);
  assert.equal(valueSize(tables.get('Payload'), 8), 16);
  assert.equal(valueSize(tables.get('Payload'), 4), 8);
  assert.equal(recordSize(descriptor, 4), 56);
  const child = Object.freeze({h: 7, g: 1});
  const inlineValue = {struct: 'Payload', fields: [2, child]};
  const record = {descriptor, data: [99, inlineValue, 0, child]};
  const visited = [];
  const cursor = {};
  const visitor = (value, slot) => visited.push({value, slot});
  assert.equal(visitEdgeRange(record, 0, 1, visitor, cursor), cursor);
  assert.deepEqual(cursor, {next: 1, done: false, examined: 1});
  visitEdgeRange(record, cursor.next, 1, visitor, cursor);
  assert.deepEqual(cursor, {next: 2, done: true, examined: 1});
  assert.deepEqual(visited, [{value: inlineValue, slot: 1}, {value: child, slot: 3}]);
});

test('A06 layout core: primitive arrays scan no slots while reference arrays honor range budgets', () => {
  const tables = new MethodTableRegistry();
  const descriptors = new TypeDescriptors();
  const primitive = {descriptor: descriptors.get('array', tables.get('int[]')), data: new Int32Array(100_000)};
  let calls = 0;
  assert.equal(visitEdges(primitive, () => calls++), 0);
  assert.equal(calls, 0);
  const values = [null, {h: 1, g: 1}, {h: 2, g: 1}];
  const references = {descriptor: descriptors.get('array', tables.get('object[]')), data: values};
  const visited = [];
  const cursor = visitEdgeRange(references, 1, 1, (value, slot) => visited.push({value, slot}));
  assert.deepEqual(cursor, {next: 2, done: false, examined: 1});
  assert.deepEqual(visited, [{value: values[1], slot: 1}]);
});
