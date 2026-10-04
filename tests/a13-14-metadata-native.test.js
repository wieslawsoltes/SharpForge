import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compareNativeImage, checkNativeUnsupportedImage } from './fixtures/metadata-table-views/native-compare.js';

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
    assert.equal(result.tables, input.label === 'portable-pdb' ? 8 : 41);
    assert(result.namedRows >= (input.label === 'portable-pdb' ? 7 : 25));
  }
});

test('retained native evidence rejects each unsupported legacy table without dropping inspector coverage', () => {
  const reference = JSON.parse(readFileSync(new URL('./fixtures/metadata-table-views/native.json', import.meta.url), 'utf8'));
  assert.deepEqual(reference.unsupportedImages.map(input => input.table), [33, 34, 36, 37]);
  for (const input of reference.unsupportedImages) {
    const bytes = Buffer.from(input.image, 'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), input.sha256);
    const native = reference.native.unsupportedImages.find(image => image.label === input.label);
    assert.equal(checkNativeUnsupportedImage(bytes, native, input.table).tables, 42);
  }
});
