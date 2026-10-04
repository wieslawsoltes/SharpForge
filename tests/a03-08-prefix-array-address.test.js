import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MetadataBuilder, readMetadata, CilWriter, CilError, codedIndex, encodeSignature, validateTypePrefixes,
} from '@sharpforge/cil';

const integer = { kind: 'primitive', name: 'int' };
const vector = element => ({ kind: 'szarray', element });
const array = (element = integer, rank = 2) => ({ kind: 'array', element, rank, sizes: [], lowerBounds: [] });
const method = (element = integer, rank = 2) => ({ kind: 'method', hasThis: true,
  returnType: { kind: 'byref', element }, parameters: Array(rank).fill(integer) });
const readonly = [{ name: 'readonly.' }];
const code = (token, target = 'call') => new CilWriter().group(target, token, readonly).op('ret').finish();

function fixture({ type = array(), signature = method(), name = 'Address', count = 1 } = {}) {
  const builder = new MetadataBuilder('ArrayAddress');
  const parent = builder.typeSpec(type);
  const blob = builder.blob(encodeSignature(signature));
  const nameIndex = builder.string(name);
  const members = [];
  for (let index = 0; index < count; index++)
    members.push(builder.add(10, [codedIndex('MemberRefParent', parent), nameIndex, blob]));
  return { metadata: readMetadata(builder.finish()), members, parent };
}

const hasCode = expected => error => error instanceof CilError && error.code === expected;

test('readonly recognizes exact vector and multidimensional Address metadata for call and callvirt', () => {
  for (const type of [vector(integer), array(integer, 1), array(integer, 2), array(integer, 32)]) {
    const { metadata, members } = fixture({ type, signature: method(integer, type.rank ?? 1) });
    for (const target of ['call', 'callvirt']) {
      const groups = validateTypePrefixes(code(members[0], target), metadata);
      assert.equal(groups[0].prefixes[0].name, 'readonly.');
      assert.equal(groups[0].operand, members[0]);
      assert.equal(groups[0].opcodeOffset, 2);
    }
  }
});

test('element identity uses existing canonical signature codecs without resolving metadata types', () => {
  for (const element of [
    { kind: 'primitive', name: 'string' },
    { kind: 'class', token: 0x01000001 },
    { kind: 'valuetype', token: 0x02000001 },
    { kind: 'genericParameter', scope: 'type', index: 0 },
    vector(integer), array(integer),
    { kind: 'genericInstance', type: { kind: 'class', token: 0x01000001 }, arguments: [integer] },
  ]) {
    const { metadata, members } = fixture({ type: array(element), signature: method(element) });
    const row = metadata.row;
    metadata.row = token => {
      assert.ok(token >>> 24 === 10 || token >>> 24 === 27, 'Resolved an element type');
      return row(token);
    };
    assert.equal(validateTypePrefixes(code(members[0]), metadata).length, 2);
  }
});

test('unrecognized names, parents and method shapes remain explicit unsupported calls', () => {
  for (const options of [
    { name: 'AddressX' }, { name: 'address' }, { type: integer },
    { signature: { ...method(), hasThis: false } },
    { signature: { ...method(), explicitThis: true } },
    { signature: { ...method(), callingConvention: 5 } },
    { signature: { ...method(), genericArity: 1 } },
    { signature: method(integer, 1) },
    { signature: { ...method(), parameters: [integer, { kind: 'primitive', name: 'uint' }] } },
    { signature: { ...method(), returnType: integer } },
    { signature: method({ kind: 'primitive', name: 'uint' }) },
    { signature: { kind: 'field', type: integer } },
  ]) {
    const { metadata, members } = fixture(options);
    assert.throws(() => validateTypePrefixes(code(members[0]), metadata), hasCode('CILPC0006'));
  }
  const { metadata, members } = fixture();
  metadata.rows[10][0][0] = codedIndex('MemberRefParent', 0x02000001);
  assert.throws(() => validateTypePrefixes(code(members[0]), metadata), hasCode('CILPC0006'));
  assert.throws(() => validateTypePrefixes(code(0x06000001), metadata), hasCode('CILPC0006'));
});

test('invalid metadata and signature limits carry prefix offsets while foreign failures propagate', () => {
  const { metadata, members } = fixture();
  assert.throws(() => validateTypePrefixes(code(0x0a00ffff), metadata), hasCode('CILPC0008'));
  metadata.rows[10][0][0] = codedIndex('MemberRefParent', 0x1b00ffff);
  assert.throws(() => validateTypePrefixes(code(members[0]), metadata), hasCode('CILPC0008'));
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array(4097)]) {
    const sample = fixture();
    sample.metadata.blob = () => bytes;
    assert.throws(() => validateTypePrefixes(code(sample.members[0]), sample.metadata), error => {
      assert.ok(hasCode(bytes.length > 4096 ? 'CILPC0007' : 'CILPC0008')(error));
      assert.equal(error.offset, 0);
      assert.equal(error.targetOffset, 2);
      assert.equal(error.token, sample.members[0]);
      return true;
    });
  }
  const sample = fixture();
  const failure = new Error('Host failure');
  sample.metadata.blob = () => { throw failure; };
  assert.throws(() => validateTypePrefixes(code(sample.members[0]), sample.metadata), error => error === failure);
});

test('repeated calls share per-invocation metadata work and later invocations see mutations', () => {
  const { metadata, members } = fixture();
  let rows = 0;
  let blobs = 0;
  const row = metadata.row;
  const blob = metadata.blob;
  metadata.row = token => { rows++; return row(token); };
  metadata.blob = index => { blobs++; return blob(index); };
  metadata.string = () => assert.fail('Fixed Address name must not allocate a decoded string');
  const writer = new CilWriter();
  for (let index = 0; index < 64; index++) writer.group('call', members[0], readonly);
  validateTypePrefixes(writer.finish(), metadata);
  assert.equal(rows, 2);
  assert.equal(blobs, 2);
  metadata.rows[10][0][1] = 0;
  assert.throws(() => validateTypePrefixes(code(members[0]), metadata), hasCode('CILPC0006'));
});

test('member and aggregate signature budgets bound unique metadata expansion', () => {
  const complex = { kind: 'genericInstance', type: { kind: 'class', token: 0x01010000 },
    arguments: Array(230).fill({ kind: 'class', token: 0x01010000 }) };
  for (const element of [integer, complex]) {
    const { metadata, members } = fixture({ type: array(element), signature: method(element), count: 1025 });
    let blobs = 0;
    const blob = metadata.blob;
    metadata.blob = index => { blobs++; return blob(index); };
    const writer = new CilWriter();
    for (const member of members) writer.group('call', member, readonly);
    assert.throws(() => validateTypePrefixes(writer.finish(), metadata), hasCode('CILPC0007'));
    assert.ok(blobs <= 1025);
    if (element === complex) assert.ok(blobs < 1025, 'Aggregate bound must reject before member limit');
  }
});

test('Buffer inputs, cancellation and the readonly-store limitation retain existing contracts', () => {
  const { metadata, members } = fixture();
  const original = code(members[0]);
  const buffer = Buffer.concat([Buffer.from([99]), original, Buffer.from([88])]);
  const snapshot = Buffer.from(buffer);
  validateTypePrefixes(buffer.subarray(1, -1), metadata);
  assert.deepEqual(buffer, snapshot);
  assert.throws(() => validateTypePrefixes(original, metadata, { signal: { aborted: true } }), /cancelled/);
  const write = new CilWriter().group('call', members[0], readonly).op('ldc.i4.0').op('stind.i4').op('ret').finish();
  assert.doesNotThrow(() => validateTypePrefixes(write, metadata)); // Typed store verification remains outside this pass.
});
