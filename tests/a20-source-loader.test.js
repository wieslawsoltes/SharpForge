import test from 'node:test';
import assert from 'node:assert/strict';
import {readEditorSource, EditorModel, LargeFilePolicy} from '@sharpforge/editor';
import {encodeWorkspaceFile} from '@sharpforge/archive';
import {readStudioSource} from '../apps/studio/workbench/studio-source-reader.js';
import {SlicedFile} from './fixtures/a20-source-file-fixture.js';

const sourceText = 'class 日本語 { string value = "😀e\u0301"; }\r\n// עברית\n';

for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
  test(`A20 prepared ${encoding} ingress retains BOM and streaming decoder state at byte boundaries`, async () => {
    const bytes = encodeWorkspaceFile({path: 'Program.cs', text: sourceText, encoding, bom: true});
    for (const chunkSize of [1, 2, 3, 7, 64]) {
      const file = new SlicedFile([bytes], 'Program.cs');
      const progress = [];
      const record = await readEditorSource(file, {uri: 'src/Program.cs', version: 41, chunkSize,
        onProgress: event => progress.push(event.loaded)});
      assert.equal(record.path, 'src/Program.cs');
      assert.equal(record.source, record.model.snapshot());
      assert.equal(record.source.statistics.textMaterialized, false);
      assert.equal(record.model.getText(), sourceText);
      assert.equal(record.version, 41);
      assert.equal(record.encoding, encoding);
      assert.equal(record.bom, true);
      assert.equal(record.byteLength, bytes.length);
      assert.equal(record.length, sourceText.length);
      assert.equal(record.model.isDirty, false);
      assert.equal(record.model.canUndo, false);
      assert.equal(Object.getOwnPropertyDescriptor(record, 'model').enumerable, false);
      assert.equal(Object.getOwnPropertyDescriptor(record, 'source').enumerable, false);
      assert.equal(progress.at(-1), bytes.length);
      assert(file.reads.every(read => read.end - read.start <= Math.max(chunkSize, 3)));
      record.model.dispose();
    }
  });
}

test('A20 prepared empty and BOM-only files remain empty and editable without load history', async () => {
  for (const [encoding, bytes] of [['utf-8', []], ['utf-8', [239, 187, 191]],
    ['utf-16le', [255, 254]], ['utf-16be', [254, 255]]]) {
    const record = await readEditorSource(new SlicedFile([new Uint8Array(bytes)], 'Empty.cs'), {chunkSize: 1});
    assert.equal(record.length, 0);
    assert.equal(record.encoding, encoding);
    assert.equal(record.bom, bytes.length > 0);
    record.model.applyEdits([{start: 0, end: 0, text: 'a'}]);
    assert.equal(record.model.undo(), true);
    assert.equal(record.model.getText(), '');
    record.model.dispose();
  }
});

test('A20 Studio reads >2 MB File inputs in bounded slices and retains a stable original snapshot', async () => {
  const text = 'x'.repeat(2_100_000) + '\r\nend';
  const file = new SlicedFile([text], 'Program.cs');
  const record = await readStudioSource(file, {path: 'App/Program.cs'});
  assert.equal(record.source.statistics.textMaterialized, false);
  assert.equal(record.model.getText(record.length - 5, record.length), '\r\nend');
  assert(file.reads.length > 8);
  assert(file.reads.every(read => read.end - read.start <= 256 * 1024));
  record.model.applyEdits([{start: 0, end: 1, text: 'changed'}]);
  assert.equal(record.source.getText(0, 1), 'x');
  assert.equal(record.model.getText(0, 7), 'changed');
  assert.equal(record.model.isDirty, true);
  record.model.dispose();
});

test('A20 source loading cancels before I/O and between chunks without returning a partial model', async () => {
  const first = new AbortController();
  first.abort();
  const file = new SlicedFile(['one\ntwo'], 'Program.cs');
  await assert.rejects(readEditorSource(file, {signal: first.signal}), {name: 'AbortError'});
  assert.equal(file.reads.length, 0);
  const next = new AbortController();
  const progress = [];
  await assert.rejects(readEditorSource(file, {signal: next.signal, chunkSize: 2,
    onProgress(event) { progress.push(event.loaded); next.abort(); }}), {name: 'AbortError'});
  assert.deepEqual(progress, [2]);
  let current = true;
  await assert.rejects(readEditorSource(file, {chunkSize: 2, isCurrent: () => current,
    onProgress() { current = false; }}), {name: 'AbortError'});
});

test('A20 invalid chunk bounds and resource limits fail before a File read', async () => {
  const file = new SlicedFile(['four'], 'Program.cs');
  for (const chunkSize of [0, -1, NaN, 1.5, 8 * 1024 * 1024 + 1]) {
    await assert.rejects(readEditorSource(file, {chunkSize}), RangeError);
  }
  await assert.rejects(readEditorSource(file, {maxFileBytes: 3}), /byte limit/);
  assert.equal(file.reads.length, 0);
  await assert.rejects(readEditorSource(file, {maxCharacters: 3}), /character limit/);
});

test('A20 malformed encodings, binary NUL, inconsistent chunks and I/O failures reject the staged load', async () => {
  for (const bytes of [[0xc3, 0x28], [255, 254, 1], [254, 255, 0xd8, 0], [239, 187, 191, 0]]) {
    await assert.rejects(readEditorSource(new SlicedFile([new Uint8Array(bytes)], 'Bad.cs'), {chunkSize: 1}), TypeError);
  }
  await assert.rejects(readEditorSource(new SlicedFile(['text'], 'Bad.cs'), {encoding: 'utf-32'}),
    {code: 'SFEDITOR_SOURCE_ENCODING'});
  await assert.rejects(readEditorSource(new SlicedFile([new Uint8Array([255, 254])], 'Bad.cs'), {encoding: 'utf-8'}),
    {code: 'SFEDITOR_SOURCE_ENCODING'});
  const short = {size: 4, slice: () => new Blob([new Uint8Array([1])])};
  await assert.rejects(readEditorSource(short, {chunkSize: 4}), {code: 'SFEDITOR_SOURCE_CHANGED'});
  let reads = 0;
  const failed = {size: 4, slice() {
    return {async arrayBuffer() { if (++reads > 1) throw new Error('disk read failed'); return new Uint8Array([97, 98, 99]).buffer; }};
  }};
  await assert.rejects(readEditorSource(failed), /disk read failed/);
  await assert.rejects(readEditorSource(new SlicedFile(['text'], 'Bad.cs'), {
    onProgress() { throw new Error('progress handler failed'); }
  }), /progress handler failed/);
});

test('A20 CodeEditor large-file policy adopts only a complete decoded model and detects disposed loads', async () => {
  const original = new EditorModel('original', {uri: 'Program.cs'});
  const editor = {uri: 'Program.cs', model: original, disposed: false, changes: 0,
    setModel(uri, model) { assert.equal(uri, this.uri); this.model = model; this.changes++; }};
  const policy = new LargeFilePolicy(editor);
  const bytes = encodeWorkspaceFile({path: 'Program.cs', text: sourceText, encoding: 'utf-16be', bom: true});
  await policy.load(new SlicedFile([bytes], 'Program.cs'), {chunkSize: 3});
  assert.equal(editor.changes, 1);
  assert.equal(editor.model.getText(), sourceText);
  const committed = editor.model;
  await assert.rejects(policy.load(new SlicedFile(['broken'], 'Program.cs'), {
    chunkSize: 2, onProgress() { policy.dispose(); }
  }), {name: 'AbortError'});
  assert.equal(editor.model, committed);
  assert.equal(editor.changes, 1);
  original.dispose();
  committed.dispose();
});
