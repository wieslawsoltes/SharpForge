import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSignatureType } from '@sharpforge/cil';

const object = { kind: 'primitive', name: 'object' };
test('public signature display hook overrides selected nodes and preserves default formatting', () => {
  const type = { kind: 'szarray', element: object };
  const before = structuredClone(type);
  const formatType = (node) => (node === object ? 'dynamic' : undefined);
  assert.equal(formatSignatureType(type, null, { formatType }), 'dynamic[]');
  assert.equal(formatSignatureType(type), 'object[]');
  assert.deepEqual(type, before);
});

test('public display children share depth, node and cancellation budgets', () => {
  const formatType = (node, formatChild) => formatChild(node);
  assert.throws(() => formatSignatureType(object, null, { formatType, maxDepth: 2 }), /complexity limit/);
  assert.throws(() => formatSignatureType(object, null, { formatType, maxNodes: 2 }), /complexity limit/);
  assert.throws(() => formatSignatureType(object, null, { formatType, signal: AbortSignal.abort() }), /cancelled/);
  assert.throws(() => formatSignatureType(object, null, { formatType: 1 }), /must be a function/);
  assert.throws(() => formatSignatureType(object, null, { formatType: () => 1 }), /string or undefined/);
});

import { readFileSync } from 'node:fs';
import { MetadataBuilder, Writer, encodeSignature, writeMethodBody, writePE, codedIndex } from '@sharpforge/cil';
import { emitPortablePdb, attachPortablePdb, loadSymbols, readPortablePdb, PdbGuids } from '@sharpforge/symbols';
import { preflightLocalAnnotation } from '../packages/symbols/src/local-annotations.js';

const primitive = (name) => ({ kind: 'primitive', name });
const generic = (builder, name, args, assembly) => ({
  kind: 'genericInstance',
  type: { kind: name.startsWith('System.ValueTuple') ? 'valuetype' : 'class', token: builder.typeRef(name, assembly) },
  arguments: args,
});
function fixture(create, records, constants = []) {
  const builder = new MetadataBuilder('Annotations');
  const types = create(builder);
  const locals = builder.add(17, [builder.blob(encodeSignature({ kind: 'locals', types }))]);
  const body = writeMethodBody(new Uint8Array([0x2a]), locals, 1);
  builder.add(2, [1, builder.string('Fixture'), 0, 0, 1, 1]);
  builder.add(6, [0x2048, 0, 0x16, builder.string('Run'), builder.blob(new Uint8Array([0, 0, 1])), 1]);
  const metadata = builder.finish();
  const section = new Writer().zero(72).bytes(body).pad();
  const offset = section.length;
  section.bytes(metadata);
  const assembly = writePE(section.finish(), offset, metadata.length, 0);
  const pdb = emitPortablePdb(assembly, {
    methods: [
      {
        token: 0x06000001,
        scopes: [{ start: 0, end: 1, locals: types.map((_, slot) => ({ slot, name: 'v' + slot })), constants }],
      },
    ],
    custom: records,
  }).bytes;
  return { symbols: loadSymbols(attachPortablePdb(assembly, pdb), pdb), standalone: readPortablePdb(pdb) };
}
const dynamic = (row, flags, table = 51) => ({ kind: PdbGuids.dynamicLocals, parent: table * 0x1000000 + row, flags });
const tuples = (row, names, table = 51) => ({ kind: PdbGuids.tupleNames, parent: table * 0x1000000 + row, names });

test('two captured Roslyn versions annotate bound locals through native CDI payloads', () => {
  const corpus = JSON.parse(
    readFileSync(new URL('./fixtures/portable-pdb-interop/records.json', import.meta.url), 'utf8'),
  );
  for (const reference of corpus.fixtures.filter((value) => value.language === 'cs')) {
    const records = [PdbGuids.dynamicLocals, PdbGuids.tupleNames].map((kind, index) => ({
      kind,
      parent: 0x33000001 + index,
      bytes: new Uint8Array(Buffer.from(reference.records.find((record) => record.kind === kind).bytes, 'hex')),
    }));
    const { symbols, standalone } = fixture(
      (builder) => [object, generic(builder, 'System.ValueTuple`2', [primitive('int'), primitive('string')])],
      records,
    );
    const locals = symbols.scopeTree(0x06000001)[0].locals;
    assert.equal(locals[0].typeName, 'object');
    assert.equal(locals[0].displayTypeName, 'dynamic');
    assert.equal(locals[1].displayTypeName, '(int left, string right)');
    assert.equal(locals[1].type.kind, 'genericInstance');
    assert.equal(standalone.scopeTree(0x06000001)[0].locals[0].annotationReason, 'type-metadata-required');
    symbols.custom[0].flags.fill(false);
    symbols.variables[1].tupleElementNames[0] = 'Changed';
    locals[1].tupleElementNames[0] = 'AlsoChanged';
    assert.equal(symbols.scopeTree(0x06000001)[0].locals[1].displayTypeName, '(int left, string right)');
    assert.deepEqual(symbols.scopeTree(0x06000001)[0].locals[1].tupleElementNames, ['left', 'right']);
  }
});

test('dynamic flags address occurrences, with generic containers, arrays, byrefs and padding', () => {
  const { symbols } = fixture(
    (builder) => [
      generic(builder, 'System.Collections.Generic.Dictionary`2', [object, object]),
      { kind: 'szarray', element: object },
      { kind: 'byref', element: object },
    ],
    [dynamic(1, [false, false, true]), dynamic(2, [false, true]), dynamic(3, [false, true])],
  );
  assert.deepEqual(
    symbols.scopeTree(0x06000001)[0].locals.map((local) => local.displayTypeName),
    ['System.Collections.Generic.Dictionary`2<object, dynamic>', 'dynamic[]', 'dynamic&'],
  );
});

test('tuple names follow reverse nested decoding and flatten long ValueTuple rest chains', () => {
  const { symbols } = fixture(
    (builder) => [
      generic(builder, 'System.ValueTuple`2', [
        primitive('int'),
        generic(builder, 'System.ValueTuple`2', [object, primitive('string')]),
      ]),
      generic(builder, 'System.ValueTuple`8', [
        ...Array(7).fill(primitive('int')),
        generic(builder, 'System.ValueTuple`1', [primitive('int')]),
      ]),
    ],
    [
      tuples(1, ['number', 'pair', 'payload', null]),
      dynamic(1, [false, false, false, true]),
      tuples(2, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', null]),
    ],
  );
  const locals = symbols.scopeTree(0x06000001)[0].locals;
  assert.equal(locals[0].displayTypeName, '(int number, (dynamic payload, string) pair)');
  assert.equal(locals[1].displayTypeName, '(int a, int b, int c, int d, int e, int f, int g, int h)');
});

test('constant CDI joins preserve values and expose owned scope annotations', () => {
  const { symbols, standalone } = fixture(
    () => [],
    [dynamic(1, [true], 52)],
    [{ name: 'DynamicNull', type: 'object', value: null }],
  );
  assert.equal(symbols.constants[0].value, null);
  assert.equal(symbols.constants[0].displayTypeName, 'dynamic');
  assert.equal(standalone.constants[0].displayTypeName, 'dynamic');
  const result = symbols.scopeTree(0x06000001)[0].constantAnnotations;
  assert.equal(result[0].name, 'DynamicNull');
  result[0].dynamicFlags[0] = false;
  symbols.constants[0].displayTypeName = 'Changed';
  assert.equal(symbols.scopeTree(0x06000001)[0].constantAnnotations[0].displayTypeName, 'dynamic');
});

test('type-dependent constant annotations support authored TypeSpec null without claiming a C# tuple const', () => {
  let constant;
  const builder = new MetadataBuilder('ConstantType');
  const type = generic(builder, 'System.Collections.Generic.List`1', [
    generic(builder, 'System.ValueTuple`2', [primitive('int'), primitive('string')]),
  ]);
  const token = builder.typeSpec(type);
  constant = {
    name: 'TypedNull',
    signature: new Writer().u8(0x12).compressed(codedIndex('TypeDefOrRef', token)).finish(),
  };
  const { symbols } = fixture(
    (target) => {
      const tuple = generic(target, 'System.ValueTuple`2', [primitive('int'), primitive('string')]);
      const list = generic(target, 'System.Collections.Generic.List`1', [tuple]);
      target.typeSpec(list);
      return [];
    },
    [tuples(1, ['a', 'b'], 52)],
    [constant],
  );
  assert.equal(symbols.constants[0].value, null);
  assert.equal(symbols.constants[0].displayTypeName, 'System.Collections.Generic.List`1<(int a, string b)>');
});

test('lookalike tuples and mismatched flags/counts stay explicit without changing declared types', () => {
  const { symbols } = fixture(
    (builder) => [
      generic(builder, 'System.ValueTuple`2', [primitive('int'), primitive('string')], 'Custom'),
      primitive('int'),
      object,
    ],
    [tuples(1, ['a', 'b']), dynamic(2, [true]), dynamic(3, [false, true])],
  );
  assert.deepEqual(
    symbols.scopeTree(0x06000001)[0].locals.map((local) => local.annotationReason),
    ['tuple-type-mismatch', 'dynamic-type-mismatch', 'dynamic-type-mismatch'],
  );
  assert(symbols.scopeTree(0x06000001)[0].locals.every((local) => local.displayTypeName === null));
  const wrongCount = fixture(
    (builder) => [generic(builder, 'System.ValueTuple`2', [primitive('int'), primitive('string')])],
    [tuples(1, ['one'])],
  );
  assert.equal(wrongCount.symbols.scopeTree(0x06000001)[0].locals[0].annotationReason, 'tuple-name-count-mismatch');
});

test('annotation parents, duplicates, per-record and aggregate limits precede expansion', () => {
  const counts = { 51: 2, 52: 1 },
    bytes = new Uint8Array([1]);
  for (const parent of [0x06000001, 0x33000000, 0x33000003]) {
    assert.throws(() => preflightLocalAnnotation(PdbGuids.dynamicLocals, parent, bytes, counts, {}), /parent/);
  }
  const budget = {};
  preflightLocalAnnotation(PdbGuids.dynamicLocals, 0x33000001, bytes, counts, budget);
  assert.throws(() => preflightLocalAnnotation(PdbGuids.dynamicLocals, 0x33000001, bytes, counts, budget), /Duplicate/);
  assert.throws(
    () => preflightLocalAnnotation(PdbGuids.dynamicLocals, 0x33000001, new Uint8Array(129), counts, {}),
    /entry limit/,
  );
  assert.throws(
    () => preflightLocalAnnotation(PdbGuids.tupleNames, 0x33000001, new Uint8Array(1025), counts, {}),
    /entry limit/,
  );
  assert.throws(
    () => preflightLocalAnnotation(PdbGuids.tupleNames, 0x33000001, new Uint8Array(3073).fill(65), counts, {}),
    /name byte limit/,
  );
  assert.throws(
    () => preflightLocalAnnotation(PdbGuids.tupleNames, 0x33000001, new Uint8Array([65]), counts, {}),
    /Unterminated/,
  );
  assert.throws(
    () => preflightLocalAnnotation(PdbGuids.dynamicLocals, 0x33000001, bytes, counts, { entries: 65536 }),
    /entry limit/,
  );
  assert.throws(
    () => preflightLocalAnnotation(PdbGuids.dynamicLocals, 0x33000001, bytes, counts, { bytes: 1024 * 1024 }),
    /aggregate limit/,
  );
});
