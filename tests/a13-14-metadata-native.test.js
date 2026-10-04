import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compareNativeImage } from './fixtures/metadata-table-views/native-compare.js';

test('every retained native SRM table row, typed column and heap probe equals the inspector dump', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/metadata-table-views/native.json', import.meta.url), 'utf8'));
  assert.equal(reference.compilation.exitCode, 0);
  assert.equal(reference.execution.exitCode, 0);
  assert.equal(reference.execution.signal, null);
  assert.equal(reference.images.length, 3);
  for (const input of reference.images) {
    const bytes = Buffer.from(input.image, 'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
    const native = reference.native.images.find(image => image.label === input.label);
    const result = compareNativeImage(bytes, native);
    assert.equal(result.tables, input.label === 'portable-pdb' ? 8 : 45);
    assert(result.namedRows >= (input.label === 'portable-pdb' ? 7 : 25));
  }
});
