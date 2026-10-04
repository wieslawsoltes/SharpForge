import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PortablePdbGenerations, PortablePdbRevisionMap, SymbolError } from '@sharpforge/symbols';

const fixture = new URL('./fixtures/portable-pdb-generations/', import.meta.url);

test('generation-bound snapshots preserve exact native Roslyn method maps across two real updates', () => {
  const reference = JSON.parse(readFileSync(new URL('reference.json', fixture), 'utf8'));
  const artifact = (name) => {
    const bytes = readFileSync(new URL(name, fixture));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.artifacts[name], name);
    return bytes;
  };
  const history = new PortablePdbGenerations(artifact('baseline.pdb'));
  const revisions = new PortablePdbRevisionMap(history);
  const updated = reference.generations[1].symbols.methods[0];
  const baseline = reference.generations[0].symbols.methods.find((method) => method.token === updated.token);
  const frame = { baselineId: history.baselineId, generation: 0, methodToken: updated.token, revision: 1 };
  const old = revisions.capture(frame);
  for (const item of reference.generations.slice(1)) {
    history.append(artifact(`delta${item.generation}.pdb`), {
      baselineId: history.baselineId, previousPdbId: history.pdbId, generation: item.generation,
      typeSystemRowCounts: item.typeSystemRowCounts, pdbId: item.symbols.id,
    });
  }
  const current = revisions.capture({ ...frame, generation: 2, revision: 2 });
  assert.equal(current.reference.generation, 2);
  assert.equal(current.reference.symbolGeneration, 1);
  assert.deepEqual(old.points, baseline.points);
  assert.deepEqual(current.points, updated.points);
  const oldPoint = baseline.points.find((point) => !point.hidden);
  const newPoint = updated.points.find((point) => !point.hidden);
  assert.equal(old.location(oldPoint.offset).startLine, oldPoint.startLine);
  assert.equal(current.location(newPoint.offset).startLine, newPoint.startLine);
  assert.notEqual(oldPoint.startLine, newPoint.startLine);
  const before = current.getDocument(newPoint.document).hash;
  current.getDocument(newPoint.document).hash.fill(0);
  assert.deepEqual(current.getDocument(newPoint.document).hash, before);
  assert.throws(() => revisions.capture({ ...frame, generation: 2 }),
    (error) => error instanceof SymbolError && error.code === 'PDB_METHOD_REVISION_MISMATCH');
  history.dispose();
  assert.deepEqual(old.points, baseline.points);
  assert.deepEqual(current.points, updated.points);
  revisions.dispose();
  assert.equal(old.disposed, true);
  assert.equal(current.disposed, true);
});
