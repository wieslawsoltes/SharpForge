import test from 'node:test';
import assert from 'node:assert/strict';
import { token } from '@sharpforge/cil';
import {
  PortablePdbGenerations, PortablePdbRevisionMap, SymbolError, emitPortablePdbDelta, writeSequencePoints,
} from '@sharpforge/symbols';
import { aggregateCounts, updatedToken, baselineFixture, deltaFixture, sequencePoint } from './support/pdb-delta.js';

function reference(history, overrides = {}) {
  return { baselineId: history.baselineId, generation: 0, methodToken: updatedToken, revision: 1, ...overrides };
}
function update(history) {
  history.append(deltaFixture(), { baselineId: history.baselineId, previousPdbId: history.pdbId,
    generation: history.generation + 1, typeSystemRowCounts: aggregateCounts });
}
function code(operation, expected) {
  assert.throws(operation, (error) => error instanceof SymbolError && error.code === expected);
}

test('old snapshots preserve old points after updates and expose immutable generation/revision identities', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const revisions = new PortablePdbRevisionMap(history);
  const old = revisions.capture(reference(history));
  update(history);
  const current = revisions.capture(reference(history, { generation: 1, revision: 2 }));
  assert.equal(old.location(0).startLine, 2);
  assert.equal(current.location(0).startLine, 102);
  assert.equal(old.points[0].startLine, 2);
  assert.equal(current.reference.symbolGeneration, 1);
  assert.equal(current.reference.generation, 1);
  assert.equal(current.reference.revision, 2);
  assert(Object.isFrozen(old.reference));
  old.points[0].startLine = 500;
  const document = old.getDocument(1);
  document.name = 'changed.cs';
  assert.equal(old.location(0).startLine, 2);
  assert.equal(old.location(0).source, 'Generation.cs');
  const unchanged = revisions.capture(reference(history, { generation: 1, methodToken: token(6, 1) }));
  assert.equal(unchanged.reference.generation, 1);
  assert.equal(unchanged.reference.symbolGeneration, 0);
  assert.equal(unchanged.reference.revision, 1);
});

test('a revision triple must match the selected generation and baseline exactly', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const revisions = new PortablePdbRevisionMap(history);
  update(history);
  for (const overrides of [{ revision: 2 }, { generation: 1, revision: 1 }, { revision: 0 }, { revision: 1.5 }]) {
    code(() => revisions.capture(reference(history, overrides)), 'PDB_METHOD_REVISION_MISMATCH');
  }
  code(() => revisions.capture(reference(history, { baselineId: '0'.repeat(40) })), 'PDB_BASELINE_MISMATCH');
  for (const generation of [undefined, -1, 2, 0.5]) {
    code(() => revisions.capture(reference(history, { generation })), 'PDB_GENERATION_MISMATCH');
  }
  code(() => revisions.capture(reference(history, { methodToken: token(6, 4) })), 'PDB_METHOD_TOKEN');
  assert.equal(revisions.capture(reference(history)).location(0).startLine, 2);
});

test('snapshots retain owned maps after the generation provider is disposed', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const revisions = new PortablePdbRevisionMap(history);
  const oldReference = reference(history);
  const snapshot = revisions.capture(oldReference);
  history.dispose();
  assert.equal(snapshot.location(0).startLine, 2);
  assert.equal(snapshot.getDocument(1).name, 'Generation.cs');
  code(() => revisions.capture(oldReference), 'PDB_GENERATIONS_DISPOSED');
  revisions.dispose();
  revisions.dispose();
  assert.equal(snapshot.disposed, true);
  code(() => snapshot.location(0), 'PDB_SYMBOL_SNAPSHOT_DISPOSED');
  code(() => snapshot.points, 'PDB_SYMBOL_SNAPSHOT_DISPOSED');
  code(() => revisions.capture(oldReference), 'PDB_REVISION_MAP_DISPOSED');
});

test('shared method-revision maps charge points once and release cache budgets with the last lease', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const revisions = new PortablePdbRevisionMap(history, { maxPoints: 1, maxDocuments: 1 });
  const first = revisions.capture(reference(history));
  const second = revisions.capture(reference(history));
  const other = reference(history, { methodToken: token(6, 1) });
  code(() => revisions.capture(other), 'PDB_REVISION_BUDGET');
  first.dispose();
  first.dispose();
  assert.equal(second.points.length, 1);
  code(() => revisions.capture(other), 'PDB_REVISION_BUDGET');
  second.dispose();
  assert.equal(revisions.capture(other).points[0].startLine, 1);
});

test('snapshot count, documents, invalid limits and cancellation reject atomically', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const bounded = new PortablePdbRevisionMap(history, { maxSnapshots: 1 });
  const first = bounded.capture(reference(history));
  code(() => bounded.capture(reference(history)), 'PDB_REVISION_BUDGET');
  first.dispose();
  const cancelled = new AbortController();
  cancelled.abort();
  code(() => bounded.capture(reference(history), { signal: cancelled.signal }), 'PDB_REVISION_CANCELLED');
  assert.equal(bounded.capture(reference(history)).points.length, 1);
  code(() => new PortablePdbRevisionMap(history, { maxDocuments: 0 }).capture(reference(history)), 'PDB_REVISION_BUDGET');
  for (const options of [{ maxPoints: -1 }, { maxSnapshots: 0 }, { maxDocuments: Infinity }]) {
    code(() => new PortablePdbRevisionMap(history, options), 'PDB_REVISION_LIMIT');
  }
  code(() => new PortablePdbRevisionMap({}), 'PDB_REVISION_SOURCE');
});

test('scalar revision and point-only queries return independent facts without unrelated scope or CDI records', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  update(history);
  assert.deepEqual(history.getMethodRevision(updatedToken), { methodToken: updatedToken, generation: 1, revision: 2, pointCount: 1 });
  const points = history.getSequencePoints(updatedToken);
  points[0].startLine = 99;
  assert.equal(history.getSequencePoints(updatedToken)[0].startLine, 102);
  const snapshot = new PortablePdbRevisionMap(history).capture(reference(history, { generation: 1, revision: 2 }));
  code(() => snapshot.location(-1), 'PDB_METHOD_OFFSET');
  code(() => snapshot.getDocument(2), 'PDB_DOCUMENT_ID');
});

test('snapshot document identity avoids embedded source copies and hidden sequence points remain barriers', () => {
  const history = new PortablePdbGenerations(baselineFixture());
  const output = emitPortablePdbDelta({ sources: [{ uri: 'Generation.cs', text: 'source text' }],
    methods: [{ token: updatedToken, codeSize: 4, points: [sequencePoint(102)] }] }, {
    baselineId: history.baselineId, previousPdbId: history.pdbId, generation: 1,
    typeSystemRowCounts: aggregateCounts, deltaRowCounts: { 0: 1, 6: 1 },
  }, { embedSources: true });
  history.append(output.bytes, output);
  assert.equal(history.getDocument(1, 1).embedded.length, 11);
  assert.equal(history.getDocument(1, 1, { includeSource: false }).embedded, undefined);
  const snapshot = new PortablePdbRevisionMap(history).capture(reference(history, { generation: 1, revision: 2 }));
  assert.equal(snapshot.getDocument(1).embedded, undefined);
  const hidden = deltaFixture((builder) => {
    builder.rows[49][0][1] = builder.blob(writeSequencePoints([
      sequencePoint(102), { offset: 1, document: 1, hidden: true }, { ...sequencePoint(104), offset: 2 },
    ], 1, 7));
  });
  history.append(hidden, { baselineId: history.baselineId, previousPdbId: history.pdbId, generation: 2,
    typeSystemRowCounts: aggregateCounts });
  const next = new PortablePdbRevisionMap(history).capture(reference(history, { generation: 2, revision: 3 }));
  assert.equal(next.location(0).startLine, 102);
  assert.equal(next.location(1), null);
  assert.equal(next.location(2).startLine, 104);
});
