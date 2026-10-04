import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@sharpforge/cil';
import { boundsCase, caseIds } from './fixtures/pe-bounds/input.mjs';
import { compareAuthored } from './fixtures/pe-bounds/contracts.mjs';
import { verifyBoundsCapture } from './fixtures/pe-bounds/verify.mjs';

test('PE bounds retained native corpus binds every authored outcome and current source', () => {
  const record = verifyBoundsCapture(fileURLToPath(new URL('./fixtures/pe-bounds/reference/', import.meta.url)));
  assert.equal(record.authored.length, caseIds.length * 2);
  for (const row of record.authored) {
    const [platform, id] = row.id.split(':');
    const { bytes } = boundsCase(id, platform);
    const hash = Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
    assert.equal(hash, row.native.imageSha256);
    assert.deepEqual(compareAuthored(bytes, row.id, row.native), row);
  }
  assert.equal(record.references[0].native.imageKind, 'ILOnly');
  assert.equal(record.references[1].native.imageKind, 'ReadyToRun');
  assert.equal(record.references[1].native.cli.flags & 1, 0);
  assert.equal(record.references[2].native.imageKind, 'MixedMode');
  assert.ok(record.references[2].comparison.counts.nonCil > 0);
});
