import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cloneWorkspaceState, hashWorkspaceRecord, workspaceRecordBytes} from '@sharpforge/workspace';
import {prepared, referenceBytes} from './support/prepared-workspace-record.js';

test('prepared record hashes match Node SHA-256 across padding and uneven source chunk boundaries', async () => {
  for (const length of [0, 55, 56, 63, 64, 65, 65537]) {
    const text = 'a'.repeat(length);
    const record = prepared('Input.cs', text);
    if (length > 65536) {
      const source = record.source;
      Object.defineProperty(record, 'source', {value: Object.freeze({uri: source.uri, version: source.version, length,
        get statistics() { return source.statistics; },
        getText(start, end) {
          assert(end - start <= 65537, 'source hashing must stay within one bounded range');
          return source.getText(start, end);
        }
      })});
    }
    assert.equal(await hashWorkspaceRecord(record), createHash('sha256').update(Buffer.from(text)).digest('hex'));
    assert.equal(record.source.statistics.textMaterialized, false);
  }
});

test('source byte hashing preserves BOM, CRLF and surrogate pairs and refuses stale original bytes after edits', async () => {
  const text = 'x'.repeat(65535) + '😀\r\nlast';
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
    const record = prepared('Input.cs', text, {encoding, bom: true});
    const expected = referenceBytes(text, encoding, true);
    assert.deepEqual(workspaceRecordBytes(record), new Uint8Array(expected));
    assert.equal(await hashWorkspaceRecord(record), createHash('sha256').update(expected).digest('hex'));
    assert.equal(record.source.statistics.textMaterialized, false);
  }
  const record = prepared('Saved.cs', 'old\r\n', {encoding: 'utf-16le', bom: true});
  record.bytes = new Uint8Array(referenceBytes('old\r\n', 'utf-16le', true));
  Object.defineProperty(record, 'originalSource', {value: record.source});
  const source = record.source.withChange(0, 3, 'new');
  Object.defineProperty(record, 'source', {value: source});
  assert.deepEqual(workspaceRecordBytes(record), new Uint8Array(referenceBytes('new\r\n', 'utf-16le', true)));
  assert.equal(source.statistics.textMaterialized, false);
});

test('hashing yields for cancellation and enforces byte budgets before materializing the source', async () => {
  const record = prepared('Long.cs', 'x'.repeat(200000));
  const controller = new AbortController();
  const request = hashWorkspaceRecord(record, {signal: controller.signal});
  queueMicrotask(() => controller.abort(new DOMException('cancelled source hash', 'AbortError')));
  await assert.rejects(request, {name: 'AbortError'});
  assert.equal(record.source.statistics.textMaterialized, false);
  assert.throws(() => workspaceRecordBytes(record, {maxBytes: 100}), /budget/);
});

test('mutable contributed sources are rejected before journal capture', () => {
  const record = {path: 'Mutable.cs', source: {uri: 'Mutable.cs', length: 1, getText: () => 'x'}};
  assert.throws(() => cloneWorkspaceState({records: [record], folders: []}), /immutable/);
});
