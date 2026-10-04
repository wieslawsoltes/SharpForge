import assert from 'node:assert/strict';
import test from 'node:test';
import { replayMetadataGenerations } from './fixtures/metadata-generations/replay.mjs';
import { verifyMetadataGenerationCapture } from './fixtures/metadata-generations/verify.mjs';

test('retained native SRM generations agree on rows, introduction mappings, heaps and history', async () => {
  const { record, inputs } = await verifyMetadataGenerationCapture();
  for (const [name, native] of Object.entries(record.corpora)) {
    const replay = replayMetadataGenerations(native, inputs[name], assert.deepEqual);
    assert.deepEqual(replay.totals, native.replay, name + ' exact native replay coverage');
    assert.equal(replay.reader.generation, 2);
    assert.ok(replay.totals.rows > 0 && replay.totals.historicalRows > 0 && replay.totals.entityMappings > 0);
    assert.ok(replay.totals.heapMappings > 0 && replay.totals.heapValues > 0);
    replay.reader.dispose();
  }
});

test('the mixed native corpus includes inserts, updates, a new field and non-ASCII user strings', async () => {
  const { record, inputs } = await verifyMetadataGenerationCapture();
  const native = record.corpora.mixed, generations = native.generations;
  assert.equal(generations[1].counts[6], generations[0].counts[6] + 1);
  assert.equal(generations[2].counts[6], generations[1].counts[6] + 1);
  assert.equal(generations[1].counts[4], (generations[0].counts[4] ?? 0) + 1);
  assert.equal(generations[2].counts[4], generations[1].counts[4]);
  const { reader } = replayMetadataGenerations(native, inputs.mixed, assert.deepEqual);
  const methods = new Map(reader.rows('MethodDef').rows.map(row => [reader.heapEntry('#Strings', row.values[3]).value, row]));
  for (const [name, sourceGeneration, introducingGeneration] of [['Old', 1, 0], ['Stable', 0, 0], ['Added', 2, 1], ['AddedAgain', 2, 2]]) {
    const row = methods.get(name);
    assert.ok(row, name);
    assert.equal(row.generation, sourceGeneration, name + ' latest raw row');
    assert.equal(reader.getGenerationHandle({ kind: 'entity', value: row.token }).generation, introducingGeneration, name + ' introduction');
  }
  const values = new Set(generations[2].heapMappings.filter(value => value.kind === 'userString' && value.success && value.readSuccess)
    .map(value => value.heapValue));
  for (const value of ['baseline', 'first update λ', 'first insert', 'second update 😀', 'second insert']) assert.ok(values.has(value), value);
  reader.dispose();
});
