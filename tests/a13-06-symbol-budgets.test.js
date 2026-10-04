import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Writer, codedIndex } from '@sharpforge/cil';
import { PdbGuids, PortablePdbBuilder, SymbolError, deflateStored, readPortablePdb } from '@sharpforge/symbols';

const unknownKind = '00112233-4455-6677-8899-aabbccddeeff';
function fixture({ documents = 0, methods = 0, scopes = 0, imports = 0, definitions = 0, custom = [] } = {}) {
  const builder = new PortablePdbBuilder();
  for (let index = 0; index < documents; index++) {
    const segment = builder.blob(new TextEncoder().encode(`file${index}.cs`));
    builder.add(48, [builder.blob(new Writer().u8(47).compressed(segment).finish()), 0, 0, 0]);
  }
  for (let index = 0; index < methods; index++) builder.add(49, [0, 0]);
  for (let index = 0; index < scopes; index++) builder.add(50, [1, 0, 1, 1, index, 1]);
  const namespace = builder.blob(new TextEncoder().encode('System'));
  for (let index = 0; index < imports; index++) {
    const blob = new Writer();
    if (index === 0) for (let entry = 0; entry < definitions; entry++) blob.compressed(1).compressed(namespace);
    builder.add(53, [0, builder.blob(blob.finish())]);
  }
  for (const record of custom) {
    const kind = record.kind ?? unknownKind;
    const parent = kind === PdbGuids.embeddedSource ? 0x30000001 : 1;
    builder.add(55, [codedIndex('HasCustomDebugInformation', parent), builder.guid(kind), builder.blob(record.bytes)]);
  }
  return builder.finish({ 0: 1, 6: methods }, 0).bytes;
}
const errorWith = (pattern) => (error) => error instanceof SymbolError && pattern.test(error.message);
const readAt = (bytes, budgets, options = {}) => readPortablePdb(bytes, { ...options, budgets });
const embedded = (bytes) => ({ kind: PdbGuids.embeddedSource, bytes });

for (const name of ['documents', 'methods', 'scopes', 'imports']) {
  test(`Portable PDB ${name} count accepts the boundary and fails at limit+1`, () => {
    const input = fixture({ [name]: 2, ...(name === 'scopes' ? { methods: 1 } : null) });
    readAt(input, { [name]: 2 });
    assert.throws(() => readAt(input, { [name]: 1 }), errorWith(new RegExp(name + ' budget')));
  });
}

test('import budget caps definitions across scopes as well as scope rows', () => {
  const input = fixture({ imports: 1, definitions: 2 });
  assert.equal(readAt(input, { imports: 2 }).effectiveImports(1).length, 2);
  assert.throws(() => readAt(input, { imports: 1 }), errorWith(/Import definition count/));
});

test('custom record budget also bounds zero-byte opaque records', () => {
  const input = fixture({ custom: [{ bytes: new Uint8Array() }, { bytes: new Uint8Array() }] });
  assert.equal(readAt(input, { customRecords: 2 }).custom.length, 2);
  assert.throws(() => readAt(input, { customRecords: 1 }), errorWith(/customRecords budget/));
});

test('aggregate CDI bytes charge overlapping payload handles for every copied row', () => {
  const bytes = new Uint8Array([0xff, 0x80]);
  const input = fixture({ custom: [{ bytes }, { bytes }] });
  assert.equal(readAt(input, { cdiBytes: 4 }).custom.length, 2);
  assert.throws(() => readAt(input, { cdiBytes: 3 }), errorWith(/cdiBytes budget/));
});

test('aggregate embedded source budget charges decoded bytes for compressed and stored records', () => {
  const source = new Uint8Array([65, 66]);
  for (const payload of [
    new Writer().u32(0).bytes(source).finish(),
    new Writer().u32(2).bytes(deflateStored(source)).finish(),
  ]) {
    const input = fixture({ documents: 1, custom: [embedded(payload), embedded(payload)] });
    const result = readAt(input, { embeddedSourceBytes: 4 });
    assert.deepEqual(
      result.custom.map((record) => record.source),
      [source, source],
    );
    assert.throws(() => readAt(input, { embeddedSourceBytes: 3 }), errorWith(/embeddedSourceBytes budget/));
  }
});

test('all source sizes are preflighted before the first compressed payload is inflated', () => {
  const malformed = new Writer().u32(2).u8(0xff).finish();
  const input = fixture({ documents: 1, custom: [embedded(malformed), embedded(malformed)] });
  assert.throws(() => readAt(input, { embeddedSourceBytes: 3 }), errorWith(/embeddedSourceBytes budget/));
});

test('zero budgets allow an empty PDB and reject a nonempty method category', () => {
  const zero = {
    documents: 0,
    methods: 0,
    scopes: 0,
    imports: 0,
    customRecords: 0,
    cdiBytes: 0,
    embeddedSourceBytes: 0,
  };
  assert.equal(readAt(fixture(), zero).format, 'Portable PDB');
  assert.throws(() => readAt(fixture({ methods: 1 }), zero), errorWith(/methods budget/));
});

test('invalid, unknown and excessive budget options fail with SymbolError before parsing', () => {
  for (const budgets of [
    null,
    [],
    1,
    { unknown: 1 },
    { documents: -1 },
    { scopes: NaN },
    { methods: 100001 },
    { cdiBytes: Infinity },
    { embeddedSourceBytes: 1.5 },
    { imports: '1' },
    { customRecords: 100001 },
  ]) {
    assert.throws(() => readAt(fixture(), budgets), errorWith(/Invalid symbol parse budget/));
  }
  for (const options of [{ maxBytes: NaN }, { maxBytes: -1 }, { maxSourceBytes: Infinity }, { maxSourceBytes: -1 }]) {
    assert.throws(() => readPortablePdb(fixture(), options), errorWith(/byte limit/));
  }
});

test('legacy file/per-source caps remain active alongside the new aggregate budget', () => {
  const source = new Writer()
    .u32(0)
    .bytes(new Uint8Array([65, 66]))
    .finish();
  const input = fixture({ documents: 1, custom: [embedded(source)] });
  assert.throws(() => readPortablePdb(input, { maxBytes: input.length - 1 }), errorWith(/oversized/));
  assert.throws(
    () => readAt(input, { embeddedSourceBytes: 4 }, { maxSourceBytes: 1 }),
    errorWith(/embedded source size/),
  );
  assert.equal(readAt(input, { embeddedSourceBytes: 2 }, { maxSourceBytes: 2 }).documents[0].embedded.length, 2);
});

test('cancellation is checked before metadata parsing and during import projection', () => {
  assert.throws(() => readPortablePdb(fixture(), { signal: AbortSignal.abort() }), errorWith(/cancelled/));
  let checks = 0;
  const signal = {
    get aborted() {
      return ++checks > 2;
    },
  };
  assert.throws(() => readPortablePdb(fixture({ imports: 1, definitions: 1 }), { signal }), errorWith(/cancelled/));
});

test('retained Roslyn source and Release fixtures remain within default budgets', () => {
  for (const [directory, name] of [
    ['portable-pdb-effective-imports', 'EffectiveImports'],
    ['portable-pdb-unnamed-slots', 'UnnamedSlots'],
  ]) {
    const input = readFileSync(new URL(`./fixtures/${directory}/${name}.pdb`, import.meta.url));
    assert(readPortablePdb(input).methods.length > 0);
  }
});
