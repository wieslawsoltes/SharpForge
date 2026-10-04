import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PortablePdbGenerations, readPortablePdbDelta } from '@sharpforge/symbols';

const fixture = new URL('./fixtures/portable-pdb-generations/', import.meta.url);

test('captured Roslyn EmitDifference generations agree with native SRM and retain old method maps', () => {
  const reference = JSON.parse(readFileSync(new URL('reference.json', fixture), 'utf8'));
  for (const [file, expected] of Object.entries(reference.artifacts)) {
    assert.equal(createHash('sha256').update(readFileSync(new URL(file, fixture))).digest('hex'), expected, file);
  }
  const history = new PortablePdbGenerations(readFileSync(new URL('baseline.pdb', fixture)));
  for (const item of reference.generations.slice(1)) {
    const bytes = readFileSync(new URL(`delta${item.generation}.pdb`, fixture));
    const parsed = readPortablePdbDelta(bytes, { typeSystemRowCounts: item.typeSystemRowCounts });
    assert.deepEqual(parsed.methods.map(({ token, localSignature, points }) => ({ token, localSignature, points })),
      item.symbols.methods.map(({ token, localSignature, points }) => ({ token, localSignature, points })));
    history.append(bytes, { baselineId: history.baselineId, previousPdbId: history.pdbId,
      generation: item.generation, typeSystemRowCounts: item.typeSystemRowCounts, pdbId: item.symbols.id });
  }
  const updated = reference.generations[1].symbols.methods[0].token;
  const baseline = reference.generations[0].symbols.methods.find((method) => method.token === updated);
  assert.deepEqual(history.getMethodByVersion(updated, 1).points, baseline.points);
  assert.deepEqual(history.getMethodByVersion(updated, 2).points, reference.generations[1].symbols.methods[0].points);
  assert.equal(history.getMethodByVersion(updated, 3).generation, 1);
  assert.equal(history.getMethodByVersion(updated, 3).revision, 2);
});
