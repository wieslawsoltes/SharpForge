import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '@sharpforge/editor';
import { decodeWorkspaceFile } from '@sharpforge/archive';
import { ExplorerPathIndex } from '../apps/studio/explorer-path-index.js';
import { captureExplorerRecord, prepareExplorerRecord, sameExplorerRecord } from '../apps/studio/explorer-records.js';
import { nativeExplorerOperation } from '../apps/studio/explorer-existing.js';

function record() {
  const model = new EditorModel('日本語', { uri: 'Original.cs', encoding: 'utf-16be', bom: true });
  return { path: 'Original.cs', model, source: model.snapshot(), version: model.version, encoding: 'utf-16be', bom: true, byteLength: 8,
    get text() { throw new Error('No lazy text read'); } };
}

test('Explorer snapshot records preserve metadata and exact history roots while fresh URI models remain independent', () => {
  const original = record();
  const captured = captureExplorerRecord(original);
  assert.equal(captured.source, original.source);
  assert.equal(captured.model, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(captured, 'source').enumerable, false);
  const moved = prepareExplorerRecord(original, 'src/Moved.cs', { reuseModel: false });
  assert.equal(moved.model.uri, 'src/Moved.cs');
  assert.equal(moved.source.uri, 'src/Moved.cs');
  assert.equal(moved.encoding, 'utf-16be');
  assert.equal(moved.bom, true);
  assert.equal(moved.model.getText(), '日本語');
  const restored = prepareExplorerRecord(captured);
  assert.equal(restored.source, captured.source);
  assert.equal(sameExplorerRecord(captured, restored), true);
  original.model.applyEdits([{ start: 0, end: 0, text: 'changed' }]);
  assert.equal(sameExplorerRecord(captured, original), false);
  assert.equal(moved.model.getText(), '日本語');
  assert.equal(captured.source.statistics.textMaterialized, false);
  for (const value of [original, moved, restored]) value.model.dispose();
});

test('Explorer path index preserves descendant and case-collision rules across large indexed batches and removals', () => {
  const index = new ExplorerPathIndex([], []);
  for (let value = 0; value < 2_000; value++) {
    const path = `src/group${value % 20}/File${value}.cs`;
    index.assertAvailable(path);
    index.add(path, true);
  }
  assert.throws(() => index.assertAvailable('SRC/group0/file0.cs'), /already exists/);
  assert.throws(() => index.assertAvailable('src'), /already exists/);
  assert.throws(() => index.assertAvailable('src/group0/File0.cs/Child.cs'), /parent path is a file/);
  for (let value = 0; value < 2_000; value++) index.remove(`src/group${value % 20}/File${value}.cs`, true);
  assert.doesNotThrow(() => index.assertAvailable('src'));
  assert.equal(index.counts.size, 0);
  assert.equal(index.files.size, 0);
});

test('native prepared creates encode the captured edited source and BOM instead of stale original bytes', () => {
  const original = record();
  original.bytes = new Uint8Array([0, 1]);
  original.model.applyEdits([{ start: 0, end: 0, text: 'edited ' }]);
  const operation = nativeExplorerOperation({ kind: 'create', path: 'Created.cs', record: original });
  const bytes = Uint8Array.from(atob(operation.base64), character => character.charCodeAt(0));
  const decoded = decodeWorkspaceFile('Created.cs', bytes);
  assert.equal(decoded.text, 'edited 日本語');
  assert.equal(decoded.encoding, 'utf-16be');
  assert.equal(decoded.bom, true);
  assert.equal('record' in operation, false);
  assert.equal(original.model.snapshot().statistics.textMaterialized, false);
  const write = nativeExplorerOperation({ kind: 'write', path: original.path, record: original });
  assert.equal(write.text, 'edited 日本語');
  original.model.dispose();
});
