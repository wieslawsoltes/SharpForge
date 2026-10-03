import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  Writer, CilError, MetadataBuilder, readMetadata, decodeSignature, decodeTypeSignature, encodeSignature, encodeTypeSignature,
  parseSignatureType, readSignature, readTypeSignature, fieldSignature, methodSignature, propertySignature,
  localSignature, methodSpecSignature, signatureType,
} from '@sharpforge/cil';

const primitive = name => ({ kind: 'primitive', name });
const int = primitive('int');
const names = new Map([
  ['System.Collections.Generic.Dictionary`2', 0x01000001],
  ['System.Collections.Generic.List`1', 0x01000002],
  ['System.Nullable`1', 0x01000003],
  ['IsVolatile', 0x01000004], ['InAttribute', 0x01000005],
]);
const resolve = name => {
  assert.ok(names.has(name), name);
  return names.get(name);
};
const metadata = { typeName: token => [...names].find(([, value]) => value === token)?.[0] };

test('signature AST matches independently generated SRM and Roslyn bytes and shapes', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/signatures/srm.json', import.meta.url)));
  assert.ok(fixture.cases.length >= 300);
  assert.equal(fixture.runtime, '.NET 10.0.5');
  for (const [name, hash] of Object.entries(fixture.sourceSha256)) {
    const source = readFileSync(new URL(`./fixtures/signatures/SignatureOracle/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(), hash, name);
  }
  for (const item of fixture.cases) {
    const bytes = Uint8Array.from(Buffer.from(item.bytes, 'hex'));
    const decode = item.kind === 'type' ? decodeTypeSignature : decodeSignature;
    const encode = item.kind === 'type' ? encodeTypeSignature : encodeSignature;
    assert.deepEqual(decode(bytes), item.shape, item.id);
    assert.deepEqual(encode(item.shape), bytes, item.id);
  }
});

test('compatibility writers encode every primitive using its intrinsic element code', () => {
  const primitives = ['bool', 'char', 'sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double'];
  for (let index = 0; index < primitives.length; index++) {
    assert.deepEqual([...fieldSignature(primitives[index])], [6, index + 2]);
  }
  assert.deepEqual([...signatureType(new Writer(), 'void').finish()], [1]);
  assert.deepEqual([...fieldSignature('System.Int32')], [6, 8]);
  assert.equal(parseSignatureType('SharpForge.<>AllocationToken', () => 0x02000001).token, 0x02000001);
  const namedBytes = encodeTypeSignature(parseSignatureType('constructor', () => 0x02000001));
  assert.equal(readTypeSignature(namedBytes, { typeName: () => 'constructor' }), 'constructor');
  assert.deepEqual(readSignature(localSignature(['typedref', 'int& pinned']), metadata), {
    kind: 'locals', types: ['typedref', 'int& pinned'],
  });
});

test('nested generic arguments preserve argument boundaries and class/value semantics', () => {
  const text = 'Dictionary<string, List<int>>';
  const ast = parseSignatureType(text, resolve);
  assert.equal(ast.arguments.length, 2);
  assert.deepEqual([...encodeTypeSignature(ast)], [0x15, 0x12, 5, 2, 14, 0x15, 0x12, 9, 1, 8]);
  assert.equal(readTypeSignature(encodeTypeSignature(ast), metadata),
    'System.Collections.Generic.Dictionary`2<string, System.Collections.Generic.List`1<int>>');
  const nullable = parseSignatureType('Nullable<!0>', resolve);
  assert.equal(nullable.type.kind, 'valuetype');
  assert.equal(parseSignatureType('Vector<int>', () => 0x01000004).type.kind, 'valuetype');
  assert.equal(parseSignatureType('System.Numerics.Vector', () => 0x01000004).kind, 'class');
  assert.deepEqual(decodeSignature(methodSpecSignature(['int', '!!1'])), {
    kind: 'methodSpec', arguments: [int, { kind: 'genericParameter', scope: 'method', index: 1 }],
  });
});

test('modifiers retain nesting order and properties encode their own header', () => {
  const bytes = fieldSignature('int modopt(InAttribute) modreq(IsVolatile)', resolve);
  assert.deepEqual([...bytes], [6, 0x1f, 17, 0x20, 21, 8]);
  assert.equal(readSignature(bytes, metadata).type, 'int modopt(InAttribute) modreq(IsVolatile)');
  assert.deepEqual([...propertySignature('string', ['int'], false)], [0x28, 1, 14, 8]);
  const method = methodSignature('!!0', ['!0', 'int'], false, resolve, {
    genericArity: 1, explicitThis: true, callingConvention: 5, sentinel: 1,
  });
  const decoded = decodeSignature(method);
  assert.equal(decoded.explicitThis, true);
  assert.equal(decoded.sentinel, 1);
  assert.deepEqual(encodeSignature(decoded), method);
});

test('multi-dimensional array shapes preserve signed bounds and reject holes', () => {
  for (const text of ['int[,]', 'int[0...,0...]', 'int[1...5,*]', 'int[-8193...-8190]', 'int[*]']) {
    const ast = parseSignatureType(text);
    assert.deepEqual(decodeTypeSignature(encodeTypeSignature(ast)), ast, text);
  }
  assert.throws(() => parseSignatureType('int[*,1...5]'), /prefix/);
  assert.throws(() => parseSignatureType('int[5...1]'), /size/);
  assert.throws(() => parseSignatureType('int[' + ','.repeat(32) + ']'), /rank/);
});

test('malformed signature blobs reject truncation, invalid forms and excessive work', () => {
  const invalid = [
    [], [6], [6, 1], [6, 0x10, 8], [6, 0x45, 8], [7, 1, 0x45, 0x45, 8],
    [0x40, 0, 1], [0x80, 0, 1], [0x10, 0, 0, 1], [0, 1, 1, 0x41, 8],
    [5, 1, 1, 8, 0x41], [5, 2, 1, 0x41, 8, 0x41, 8],
    [6, 0x15, 8, 1, 8], [6, 0x12, 0], [6, 0x12, 7], [10, 0], [6, 8, 0],
    [6, 0x14, 8, 0, 0, 0], [6, 0x14, 8, 33, 0, 0], [6, 0x14, 8, 1, 2, 0, 0, 0],
    [7, 0xff], [6, ...Array(65).fill(0x1d), 8],
  ];
  for (const bytes of invalid) assert.throws(() => decodeSignature(Uint8Array.from(bytes)), CilError, bytes.join(','));
  assert.throws(() => decodeSignature(Uint8Array.of(7, 2, 8, 8), { maxNodes: 1 }), /complexity/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => decodeSignature(Uint8Array.of(6, 8), { signal: controller.signal }), /cancelled/);
  assert.throws(() => encodeSignature({ kind: 'field', type: int }, { signal: controller.signal }), /cancelled/);
});

test('malformed ASTs reject illegal contexts, cycles, invalid tokens and headers', () => {
  const cycle = { kind: 'szarray' };
  cycle.element = cycle;
  assert.throws(() => encodeTypeSignature(cycle), /complexity/);
  for (const type of [primitive('void'), { kind: 'pinned', element: int }, { kind: 'byref', element: int }]) {
    assert.throws(() => encodeSignature({ kind: 'field', type }), CilError);
  }
  assert.throws(() => encodeTypeSignature({ kind: 'class', token: 0x04000001 }), CilError);
  assert.throws(() => encodeTypeSignature({ kind: 'class', token: 0x01000000 }), CilError);
  assert.throws(() => encodeSignature({ kind: 'method', returnType: int, parameters: [], sentinel: 0 }), /sentinel/);
  assert.throws(() => encodeSignature({ kind: 'method', returnType: int, parameters: [], explicitThis: true }), /Explicit/);
  assert.throws(() => parseSignatureType('List<int,,string>', resolve), CilError);
});

test('MetadataBuilder deduplicates nested TypeSpec bytes', () => {
  const builder = new MetadataBuilder('Nested');
  const name = 'System.Collections.Generic.Dictionary`2<string,System.Collections.Generic.List`1<int>>';
  const first = builder.typeRef(name);
  assert.equal(first >>> 24, 27);
  assert.equal(builder.typeRef(name), first);
  assert.equal(builder.typeRef('Dictionary<string, List<int>>'), first);
  assert.equal(builder.rows[27].length, 1);
  const metadata = readMetadata(builder.finish(null, new Uint8Array()));
  assert.equal(decodeTypeSignature(metadata.blob(metadata.row(first)[0])).kind, 'genericInstance');
});
