import test from 'node:test';
import assert from 'node:assert/strict';
import { token, codedIndex } from '@sharpforge/cil';
import { PortablePdbGenerations, readPortablePdb, readPortablePdbDelta, SymbolError } from '@sharpforge/symbols';
import { aggregateCounts, updatedToken, baselineFixture, deltaFixture } from './support/pdb-delta.js';

function append(history, bytes = deltaFixture(), overrides = {}) {
  return history.append(bytes, {
    baselineId: history.baselineId, previousPdbId: history.pdbId, generation: history.generation + 1,
    typeSystemRowCounts: aggregateCounts, ...overrides,
  });
}
function code(operation, expected) {
  assert.throws(operation, (error) => error instanceof SymbolError && error.code === expected);
}

test('PDB delta uses EncMap for methods, scopes and CDI while aggregate signature/resume/kickoff refs stay aggregate', () => {
  const bytes = deltaFixture();
  assert.throws(() => readPortablePdb(bytes), /non-debug tables/);
  const pdb = readPortablePdbDelta(bytes, { typeSystemRowCounts: aggregateCounts });
  assert.equal(pdb.methods[0].token, updatedToken);
  assert.equal(pdb.methods[0].localSignature, 7);
  assert.equal(pdb.scopes[0].methodToken, updatedToken);
  assert.equal(pdb.custom[0].parent, updatedToken);
  assert.deepEqual(pdb.stateMachines, [{ moveNext: updatedToken, kickoff: token(6, 3) }]);
  assert.equal(pdb.asyncInfo(updatedToken).steps[0].resumeMethod, updatedToken);
  assert.equal(pdb.metadata.rows[50][0][0], 1);
  assert.equal(pdb.metadata.externalCounts[6], 1);
  assert.equal(pdb.typeSystemRowCounts[6], 3);
});

test('generation/version lookups preserve baseline maps and retain unchanged methods across later updates', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const old = history.getMethodByVersion(updatedToken, 1);
  const delta = deltaFixture();
  append(history, delta);
  assert.equal(history.getMethodByVersion(updatedToken, 2).points[0].startLine, 102);
  assert.equal(history.getMethodByVersion(updatedToken, 1).points[0].startLine, 2);
  assert.equal(history.getMethodByVersion(token(6, 1), 2).points[0].startLine, 1);
  assert.equal(history.getMethod(updatedToken).revision, 2);
  assert.equal(history.getMethod(updatedToken).scopes[0].variables[0].name, 'updated');
  const next = deltaFixture((builder) => {
    builder.rows[31][0][0] = token(49, 1);
    delete builder.rows[54];
    delete builder.rows[55];
  });
  append(history, next);
  assert.equal(history.getMethodByVersion(updatedToken, 3).generation, 1);
  assert.equal(history.getMethodByVersion(updatedToken, 3).revision, 2);
  old.points[0].startLine = 999;
  delta.fill(0);
  const exposed = history.getMethod(updatedToken);
  exposed.points[0].startLine = 998;
  exposed.scopes[0].variables[0].name = 'changed';
  assert.equal(history.location(updatedToken, 0).startLine, 102);
  assert.equal(history.location(updatedToken, 0, 0).startLine, 2);
  assert.equal(history.getMethod(updatedToken).scopes[0].variables[0].name, 'updated');
  assert.equal(history.getDocument(1, 1).name, 'Generation.cs');
});

test('foreign baseline, skipped generation, wrong previous identity and content-id mismatches are explicit and atomic', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  for (const [overrides, expected] of [
    [{ baselineId: '0'.repeat(40) }, 'PDB_BASELINE_MISMATCH'],
    [{ previousPdbId: '0'.repeat(40) }, 'PDB_PREVIOUS_GENERATION_MISMATCH'],
    [{ generation: 2 }, 'PDB_GENERATION_MISMATCH'],
    [{ pdbId: '0'.repeat(40) }, 'PDB_GENERATION_ID'],
    [{ typeSystemRowCounts: { ...aggregateCounts, 17: 5 } }, 'PDB_DELTA_COUNTS'],
  ]) {
    code(() => append(history, undefined, overrides), expected);
    assert.equal(history.generation, 0);
    assert.equal(history.location(updatedToken, 0).startLine, 2);
  }
  append(history);
  assert.equal(history.generation, 1);
});

test('malformed maps cannot fall back to dense interpretation', () => {
  const read = (change, counts = aggregateCounts) => readPortablePdbDelta(deltaFixture(change), { typeSystemRowCounts: counts });
  for (const handle of [0, token(6, 2), token(49, 0), token(49, 4)]) {
    code(() => read((builder) => { builder.rows[31][0][0] = handle; }), 'PDB_DELTA_MAP');
  }
  for (const pair of [[2, 2], [2, 1]]) {
    code(() => read((builder, counts) => {
      builder.rows[31] = pair.map((row) => [token(49, row)]);
      builder.rows[49].push([0, 0]);
      counts[6] = 2;
    }), 'PDB_DELTA_MAP');
  }
  code(() => read((builder) => { builder.rows[31] = []; }), 'PDB_DELTA_MAP');
  code(() => read((builder) => { delete builder.rows[31]; }), 'PDB_DELTA_FORMAT');
  code(() => read((_, counts) => { counts[6] = 2; }), 'PDB_DELTA_MAP');
  code(() => readPortablePdbDelta(baselineFixture(), { typeSystemRowCounts: aggregateCounts }), 'PDB_DELTA_FORMAT');
});

test('delta-local method refs and authoritative aggregate row-count boundaries are independently checked', () => {
  for (const table of [50, 54, 55]) {
    const bytes = deltaFixture((builder) => {
      builder.rows[table][0][0] = table === 55 ? codedIndex('HasCustomDebugInformation', token(6, 2)) : 2;
    });
    code(() => readPortablePdbDelta(bytes, { typeSystemRowCounts: aggregateCounts }), 'PDB_DELTA_METHOD');
  }
  for (const typeSystemRowCounts of [undefined, [], { 6: -1 }, { 6: 0x1000000 }, { 31: 1 }, { ...aggregateCounts, 17: 0 }]) {
    code(() => readPortablePdbDelta(deltaFixture(), { typeSystemRowCounts }), 'PDB_DELTA_COUNTS');
  }
  assert.throws(() => readPortablePdbDelta(deltaFixture(), {
    typeSystemRowCounts: { ...aggregateCounts, 17: 6 },
  }), /local signature/);
});

test('cancellation and byte/row/generation limits leave the previous generation usable', () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const history = new PortablePdbGenerations(baselineFixture());
  assert.throws(() => append(history, undefined, { signal: cancelled.signal }), /cancelled/);
  assert.equal(history.generation, 0);
  code(() => append(new PortablePdbGenerations(baselineFixture(), { maxGenerations: 1 })), 'PDB_GENERATION_BUDGET');
  code(() => new PortablePdbGenerations(baselineFixture(), { maxRetainedBytes: 1 }), 'PDB_GENERATION_BUDGET');
  code(() => new PortablePdbGenerations(baselineFixture(), { maxRetainedRecords: 1 }), 'PDB_GENERATION_BUDGET');
  for (const maxGenerations of [0, NaN, 1025]) {
    code(() => new PortablePdbGenerations(baselineFixture(), { maxGenerations }), 'PDB_GENERATION_LIMIT');
  }
  assert.throws(() => readPortablePdbDelta(deltaFixture(), {
    typeSystemRowCounts: aggregateCounts, budgets: { methods: 0 },
  }), /budget exceeded/);
  append(history);
  history.dispose();
  history.dispose();
  assert.equal(history.disposed, true);
  code(() => history.getMethod(updatedToken), 'PDB_GENERATIONS_DISPOSED');
  code(() => history.append(deltaFixture()), 'PDB_GENERATIONS_DISPOSED');
});

test('new methods require an EncMap entry and old generations reject methods which did not yet exist', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const typeSystemRowCounts = { ...aggregateCounts, 6: 4 };
  code(() => append(history, undefined, { typeSystemRowCounts }), 'PDB_DELTA_MAP');
  append(history, deltaFixture((builder) => { builder.rows[31][0][0] = token(49, 4); }), { typeSystemRowCounts });
  assert.equal(history.getMethod(token(6, 4)).revision, 1);
  code(() => history.getMethod(token(6, 4), 0), 'PDB_METHOD_TOKEN');
  code(() => history.getMethodByVersion(updatedToken, 0), 'PDB_GENERATION_MISMATCH');
  code(() => history.location(updatedToken, -1), 'PDB_METHOD_OFFSET');
  code(() => history.getDocument(2, 1), 'PDB_DOCUMENT_ID');
});
