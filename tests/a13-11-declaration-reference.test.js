import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AssemblyInspector, AssemblyUsageAnalysis } from '@sharpforge/cil';
import { createAssemblyMethodRelations } from '@sharpforge/clr';
import { baseContext } from './clr-methods-base-fixtures.js';

const fixture = new URL('./fixtures/declaration-relations/native.json', import.meta.url);
const tuple = entry => [entry.relation, entry.sourceToken, entry.targetToken, entry.implementingTypeToken].join(':');

test('A13 local declaration relation sets equal independent CoreCLR base-definition and interface-map observations', async () => {
  const reference = JSON.parse(readFileSync(fixture, 'utf8'));
  const bytes = Buffer.from(reference.image, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.imageSha256);
  assert.match(reference.native.runtime, /^\.NET 10\./);
  const module = (await baseContext().loadFromStream(bytes)).manifestModule;
  const snapshot = await createAssemblyMethodRelations(module);
  assert.deepEqual(snapshot.diagnostics, []);
  assert.deepEqual(snapshot.entries.map(tuple).sort(), reference.native.entries.map(tuple).sort());
  const analysis = new AssemblyUsageAnalysis(new AssemblyInspector(bytes), { methodRelations: snapshot });
  for (const relation of ['overridden-by', 'implemented-by']) {
    const targets = new Set(reference.native.entries.filter(entry => entry.relation === relation).map(entry => entry.targetToken));
    for (const target of targets) {
      const expected = reference.native.entries.filter(entry => entry.relation === relation && entry.targetToken === target);
      const actual = analysis.query(relation, target);
      assert.equal(actual.complete, true);
      assert.deepEqual(actual.entries.map(tuple).sort(), expected.map(tuple).sort());
    }
  }
  assert.equal(module.methodBodyReadCount, 0);
});
