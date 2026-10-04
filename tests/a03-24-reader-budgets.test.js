import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CilError, MetadataBuilder, readMetadata, readPE } from '@sharpforge/cil';

function input() {
  const builder = new MetadataBuilder('ReaderBudget');
  for (let index = 0; index < 300; index++) builder.add(26, [builder.string('Module' + index)]);
  return builder.finish();
}

test('optional physical metadata reader bounds retain default decoded facts', () => {
  const bytes = input(), ordinary = readMetadata(bytes);
  const maxRows = Object.values(ordinary.counts).reduce((sum, count) => sum + count, 0);
  const bounded = readMetadata(bytes, { maxRows });
  for (const key of ['version', 'streams', 'rows', 'counts', 'rowOffsets', 'tableOffset', 'sortedMask']) {
    assert.deepEqual(bounded[key], ordinary[key], key);
  }
  assert.equal(bounded.string(bounded.row(0x1a000001)[0]), 'Module0');
  assert.throws(() => readMetadata(bytes, { maxRows: maxRows - 1 }), /Metadata row limit exceeded/);
  assert.throws(() => readMetadata(bytes, { maxRows: 0 }), /Metadata row limit exceeded/);
});

test('optional physical metadata reader rejects invalid bounds', () => {
  for (const options of [null, [], false, { maxRows: -1 }, { maxRows: 0.5 }, { maxRows: 1_000_001 }]) {
    assert.throws(() => readMetadata(input(), options), CilError);
  }
});

test('physical metadata parsing checks cancellation before and during row decoding', () => {
  const bytes = input();
  assert.throws(() => readMetadata(bytes, { signal: AbortSignal.abort() }), { code: 'MD_READ_CANCELED' });
  let checks = 0;
  const signal = { get aborted() { return ++checks > 8; } };
  assert.throws(() => readMetadata(bytes, { signal }), { code: 'MD_READ_CANCELED' });
  assert.ok(checks > 8);
  assert.equal(readMetadata(bytes).row(0x1a00012c).length, 1);
});

test('PE envelope forwards the optional bounds to its existing single metadata decode', async () => {
  const bytes = await readFile(new URL('./fixtures/portable-pdb-generations/baseline.dll', import.meta.url));
  const ordinary = readPE(bytes);
  const count = Object.values(ordinary.metadata.counts).reduce((sum, value) => sum + value, 0);
  assert.deepEqual(readPE(bytes, { metadataOptions: { maxRows: count } }).metadata.rows, ordinary.metadata.rows);
  assert.throws(() => readPE(bytes, { metadataOptions: { maxRows: count - 1 } }), /Metadata row limit exceeded/);
  assert.throws(() => readPE(bytes, { metadataOptions: { signal: AbortSignal.abort() } }), { code: 'MD_READ_CANCELED' });
});
