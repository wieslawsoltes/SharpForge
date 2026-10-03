import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeCustomAttribute, MetadataBuilder, readMetadata, methodSignature, fieldSignature, codedIndex } from '@sharpforge/cil';

const array = element => ({ kind: 'szarray', element });
const revive = (key, value) => value?.$bigint !== undefined ? BigInt(value.$bigint)
  : value?.$number !== undefined ? (value.$number === '-NaN' ? -NaN : Number(value.$number)) : value;

test('custom attribute bytes match independent Roslyn metadata for every argument kind', () => {
  const data = JSON.parse(readFileSync(new URL('./fixtures/attributes/roslyn.json', import.meta.url)), revive);
  assert.equal(data.runtime, '.NET 10.0.5');
  for (const [name, hash] of Object.entries(data.sourceSha256)) {
    const bytes = readFileSync(new URL(`./fixtures/attributes/AttributeOracle/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, name);
  }
  for (const item of data.cases) {
    const bytes = Uint8Array.from(Buffer.from(item.blob, 'hex'));
    const named = item.namedArguments.map(argument => ({
      name: argument.name, isField: argument.isField, type: argument.descriptor, value: argument.inputValue,
    }));
    const options = { enumUnderlyingType: name => data.enums[name.split(',')[0]] };
    assert.deepEqual(encodeCustomAttribute(item.parameters, item.values, named, options), bytes, item.id);
  }
});

test('constructor tokens and local enum storage resolve through metadata list APIs', () => {
  const builder = new MetadataBuilder('Attributes');
  const enumeration = builder.add(2, [1, builder.string('Sample'), 0, 0, 1, 1]);
  builder.add(4, [0x606, builder.string('value__'), builder.blob(fieldSignature('ushort'))]);
  const attribute = builder.typeRef('Attribute');
  const signature = methodSignature('void', [{ kind: 'valuetype', token: enumeration }], false);
  const constructor = builder.add(10, [codedIndex('MemberRefParent', attribute), builder.string('.ctor'), builder.blob(signature)]);
  const metadata = readMetadata(builder.finish());
  assert.deepEqual([...encodeCustomAttribute(constructor, [65535], [], { metadata })], [1, 0, 255, 255, 0, 0]);
});

test('SerString lengths, null and empty arrays, boxed null and integer edges use exact bytes', () => {
  for (const [length, prefix] of [[0, [0]], [127, [127]], [128, [128, 128]], [16383, [191, 255]], [16384, [192, 0, 64, 0]]]) {
    const expected = Uint8Array.from([1, 0, ...prefix, ...new Array(length).fill(120), 0, 0]);
    assert.deepEqual(encodeCustomAttribute(['string'], ['x'.repeat(length)], [], {
      maxBytes: expected.length, maxStringBytes: length,
    }), expected);
  }
  assert.deepEqual([...encodeCustomAttribute([array('int')], [null])], [1, 0, 255, 255, 255, 255, 0, 0]);
  assert.deepEqual([...encodeCustomAttribute([array('int')], [[]])], [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...encodeCustomAttribute(['object'], [null])], [1, 0, 14, 255, 0, 0]);
  for (const [underlying, value, expected] of [
    ['sbyte', -128, [128]], ['byte', 255, [255]], ['short', -32768, [0, 128]], ['ushort', 65535, [255, 255]],
    ['int', -2147483648, [0, 0, 0, 128]], ['uint', 4294967295, [255, 255, 255, 255]],
    ['long', -(1n << 63n), [0, 0, 0, 0, 0, 0, 0, 128]], ['ulong', (1n << 64n) - 1n, new Array(8).fill(255)],
  ]) assert.deepEqual([...encodeCustomAttribute([{ kind: 'enum', name: 'E', underlying }], [value])], [1, 0, ...expected, 0, 0]);
});

test('attribute traversal, sizes, invalid values and cancellation are bounded', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => encodeCustomAttribute([], [], [], { signal: controller.signal }), error => error.code === 'MD0109');
  assert.throws(() => encodeCustomAttribute([array('int')], [[1, 2]], [], { maxNodes: 2 }), /limit/);
  assert.throws(() => encodeCustomAttribute([array('int')], [[1, 2]], [], { maxArrayLength: 1 }), /limit/);
  assert.throws(() => encodeCustomAttribute([], [], [], { maxBytes: 1 }), /limit/);
  for (const [type, value] of [['byte', 256], ['int', 0.5], ['ulong', -1n], ['long', 2 ** 60], ['char', 'ab'], ['bool', 1]]) {
    assert.throws(() => encodeCustomAttribute([type], [value]), error => error.code === 'MD0110');
  }
  assert.throws(() => encodeCustomAttribute([{ kind: 'enum', name: 'Unknown' }], [0]), error => error.code === 'MD0104');
  assert.throws(() => encodeCustomAttribute([array(array('int'))], [[]]), /Jagged/);
  assert.throws(() => encodeCustomAttribute([], [], [{ name: '', isField: true, type: 'int', value: 1 }]), /argument/);
  assert.throws(() => encodeCustomAttribute(['object'], [{ type: 'object', value: null }]), /concrete/);
});
