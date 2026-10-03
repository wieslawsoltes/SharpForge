import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  encodeCustomAttribute, decodeCustomAttribute, customAttributeDiagnosticCatalog, MetadataBuilder,
  readMetadata, methodSignature, fieldSignature, codedIndex,
} from '@sharpforge/cil';

const primitive = name => ({ kind: 'primitive', name });
const array = element => ({ kind: 'szarray', element });
const integer = primitive('int');
const revive = (key, value) => value?.$bigint !== undefined ? BigInt(value.$bigint)
  : value?.$number !== undefined ? (value.$number === '-NaN' ? -NaN : Number(value.$number)) : value;
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/attributes/roslyn.json', import.meta.url)), revive);
const environment = data => ({ enumUnderlyingType: name => data.enums[name.split(',')[0]] });

test('custom attribute decoding matches independent SRM typed values from Roslyn metadata', () => {
  const data = fixture();
  assert.equal(data.runtime, '.NET 10.0.5');
  for (const [name, hash] of Object.entries(data.sourceSha256)) {
    const bytes = readFileSync(new URL(`./fixtures/attributes/AttributeOracle/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex').toUpperCase(), hash, name);
  }
  for (const item of data.cases) {
    const bytes = Uint8Array.from(Buffer.from(item.blob, 'hex'));
    const decoded = decodeCustomAttribute(bytes, item.parameters, environment(data));
    assert.equal(decoded.success, true, JSON.stringify(decoded.diagnostics));
    assert.deepEqual(decoded.constructorArguments, item.decodedConstructorArguments, item.id);
    assert.deepEqual(decoded.namedArguments, item.decodedNamedArguments, item.id);
  }
});

test('constructor tokens and local enum storage resolve through metadata list APIs', () => {
  const builder = new MetadataBuilder('Attributes');
  const enumToken = builder.add(2, [1, builder.string('Sample'), 0, 0, 1, 1]);
  builder.add(4, [0x606, builder.string('value__'), builder.blob(fieldSignature('ushort'))]);
  const attributeToken = builder.typeRef('Attribute');
  const signature = methodSignature('void', [{ kind: 'valuetype', token: enumToken }], false);
  const constructor = builder.add(10, [codedIndex('MemberRefParent', attributeToken), builder.string('.ctor'), builder.blob(signature)]);
  const metadata = readMetadata(builder.finish());
  const bytes = encodeCustomAttribute(constructor, [65535], [], { metadata });
  assert.deepEqual([...bytes], [1, 0, 255, 255, 0, 0]);
  const decoded = decodeCustomAttribute(bytes, constructor, { metadata });
  assert.deepEqual(decoded.constructorArguments, [{ kind: 'enum', type: 'Sample', value: 65535 }]);
});

test('SerString boundaries, empty and null arrays, boxed null and integer edges are preserved', () => {
  for (const length of [0, 127, 128, 16383, 16384]) {
    const value = 'x'.repeat(length);
    const bytes = encodeCustomAttribute(['string'], [value]);
    const options = { maxBytes: bytes.length, maxStringBytes: length };
    assert.equal(decodeCustomAttribute(bytes, ['string'], options).constructorArguments[0].value, value);
    assert.deepEqual(encodeCustomAttribute(['string'], [value], [], options), bytes);
  }
  for (const value of [null, [], [1, -1]]) {
    const decoded = decodeCustomAttribute(encodeCustomAttribute([array(integer)], [value]), [array(integer)]);
    assert.deepEqual(decoded.constructorArguments[0].value?.map(item => item.value) ?? null, value);
  }
  assert.deepEqual([...encodeCustomAttribute(['object'], [null])], [1, 0, 14, 255, 0, 0]);
  for (const [underlying, value] of [
    ['sbyte', -128], ['byte', 255], ['short', -32768], ['ushort', 65535], ['int', -2147483648],
    ['uint', 4294967295], ['long', -(1n << 63n)], ['ulong', (1n << 64n) - 1n],
  ]) {
    const type = { kind: 'enum', name: 'E', underlying };
    const decoded = decodeCustomAttribute(encodeCustomAttribute([type], [value]), [type]);
    assert.equal(decoded.constructorArguments[0].value, value);
  }
});

test('at least twenty malformed blobs return stable diagnostics without escaping exceptions', () => {
  const cases = [
    [[], []], [[1], []], [[2, 0, 0, 0], []], [[1, 0], []], [[1, 0, 0], []], [[1, 0, 0, 0, 0], []],
    [[1, 0, 1, 0], []], [[1, 0, 1, 0, 0x52], []], [[1, 0, 1, 0, 0x53, 1], []],
    [[1, 0, 1, 0, 0x54, 0x1c], []], [[1, 0, 1, 0, 0x54, 0x55, 1, 69], []],
    [[1, 0, 1, 0, 0x54, 2, 0xff, 1], []], [[1, 0, 1, 0, 0x54, 2, 0, 1], []],
    [[1, 0, 0xe0], ['string']], [[1, 0, 2, 65], ['string']], [[1, 0, 1, 255, 0, 0], ['string']],
    [[1, 0, 8], ['object']], [[1, 0, 0x51, 0, 0], ['object']], [[1, 0, 1], ['int']],
    [[1, 0, 0xfe, 0xff, 0xff, 0xff, 0, 0], [array(integer)]],
    [[1, 0, 2, 0, 0, 0, 1, 0, 0], [array(integer)]],
    [[1, 0, 0, 0], [{ kind: 'enum', name: 'Unknown' }]],
    [[1, 0, 0, 0], [array(array(integer))]], [[1, 0, 0, 0], ['void']],
  ];
  for (const [bytes, types] of cases) {
    const result = decodeCustomAttribute(Uint8Array.from(bytes), types);
    assert.equal(result.success, false, bytes.join(','));
    assert.ok(Object.hasOwn(customAttributeDiagnosticCatalog, result.diagnostics[0].code));
    assert.deepEqual(result.constructorArguments, []);
  }
  assert.equal(decodeCustomAttribute(new Uint8Array(), [{ kind: 'enum', name: 'Unknown' }]).diagnostics[0].code, 'MD0104');
});

test('attribute traversal, sizes, invalid values and cancellation are bounded', () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal(decodeCustomAttribute(Uint8Array.of(1, 0, 0, 0), [], { signal: controller.signal }).diagnostics[0].code, 'MD0109');
  assert.throws(() => encodeCustomAttribute([], [], [], { signal: controller.signal }), error => error.code === 'MD0109');
  const bytes = encodeCustomAttribute([array(integer)], [[1, 2]]);
  assert.equal(decodeCustomAttribute(bytes, [array(integer)], { maxArrayLength: 1 }).diagnostics[0].code, 'MD0108');
  assert.throws(() => encodeCustomAttribute([array(integer)], [[1, 2]], [], { maxNodes: 2 }), /limit/);
  assert.equal(decodeCustomAttribute(bytes, [array(integer)], { maxBytes: 1 }).diagnostics[0].code, 'MD0108');
  for (const [type, value] of [['byte', 256], ['int', 0.5], ['ulong', -1n], ['long', 2 ** 60], ['char', 'ab'], ['bool', 1]]) {
    assert.throws(() => encodeCustomAttribute([type], [value]), error => error.code === 'MD0110');
  }
  assert.throws(() => encodeCustomAttribute([], [], [{ name: '', isField: true, type: 'int', value: 1 }]), /argument/);
  const cyclic = { type: 'object' };
  cyclic.value = cyclic;
  assert.throws(() => encodeCustomAttribute(['object'], [cyclic]), /concrete/);
});
