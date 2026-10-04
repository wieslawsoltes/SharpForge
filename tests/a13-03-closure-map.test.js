import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPE, codedIndex } from '@sharpforge/cil';
import { loadSymbols, emitPortablePdb, attachPortablePdb, PdbGuids } from '@sharpforge/symbols';
import { createClosureLookup } from '../packages/symbols/src/closure-map.js';
import { createHoistedLocalLookup } from '../packages/symbols/src/hoisted-locals.js';

const directory = new URL('./fixtures/portable-pdb-closure-map/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('reference.json', directory), 'utf8'));
const assembly = new Uint8Array(readFileSync(new URL('ClosureMap.dll', directory)));
const pdb = new Uint8Array(readFileSync(new URL('ClosureMap.pdb', directory)));
const load = (options) => loadSymbols(assembly, pdb, options);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cases = fixture.native.types.flatMap((type) => {
  const map = fixture.native.maps.find((map) => map.containingType === type.enclosingType);
  const name = map.typeName === 'Fixture' ? 'captured' : 'other';
  return map.lambdas.map((_lambda, ordinal) => ({
    available: true,
    reason: null,
    methodToken: type.methods.find((method) => method.name === `<Nested>b__${ordinal}`).methodToken,
    containingMethod: map.containingMethod,
    methodOrdinal: map.methodOrdinal,
    lambdaOrdinal: ordinal,
    syntaxOffset: map.lambdas[ordinal].syntaxOffset,
    closureType: type.typeToken,
    closureOrdinal: map.lambdas[ordinal].closureOrdinal,
    closureSyntaxOffset: map.closures[map.lambdas[ordinal].closureOrdinal].syntaxOffset,
    captures: [type.fields.find((field) => field.name === name)],
  }));
});

function changedMaps(change) {
  const custom = structuredClone(load().custom.filter((record) => record.kind === PdbGuids.encLambdas));
  for (const record of custom) delete record.bytes;
  const bytes = emitPortablePdb(assembly, { custom: change(custom) }).bytes;
  return loadSymbols(attachPortablePdb(assembly, bytes), bytes);
}

function mutateName(find, mutate) {
  const bytes = new Uint8Array(assembly);
  const metadata = readPE(bytes, { inspection: true }).metadata;
  const index = find(metadata);
  const heap = metadata.streams.get('#Strings');
  mutate(bytes, heap.byteOffset - bytes.byteOffset + index);
  return loadSymbols(bytes, pdb);
}

test('native fixture pins compiler/source/assembly/PDB provenance', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.match(fixture.reference.compilerVersion, /^5\.3\./);
  assert.match(fixture.reference.compilerSha256, /^[a-f0-9]{64}$/);
  assert.equal(hash(assembly), fixture.reference.assemblySha256);
  assert.equal(hash(pdb), fixture.reference.pdbSha256);
  const source = readFileSync(new URL('../packages/symbols/interop/ClosureMap/Program.cs', import.meta.url), 'utf8');
  assert.equal(hash(source.replaceAll('\r\n', '\n')), fixture.reference.sourceSha256);
});

test('nested lambda identities and captured names match native EnC maps in distinct enclosing types', () => {
  const symbols = load();
  assert.equal(cases.length, 4);
  assert.equal(new Set(cases.map((result) => result.containingMethod)).size, 2);
  assert.deepEqual(
    cases.map((result) => result.captures[0].name),
    ['captured', 'captured', 'other', 'other'],
  );
  for (const expected of cases) assert.deepEqual(symbols.closureInfo(expected.methodToken), expected);
});

test('missing or inconsistent lambda metadata produces explicit unavailable results', () => {
  assert.equal(changedMaps(() => []).closureInfo(cases[0].methodToken).reason, 'missing-lambda-map');
  const missing = changedMaps((maps) => {
    maps[0].lambdas = [];
    return maps;
  });
  assert.equal(missing.closureInfo(cases[0].methodToken).reason, 'inconsistent-lambda-map');
  assert.deepEqual(missing.closureInfo(cases[0].methodToken).captures, []);
  assert.equal(load().closureInfo(0x06ffffff).reason, 'unsupported-or-unmapped-lambda');
});

test('unsupported display-class naming variants and capture links are not guessed', () => {
  const variant = mutateName(
    (metadata) => metadata.row(cases[0].closureType)[1],
    (bytes, start) => {
      const index = fixture.native.types.find((type) => type.typeToken === cases[0].closureType).name.lastIndexOf('_');
      bytes[start + index] = 35;
    },
  );
  assert.equal(variant.closureInfo(cases[0].methodToken).reason, 'unsupported-closure-convention');
  const link = mutateName(
    (metadata) => metadata.row(cases[0].captures[0].fieldToken)[1],
    (bytes, start) => {
      bytes[start] = 60;
    },
  );
  assert.equal(link.closureInfo(cases[0].methodToken).reason, 'unsupported-capture-field');
});

test('generic owners are unsupported even when generated names have no arity suffix', () => {
  const pe = readPE(assembly, { inspection: true });
  for (const owner of [cases[0].closureType, fixture.native.types[0].enclosingType, cases[0].containingMethod]) {
    const rows = [...(pe.metadata.rows[42] ?? []), [0, 0, codedIndex('TypeOrMethodDef', owner), 0]];
    const metadata = {
      ...pe.metadata,
      rows: { ...pe.metadata.rows, 42: rows },
      counts: { ...pe.metadata.counts, 42: rows.length },
    };
    assert.equal(
      createClosureLookup({ metadata }, load())(cases[0].methodToken).reason,
      'unsupported-closure-convention',
    );
  }
});

test('lookup owns metadata and PDB facts before first use and returns independent captured fields', () => {
  const bytes = new Uint8Array(assembly);
  const pdbBytes = new Uint8Array(pdb);
  const symbols = loadSymbols(bytes, pdbBytes);
  bytes.fill(0);
  pdbBytes.fill(0);
  for (const record of symbols.custom) if (record.kind === PdbGuids.encLambdas) record.lambdas.length = 0;
  symbols.custom.length = 0;
  for (const expected of cases) {
    const result = symbols.closureInfo(expected.methodToken);
    assert.deepEqual(result, expected);
    result.captures[0].name = 'changed';
    result.captures.push({ name: 'injected' });
    assert.deepEqual(symbols.closureInfo(expected.methodToken), expected);
  }
});

test('aggregate limits, unbound inspection and invalid queries stay explicit', () => {
  assert.throws(() => load({ maxClosureEntries: 1 }), /Closure entry limit exceeded/);
  const original = load();
  const counts = readPE(assembly, { inspection: true }).metadata.counts;
  let entries = original.custom.length;
  for (const table of [2, 3, 4, 5, 6, 41, 42]) entries += counts[table] ?? 0;
  for (const record of original.custom)
    if (record.kind === PdbGuids.encLambdas) entries += record.closures.length + record.lambdas.length;
  assert.throws(() => load({ maxClosureEntries: entries }), /Closure entry limit exceeded/);
  assert.deepEqual(load({ maxClosureEntries: entries + 4 }).closureInfo(cases[0].methodToken), cases[0]);
  for (const maxClosureEntries of [-1, NaN, 1.5, 1_000_001]) {
    assert.throws(() => load({ maxClosureEntries }), /Invalid closure entry limit/);
  }
  const pe = readPE(assembly, { inspection: true });
  const unbound = createClosureLookup(pe, { ...load(), bound: false });
  assert.equal(unbound(cases[0].methodToken).reason, 'unbound-symbols');
  for (const token of [0, 0x02000001, 0x106000001, NaN])
    assert.throws(() => load().closureInfo(token), /Invalid closure method query/);
});

test('physical pointer counts are bounded before list expansion for closures and hoisted locals', () => {
  for (const pointer of [3, 5]) {
    const metadata = {
      counts: { 2: 1, 4: 1, 6: 2, [pointer]: 1_000_001 },
      list: () => {
        throw Error('expanded before pointer budget');
      },
    };
    const stateMachines = [{ moveNext: 0x06000001, kickoff: 0x06000002 }];
    const closure = { kind: PdbGuids.encLambdas, methodOrdinal: 0, closures: [], lambdas: [] };
    const hoisted = { kind: PdbGuids.hoistedScopes, parent: 0x06000001, scopes: [] };
    assert.throws(
      () => createClosureLookup({ metadata }, { bound: true, custom: [closure] }),
      /Closure entry limit exceeded/,
    );
    assert.throws(
      () => createHoistedLocalLookup({ metadata }, { bound: true, stateMachines, custom: [hoisted] }),
      /Hoisted local index entry limit exceeded/,
    );
  }
});

test('duplicate EnC method ordinals and FieldPtr ownership cannot select an arbitrary capture', () => {
  const pe = readPE(assembly, { inspection: true });
  const symbols = load();
  symbols.custom.push({ ...symbols.custom.find((record) => record.kind === PdbGuids.encLambdas) });
  assert.throws(() => createClosureLookup(pe, symbols), /Ambiguous closure method ordinal/);
  const field = cases[0].captures[0].fieldToken;
  const metadata = {
    ...pe.metadata,
    uncompressed: true,
    counts: { ...pe.metadata.counts, 3: 2 },
    list: (owner, column) =>
      column === 'FieldList' && owner === cases[0].closureType ? [field, field] : pe.metadata.list(owner, column),
  };
  assert.throws(() => createClosureLookup({ metadata }, load()), /Ambiguous closure field ownership/);
});
