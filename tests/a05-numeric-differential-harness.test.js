import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {numericOracle, numericDifferential} from './support/numeric-differential.js';

test('A05 numeric differential runs the same source through all three routes', () => {
  const result = numericDifferential('Console.WriteLine(42);', '42\n', {family: 'harness'});
  assert.deepEqual(Object.keys(result.outputs), ['source', 'reloaded source', 'direct CIL']);
  for (const row of Object.values(result.outputs)) {
    assert.equal(row.characters, 3);
    assert(row.instructions > 0);
  }
});

test('A05 numeric differential includes engine, operands and output row on divergence', () => {
  assert.throws(() => numericDifferential('Console.WriteLine(42);', '41\n', {
    family: 'addition', operands: 'left=40,right=2'
  }), /addition \/ source \/ left=40,right=2, output row 1/);
});

test('A05 numeric differential enforces execution and output quotas', () => {
  assert.throws(() => numericDifferential('while (true) { }', '', {
    family: 'bounded loop', vmOptions: {maxInstructions: 100}
  }), /bounded loop \/ source/);
  assert.throws(() => numericDifferential('Console.WriteLine(42);', '', {
    family: 'output quota'
  }), /output quota \/ source/);
});

test('A05 native oracle rejects path escape and tampered fixtures', () => {
  assert.throws(() => numericOracle('../provenance.json'), /one fixture file/);
  const directory = mkdtempSync(join(tmpdir(), 'sharpforge-numeric-evidence-'));
  try {
    writeFileSync(join(directory, 'fixture.txt'), '1\n');
    writeFileSync(join(directory, 'provenance.json'), JSON.stringify({
      format: 'SharpForge.NativeNumericOracle/1', sdk: '10.0.201', nativeIntBits: 64,
      files: {'fixture.txt': {bytes: 2, sha256: '0'.repeat(64)}}
    }));
    assert.throws(() => numericOracle('fixture.txt', pathToFileURL(directory + '/')), /Native oracle hash/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
