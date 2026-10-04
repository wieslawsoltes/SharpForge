import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@sharpforge/cil';
import { boundsCase, caseIds } from './fixtures/pe-bounds/input.mjs';
import { compareAuthored } from './fixtures/pe-bounds/contracts.mjs';
import { verifyBoundsReplay } from './fixtures/pe-bounds/replay.mjs';

test('PE bounds historical native corpus binds every current authored replay and retained real-image fact', () => {
  const record = verifyBoundsReplay(fileURLToPath(new URL('./fixtures/pe-bounds/reference/', import.meta.url)));
  assert.equal(record.authored.length, caseIds.length * 2);
  assert.equal(record.authored.length, 58);
  assert.deepEqual(record.authored.map(row => row.id), ['anycpu', 'x64'].flatMap(platform =>
    caseIds.map(id => platform + ':' + id)));
  for (const row of record.authored) {
    const [platform, id] = row.id.split(':');
    const { bytes } = boundsCase(id, platform);
    const hash = Array.from(sha256(bytes), value => value.toString(16).padStart(2, '0')).join('');
    assert.equal(hash, row.native.imageSha256);
    assert.deepEqual(compareAuthored(bytes, row.id, row.native), row);
  }
  // Supplied real-image bytes are external: these are retained historical facts, not current-product replay.
  assert.equal(record.references[0].native.imageKind, 'ILOnly');
  assert.equal(record.references[1].native.imageKind, 'ReadyToRun');
  assert.equal(record.references[1].native.cli.flags & 1, 0);
  assert.equal(record.references[2].native.imageKind, 'MixedMode');
  assert.ok(record.references[2].comparison.counts.nonCil > 0);
});
