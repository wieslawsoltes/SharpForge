import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readPortablePdbDelta } from '@sharpforge/symbols';

test('native SRM accepts the captured generated delta, with compact methods, scopes, constants and opaque CDI', () => {
  const folder = new URL('./fixtures/portable-pdb-delta-writer/', import.meta.url);
  const reference = JSON.parse(readFileSync(new URL('reference.json', folder), 'utf8'));
  const bytes = readFileSync(new URL('written.pdb', folder));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.sha256);
  const symbols = readPortablePdbDelta(bytes, { typeSystemRowCounts: reference.envelope.typeSystemRowCounts });
  assert.deepEqual(symbols.methods[0].points, reference.native.methods[0].points);
  assert.equal(symbols.methods[0].token, reference.native.methods[0].token);
  assert.equal(symbols.constants[0].value, 42);
  assert.equal(symbols.custom[0].parent, reference.native.methods[0].token);
  assert.deepEqual(symbols.custom[0].bytes, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});
