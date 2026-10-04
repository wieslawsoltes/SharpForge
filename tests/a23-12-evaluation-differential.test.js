import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMSBuildEvaluations, qualifyMSBuildCorpus} from '@sharpforge/msbuild';
import {readFile} from 'node:fs/promises';
import {msbuildDifferentialCorpus} from './msbuild-differential/corpus.js';
import {evaluatePortableFixture} from './msbuild-differential/portable.js';

test('A23 T12 differential identifies individual property/item differences and preserves ordered item semantics', () => {
  const result = compareMSBuildEvaluations({properties: {a: 'one'}, evaluatedItems: {Compile: [{identity: 'A.cs', metadata: {Link: 'A'}}]}},
    {Properties: {A: 'two'}, Items: {Compile: [{Identity: 'A.cs', Link: 'B'}, {Identity: 'B.cs'}]}},
    {feature: 'items', propertyNames: ['A'], itemNames: ['Compile'], metadataNames: {Compile: ['Link']}});
  assert.equal(result.equal, false);
  assert.deepEqual(result.differences.map(value => [value.kind, value.name]), [['property', 'A'], ['item', 'Compile'], ['item', 'Compile']]);
  const missing = compareMSBuildEvaluations({properties: {}}, {Properties: {A: ''}}, {propertyNames: ['A']});
  assert.equal(missing.equal, false);
});

test('A23 T12 never qualifies missing native runs and rejects unblocked native-only features', async () => {
  const corpus = [{id: 'custom-task', feature: 'custom-tasks'}];
  const boundary = [{id: 'custom-tasks', status: 'native-only', diagnostic: 'SFP1004'}];
  const missing = await qualifyMSBuildCorpus({corpus, boundary, evaluatePortable: async () => ({diagnostics: []})});
  assert.equal(missing.success, false);
  assert.equal(missing.cases[0].status, 'boundary-violation');
  const blocked = await qualifyMSBuildCorpus({corpus, boundary,
    evaluatePortable: async () => ({diagnostics: [{code: 'SFP1004', severity: 'error'}]})});
  assert.equal(blocked.cases[0].status, 'boundary-enforced');
  assert.equal(blocked.qualification, 'native-not-run');
  const nativeUnused = await qualifyMSBuildCorpus({corpus, boundary,
    evaluatePortable: async () => ({diagnostics: [{code: 'SFP1004', severity: 'error'}]}),
    evaluateNative: async () => { assert.fail('A native-only boundary fixture must not execute its target'); }});
  assert.equal(nativeUnused.success, false);
  assert.equal(nativeUnused.qualification, 'native-not-run');
});

test('A23 T12 supported discrepancies fail while approximated differences remain fully reported', async () => {
  const corpus = [{id: 'one', feature: 'properties', propertyNames: ['A']}, {id: 'two', feature: 'approx', propertyNames: ['A']}];
  const boundary = [{id: 'properties', status: 'supported'}, {id: 'approx', status: 'approximated'}];
  const report = await qualifyMSBuildCorpus({corpus, boundary,
    evaluatePortable: async () => ({properties: {a: 'one'}}), evaluateNative: async () => ({Properties: {A: 'two'}}),
    reference: {version: 'unit-test-comparator-input', nativeQualification: false}});
  assert.equal(report.success, false);
  assert.deepEqual(report.cases.map(value => value.status), ['regression', 'documented-difference']);
  assert.equal(report.divergenceCount, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(qualifyMSBuildCorpus({corpus, boundary, evaluatePortable: async () => ({}), signal: controller.signal}), {name: 'AbortError'});
});

test('A23 T12 every declared native-only feature has fixtures with its exact blocking diagnostic', async () => {
  const boundary = JSON.parse(await readFile(new URL('../packages/project-system/src/evaluation/boundary.json', import.meta.url), 'utf8'));
  const statuses = new Set(['supported', 'approximated', 'native-only']);
  for (const [name, feature] of Object.entries(boundary.features)) {
    assert(statuses.has(feature.status), name);
    if (feature.status !== 'native-only') continue;
    assert(feature.diagnosticCode, name);
    assert(feature.fixtures.length, name);
    for (const id of feature.fixtures) assert(msbuildDifferentialCorpus.some(fixture => fixture.id === id && fixture.feature === name), id);
  }
  const corpus = msbuildDifferentialCorpus.filter(fixture => boundary.features[fixture.feature].status === 'native-only');
  const report = await qualifyMSBuildCorpus({corpus, boundary, evaluatePortable: evaluatePortableFixture});
  for (const fixture of report.cases) assert.equal(fixture.status, 'boundary-enforced', JSON.stringify(fixture));
  assert.equal(report.qualification, 'native-not-run');
});
