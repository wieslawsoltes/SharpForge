import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MetadataBuilder, readMetadata, decodeTypeSignature, formatSignatureType, readPE } from '@sharpforge/cil';
import { loadSymbols, readPortablePdb, emitPortablePdb, attachPortablePdb } from '@sharpforge/symbols';
import { createImportLookup } from '../packages/symbols/src/imports.js';
import { bindImportNames } from '../packages/symbols/src/import-type-names.js';
import { readImports } from '../packages/symbols/src/import-reader.js';

const directory = new URL('./fixtures/portable-pdb-effective-imports/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('EffectiveImports.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('EffectiveImports.pdb', directory)));

test('native nested namespace import context preserves the SRM parent chain and recorded order', () => {
  const symbols = loadSymbols(assembly, pdb);
  const entries = symbols.effectiveImports(reference.native.importScope);
  assert.deepEqual(
    entries.map(({ kind, scopeId, alias = null, namespace = null, type = null, typeName = null }) => ({
      kind,
      scopeId,
      alias,
      namespace,
      type,
      typeName,
    })),
    reference.native.entries,
  );
  assert.deepEqual(
    entries.filter((entry) => entry.namespace).map((entry) => entry.namespace),
    ['System', 'System.Text'],
  );
  assert.equal(
    entries.every((entry) => entry.resolved),
    true,
  );
  assert.deepEqual(symbols.effectiveImports(0), []);
});

test('all nine import kinds survive projection with assembly and type names', () => {
  const metadata = readPE(assembly, { inspection: true }).metadata;
  const definitions = [
    { kind: 1, namespace: 'System' },
    { kind: 2, assembly: 1, namespace: 'System' },
    { kind: 3, type: 0x01000001 },
    { kind: 4, alias: 'xml', namespace: 'urn:example' },
    { kind: 5, alias: 'external' },
    { kind: 6, alias: 'external', assembly: 1 },
    { kind: 7, alias: 'Collections', namespace: 'System.Collections' },
    { kind: 8, alias: 'Imported', assembly: 1, namespace: 'System' },
    { kind: 9, alias: 'Type', type: 0x01000001 },
  ];
  const bytes = emitPortablePdb(assembly, {
    importScopes: [{ definitions: definitions.slice(0, 5) }, { parent: 1, definitions: definitions.slice(5) }],
  }).bytes;
  const symbols = loadSymbols(attachPortablePdb(assembly, bytes), bytes);
  const result = symbols.effectiveImports(2);
  assert.deepEqual(
    result.map(({ scopeId, resolved, reason, assemblyName, typeName, ...definition }) => definition),
    definitions,
  );
  assert.deepEqual(
    result.map((entry) => entry.scopeId),
    [1, 1, 1, 1, 1, 2, 2, 2, 2],
  );
  assert.equal(result[1].assemblyName, metadata.string(metadata.row(0x23000001)[6]));
  assert.equal(result[2].typeName, metadata.typeName(0x01000001));
  assert.equal(result[8].typeName, result[2].typeName);
});

test('standalone handles stay unresolved; returned lists and public metadata cannot mutate owned context', () => {
  const standalone = readPortablePdb(pdb);
  const bound = loadSymbols(assembly, pdb);
  const id = reference.native.importScope;
  assert(standalone.effectiveImports(id).some((entry) => entry.reason === 'type-metadata-required'));
  const before = bound.effectiveImports(id);
  bound.imports[id - 1].parent = 999;
  bound.imports[id - 1].definitions.length = 0;
  bound.metadata.rows[53].length = 0;
  const output = bound.effectiveImports(id);
  output[0].namespace = 'Changed';
  output.length = 0;
  assert.deepEqual(bound.effectiveImports(id), before);
  for (const invalid of [-1, 0.5, 1000000, NaN]) assert.throws(() => bound.effectiveImports(invalid), /scope id/);
});

function namedMetadata() {
  const builder = new MetadataBuilder('Imports');
  const type = builder.typeRef('System.Collections.Generic.List`1');
  const specification = builder.typeSpec({
    kind: 'genericInstance',
    type: { kind: 'class', token: type },
    arguments: [{ kind: 'primitive', name: 'int' }],
  });
  const outer = builder.add(2, [1, builder.string('Outer'), builder.string('Example'), 0, 1, 1]);
  const inner = builder.add(2, [2, builder.string('Inner'), 0, 0, 1, 1]);
  builder.add(41, [2, 1]);
  return { metadata: readMetadata(builder.finish()), specification, outer, inner };
}

test('existing public AST formatter resolves constructed and nested import type names', () => {
  const { metadata, specification, inner } = namedMetadata();
  const imports = [
    {
      id: 1,
      parent: 0,
      definitions: [
        { kind: 9, alias: 'Items', type: specification },
        { kind: 3, type: inner },
      ],
    },
  ];
  const lookup = bindImportNames(createImportLookup(imports), imports, metadata);
  assert.equal(lookup(1)[0].typeName, 'System.Collections.Generic.List`1<int>');
  assert.equal(lookup(1)[1].typeName, 'Example.Outer+Inner');
  const ast = decodeTypeSignature(new Uint8Array([0x1d, 8]), { maxDepth: 32, maxNodes: 256 });
  assert.equal(formatSignatureType(ast, metadata, { maxDepth: 32, maxNodes: 256 }), 'int[]');
  metadata.rows[2][0][1] = 0;
  assert.equal(lookup(1)[1].typeName, 'Example.Outer+Inner');
});

test('parent cycles, references, aggregate counts and maximum chain depth are bounded', () => {
  for (const parent of [-1, 1, 2]) assert.throws(() => createImportLookup([{ id: 1, parent, definitions: [] }]));
  const chain = Array.from({ length: 256 }, (_, index) => ({ id: index + 1, parent: index, definitions: [] }));
  assert.deepEqual(createImportLookup(chain)(256), []);
  assert.throws(() => createImportLookup([...chain, { id: 257, parent: 256, definitions: [] }]), /depth limit/);
  assert.throws(() => createImportLookup([{ definitions: { length: 100001 } }]), /definition count/);
  assert.throws(() => createImportLookup({ length: 100001 }), /scope count/);
});

test('import handles, name bytes and aggregate decode budgets fail before expansion', () => {
  const metadata = { externalCounts: { 1: 1, 35: 1 }, blob: () => new Uint8Array(4097) };
  assert.throws(() => readImports(new Uint8Array([1, 1]), metadata), /name byte limit/);
  assert.throws(
    () => readImports(new Uint8Array([2, 0, 0]), { ...metadata, blob: () => new Uint8Array() }),
    /assembly reference/,
  );
  assert.throws(() => readImports(new Uint8Array([3, 9]), metadata), /type reference/);
  assert.throws(() => readImports(new Uint8Array([1, 0]), metadata, { entries: 100000, bytes: 0 }), /definition count/);
  assert.throws(
    () =>
      readImports(
        new Uint8Array([1, 0]),
        { ...metadata, blob: () => new Uint8Array(1) },
        { entries: 0, bytes: 4 * 1024 * 1024 },
      ),
    /name byte limit/,
  );
});

test('TypeSpec and metadata-name limits precede type expansion', () => {
  const { metadata, specification } = namedMetadata();
  const imports = [{ id: 1, parent: 0, definitions: [{ kind: 3, type: specification }] }];
  metadata.blob = () => new Uint8Array(4097);
  assert.throws(() => bindImportNames(createImportLookup(imports), imports, metadata), /TypeSpec byte limit/);
  metadata.blob = () => new Uint8Array([0x1d, 0x12, 6]);
  assert.throws(() => bindImportNames(createImportLookup(imports), imports, metadata), /recursion limit/);
  const other = namedMetadata();
  other.metadata.streams.set('#Strings', new TextEncoder().encode('x'.repeat(3073) + '\0'));
  other.metadata.rows[1][0][1] = 0;
  other.metadata.string = () => assert.fail('Oversized name decoded');
  assert.throws(() => bindImportNames(createImportLookup(imports), imports, other.metadata), /name exceeds/);
});
