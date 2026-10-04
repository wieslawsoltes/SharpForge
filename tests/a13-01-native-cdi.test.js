import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PdbGuids,
  readCustomDebugInformation as decode,
  writeCustomDebugInformation as encode,
} from '@sharpforge/symbols';

const corpus = JSON.parse(
  await readFile(new URL('./fixtures/portable-pdb-interop/records.json', import.meta.url), 'utf8'),
);
const source = (
  await readFile(new URL('../packages/symbols/interop/RoslynFixture.cs', import.meta.url), 'utf8')
).replaceAll('\r\n', '\n');

function verifySourceOrdinals(fixture) {
  const records = fixture.records.map((record) => ({
    kind: record.kind,
    parent: record.parent,
    ...decode(record.kind, new Uint8Array(Buffer.from(record.bytes, 'hex'))),
  }));
  const localsStart = source.indexOf('{', source.indexOf('int Locals('));
  const lambdaMap = records.find((record) => record.kind === PdbGuids.encLambdas);
  assert.equal(lambdaMap.methodOrdinal, 0);
  assert.deepEqual(lambdaMap.closures, [{ syntaxOffset: 0 }]);
  assert.deepEqual(lambdaMap.lambdas, [
    { syntaxOffset: source.indexOf('argument + input') - localsStart, closureOrdinal: 0 },
    { syntaxOffset: source.indexOf('argument + 1') - localsStart, closureOrdinal: -1 },
  ]);
  const slots = records.find((record) => record.kind === PdbGuids.encSlots && record.parent === lambdaMap.parent).slots;
  assert.deepEqual(
    slots.filter((slot) => slot.kind === 0),
    ['dynamicValue', 'tuple =', 'text =', 'closure =', 'staticLambda ='].map((name) => ({
      kind: 0,
      syntaxOffset: source.indexOf(name, localsStart) - localsStart,
      ordinal: 0,
    })),
  );
  const states = records.filter((record) => record.kind === PdbGuids.encStates).flatMap((record) => record.states);
  assert.deepEqual(states, [
    {
      stateNumber: 0,
      syntaxOffset: source.indexOf('await Task') - source.indexOf('{', source.indexOf('Async(int')),
      relativeOrdinal: 0,
    },
    {
      stateNumber: 1,
      syntaxOffset: source.indexOf('yield return') - source.indexOf('{', source.indexOf('Iterator(int')),
      relativeOrdinal: 0,
    },
  ]);
}

test('pinned native corpus spans two Roslyn versions and both source languages', () => {
  assert.equal(corpus.schemaVersion, 1);
  assert.equal(new Set(corpus.fixtures.map((fixture) => fixture.version)).size, 2);
  assert.deepEqual([...new Set(corpus.fixtures.map((fixture) => fixture.language))].sort(), ['cs', 'vb']);
  const kinds = new Set(corpus.fixtures.flatMap((fixture) => fixture.records.map((record) => record.kind)));
  for (const name of [
    'sourceLink',
    'asyncSteps',
    'hoistedScopes',
    'dynamicLocals',
    'encSlots',
    'encStates',
    'encLambdas',
    'tupleNames',
    'compilationReferences',
    'typeDocuments',
    'primaryConstructor',
    'defaultNamespace',
    'compilationOptions',
  ])
    assert(kinds.has(PdbGuids[name]), name);
});

for (const fixture of corpus.fixtures)
  test('native CDI bytes: ' + fixture.version + ' ' + fixture.language, () => {
    assert.match(fixture.compilerSha256, /^[0-9a-f]{64}$/);
    assert.match(fixture.pdbSha256, /^[0-9a-f]{64}$/);
    for (const record of fixture.records) {
      const bytes = new Uint8Array(Buffer.from(record.bytes, 'hex'));
      const decoded = decode(record.kind, bytes);
      assert.deepEqual(encode(record.kind, decoded), bytes, record.kind);
      if (record.kind === PdbGuids.defaultNamespace) assert.equal(decoded.namespace, 'RootSymbols');
      if (record.kind === PdbGuids.typeDocuments) assert(decoded.documents.length > 0);
      if (record.kind === PdbGuids.sourceLink) {
        assert.deepEqual(decoded.sourceLink.documents, { '/src/*': 'https://example.test/source/*' });
      }
    }
    if (fixture.language === 'cs') verifySourceOrdinals(fixture);
  });
