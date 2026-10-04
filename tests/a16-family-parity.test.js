import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseReferenceRow, normalizeType, splitParameters } from '../packages/winui-controls/parity/signatures.js';
import { generateParityMatrix } from '../packages/winui-controls/parity/matrix.js';
import { assertNoCoverageRegression } from '../packages/winui-controls/parity/gap-export.js';
import { generateParityMarkdown } from '../packages/winui-controls/parity/docs-generator.js';

const owner = 'Microsoft.UI.Xaml.Controls.Fixture';
const row = (kind, name, signature, fields = {}) => ({ key: kind + ':' + signature, owner, kind, name, signature,
  assembly: 'Fixture', ...fields });
function fixture() {
  const reference = { windowsAppSDK: 'pinned-fixture', referenceFiles: [{ name: 'Fixture.winmd', sha256: 'a'.repeat(64) }], rows: [
    row('type', owner, owner),
    row('method', 'get_Value', owner + '::get_Value``0():System.Int32 instance'),
    row('method', 'put_Value', owner + '::put_Value``0(System.Int32):System.Void instance'),
    row('property', 'Value', owner + '::Value[]:System.Int32 get set instance'),
    row('method', 'GetText', owner + '::GetText``0(System.String&):System.Void instance'),
    row('method', 'Absent', owner + '::Absent``0():System.Void instance')
  ] };
  const manifest = { types: [{ name: owner, kind: 'control', properties: { Value: { type: 'int', readOnly: false } } },
    { name: 'System.Threading.Tasks.Task', kind: 'task' }], members: [
    { id: 1, owner, name: 'get_Value', property: 'Value', parameters: [], result: 'int', kind: 'get' },
    { id: 2, owner, name: 'set_Value', property: 'Value', parameters: ['int'], result: 'void', kind: 'set' },
    { id: 3, owner, name: 'GetText', parameters: ['string'], result: 'void', kind: 'method' },
    { id: 4, owner, name: 'Convenience', parameters: [], result: 'void', kind: 'method' },
    { id: 5, owner: 'System.Threading.Tasks.Task', name: 'Run', parameters: [], result: 'void', kind: 'method' }
  ] };
  return { reference, manifest };
}

test('metadata parser retains out/ref, generic arity and static accessor semantics', () => {
  const value = parseReferenceRow(row('method', 'GetText', owner + '::GetText``0(System.String&):System.Void instance'));
  assert.deepEqual(value.parameters, ['System.String&']);
  assert.equal(normalizeType(value.parameters[0]), 'string&');
  assert.deepEqual(splitParameters('A`1<System.String,System.Int32>,System.Int32[]'), ['A`1<System.String,System.Int32>', 'System.Int32[]']);
  assert.throws(() => splitParameters('A<B'), /Unbalanced/);
  assert.throws(() => parseReferenceRow(row('method', 'Broken', 'different::owner')), /owner/);
});

test('property accessor flags never become part of the parsed value type', () => {
  for (const [accessors, get, set] of [['get set', true, true], ['get', true, false], ['set', false, true]]) {
    for (const lifetime of ['instance', 'static']) {
      const value = parseReferenceRow(row('property', 'Value', owner + '::Value[]:System.Int32 ' + accessors + ' ' + lifetime));
      assert.equal(value.result, 'System.Int32');
      assert.deepEqual(value.parameters, []);
      assert.equal(value.get, get);
      assert.equal(value.set, set);
      assert.equal(value.isStatic, lifetime === 'static');
    }
  }
  const indexed = parseReferenceRow(row('property', 'Item', owner + '::Item[System.Int32]:A`1<System.String,System.Int32> get set instance'));
  assert.deepEqual(indexed.parameters, ['System.Int32']);
  assert.equal(indexed.result, 'A`1<System.String,System.Int32>');
});

test('parity distinguishes exact signatures, native setter projection, mismatches and untested behavior', () => {
  const { reference, manifest } = fixture();
  const matrix = generateParityMatrix(reference, manifest);
  assert.deepEqual(matrix.rows.map(value => value.api), ['present', 'present', 'projection', 'present', 'signature-mismatch', 'missing']);
  assert.equal(matrix.rows.every(value => value.behavior === 'unverified'), true);
  assert.equal(matrix.totals.registryWinUITypes, 1);
  assert.equal(matrix.totals.registryWinUIMembers, 4);
  assert.equal(matrix.totals.denominator, 6);
  assert.equal(matrix.referenceCoverage.find(value => value.namespace === 'Microsoft.UI.Composition.').imported, false);
  assert.deepEqual(matrix.deviations.map(value => value.contractId), [2, 3, 4]);
  const doc = generateParityMarkdown(matrix);
  assert.match(doc, /3 \(50.00%\)/);
  assert.doesNotMatch(doc, /System\.Threading\.Tasks\.Task/);
});

test('every missing native member has exactly one stable gap identity independent of ordering', () => {
  const { reference, manifest } = fixture();
  reference.rows.at(-1).gapId = 'GAP-EXISTING-1';
  const a = generateParityMatrix(reference, manifest);
  const b = generateParityMatrix({ ...reference, rows: [...reference.rows].reverse() }, manifest);
  assert.deepEqual(a.gaps, b.gaps);
  assert.equal(a.gaps.length, 3);
  assert.equal(new Set(a.gaps.map(value => value.referenceKey)).size, 3);
  assert.ok(a.gaps.some(value => value.gapId === 'GAP-EXISTING-1'));
  reference.rows.at(-2).gapId = 'GAP-EXISTING-1';
  assert.throws(() => generateParityMatrix(reference, manifest), /multiple/);
});

test('coverage gate fails for dropped reference members and previously exact signature regressions', () => {
  const { reference, manifest } = fixture();
  const before = generateParityMatrix(reference, manifest);
  assert.doesNotThrow(() => assertNoCoverageRegression(before, before));
  assert.throws(() => assertNoCoverageRegression(before, { rows: before.rows.slice(1) }), /denominator/);
  const changed = structuredClone(manifest);
  changed.members[0].result = 'string';
  const after = generateParityMatrix(reference, changed);
  assert.throws(() => assertNoCoverageRegression(before, after), /coverage/);
});

test('behavior qualification requires actual hashed scoped evidence and cannot bless missing API', () => {
  const { reference, manifest } = fixture();
  const key = reference.rows[1].key;
  assert.throws(() => generateParityMatrix(reference, manifest, { behaviorEvidence: [{ referenceKey: key, status: 'verified' }] }), /hashed/);
  const evidence = { referenceKey: key, status: 'verified', test: 'fixture', resultSHA256: '1'.repeat(64),
    engines: ['interpreter'], platforms: ['linux-node'] };
  const matrix = generateParityMatrix(reference, manifest, { behaviorEvidence: [evidence] });
  assert.equal(matrix.totals.behaviorVerified, 1);
  assert.throws(() => generateParityMatrix(reference, manifest, { behaviorEvidence: [{ ...evidence, referenceKey: reference.rows.at(-1).key }] }),
    /Missing native API/);
  assert.throws(() => assertNoCoverageRegression(matrix, generateParityMatrix(reference, manifest)), /Behavior evidence/);
});

test('the sealed inventory stays parseable without changing native keys, rows or gap IDs', async () => {
  const file = new URL('../planning/qualification/inventory/winui-api.json', import.meta.url);
  const reference = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(reference.windowsAppSDK, '1.8.260921001');
  assert.equal(reference.rows.length, 18_273);
  for (const source of reference.rows) {
    const parsed = parseReferenceRow(source);
    assert.equal(parsed.key, source.key);
    assert.equal(parsed.gapId, source.gapId);
    assert.equal(parsed.signature, source.signature);
  }
});

test('explicit non-WinUI profile types are documented without entering the WinUI denominator', () => {
  const { reference, manifest } = fixture();
  manifest.types.push({ name: 'SharpForge.UI.DrawingSurface', kind: 'control' });
  manifest.members.push({ id: 6, owner: 'SharpForge.UI.DrawingSurface', name: 'Clear', parameters: [], result: 'void', kind: 'method' });
  const policies = { types: { 'SharpForge.UI.DrawingSurface': { kind: 'profile-extension', reason: 'Explicit drawing helper',
    migrationTargets: ['Microsoft.UI.Composition.CompositionDrawingSurface'] } } };
  const matrix = generateParityMatrix(reference, manifest, { policies });
  const entry = matrix.deviations.find(value => value.contractId === 6);
  assert.equal(entry.review, 'documented');
  assert.equal(entry.migrationTargets[0], 'Microsoft.UI.Composition.CompositionDrawingSurface');
  assert.equal(matrix.totals.registryWinUITypes, 1);
  assert.equal(matrix.totals.registryWinUIMembers, 4);
  assert.equal(matrix.totals.denominator, 6);
});
