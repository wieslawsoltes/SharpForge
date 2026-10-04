import test from 'node:test';
import assert from 'node:assert/strict';
import {TextBuffer} from '@sharpforge/text';
import {EditorModel} from '@sharpforge/editor';

test('cooperative preparation matches synchronous UTF-16 ranges and publishes only at its explicit commit', async () => {
  const source = 'a😀\r\nnext\nlast';
  const edits = [{start: 1, end: 3, text: 'b'}, {start: 5, end: 9, text: 'two'}, {start: source.length, end: source.length, text: '!'}];
  const buffer = new TextBuffer(source);
  const before = buffer.snapshot();
  const events = [];
  buffer.onDidChange(event => events.push(event));
  const expected = buffer.prepareEdits(edits);
  const prepared = await buffer.prepareEditsAsync(edits, {chunkSize: 2, batchSize: 1});
  assert.equal(buffer.snapshot(), before);
  assert.equal(events.length, 0);
  assert.deepEqual(prepared.changes, expected.changes);
  assert.deepEqual(prepared.inverseEdits, expected.inverseEdits);
  assert.equal(prepared.after.getText(), expected.after.getText());
  buffer.commitPrepared(prepared);
  assert.equal(buffer.version, before.version + 1);
  assert.equal(events.length, 1);
  assert.equal(buffer.snapshot(), prepared.after);
  buffer.applyEdits(prepared.inverseEdits);
  assert.equal(buffer.getText(), source);
  buffer.dispose();
});

test('cooperative large inverse construction yields while retaining one model undo operation', async () => {
  const length = 2 * 1024 * 1024;
  const model = new EditorModel('x' + ' '.repeat(length) + 'y');
  const before = model.snapshot();
  let progress = 0;
  let timerRan = false;
  const prepared = await model.prepareEditsAsync([{start: 1, end: length + 1, text: '\n'}], {
    chunkSize: 64 * 1024, undoStop: true, onProgress(event) {
      assert.equal(model.snapshot(), before);
      assert.equal(model.undoStack.depth, 0);
      if (event.phase !== 'prepare-inverse') return;
      if (progress++) assert.equal(timerRan, true);
      else setTimeout(() => { timerRan = true; }, 0);
    }
  });
  assert.equal(progress, length / (64 * 1024));
  assert.equal(before.statistics.textMaterialized, false);
  model.commitPrepared(prepared);
  assert.equal(model.getText(), 'x\ny');
  assert.equal(model.undoStack.depth, 1);
  assert.equal(model.undoStack.statistics.operations, 1);
  assert.equal(model.undo(), true);
  assert.equal(model.length, length + 2);
  assert.equal(model.getText(0, 2), 'x ');
  assert.equal(model.getText(model.length - 2, model.length), ' y');
  assert.equal(model.redo(), true);
  assert.equal(model.getText(), 'x\ny');
  model.dispose();
});

test('cooperative preparation honors cancellation, disposal and snapshot identity without publishing partial changes', async () => {
  for (const reason of ['cancel', 'edit', 'dispose', 'restore']) {
    const buffer = new TextBuffer(' '.repeat(10_000));
    const before = buffer.snapshot();
    const controller = new AbortController();
    let acted = false;
    const pending = buffer.prepareEditsAsync([{start: 0, end: buffer.length, text: ''}], {
      signal: controller.signal, chunkSize: 128, onProgress() {
        if (acted) return;
        acted = true;
        if (reason === 'cancel') controller.abort();
        if (reason === 'edit') buffer.insert(0, 'new');
        if (reason === 'dispose') buffer.dispose();
        if (reason === 'restore') {
          const checkpoint = buffer.checkpoint();
          buffer.restoreCheckpoint({...checkpoint, snapshot: before.withChange(0, 1, '!').withMetadata({version: before.version})});
        }
      }
    });
    if (reason === 'cancel') await assert.rejects(pending, {name: 'AbortError'});
    else if (reason === 'dispose') await assert.rejects(pending, /disposed/);
    else await assert.rejects(pending, {code: 'TEXT_VERSION_MISMATCH'});
    assert.equal(buffer.length, before.length + (reason === 'edit' ? 3 : 0));
    if (reason === 'cancel' || reason === 'dispose') assert.equal(buffer.snapshot(), before);
    buffer.dispose();
  }
});

test('cooperative ordered edit input validates bounds, ordering, edit count and chunk controls', async () => {
  const buffer = new TextBuffer('abcd', {maxEdits: 2});
  const before = buffer.snapshot();
  const cases = [
    [[{start: 2, end: 3, text: ''}, {start: 0, end: 1, text: ''}], {}],
    [[{start: 0, end: 2, text: ''}, {start: 1, end: 3, text: ''}], {}],
    [[{start: 0, end: 5, text: ''}], {}],
    [[{start: 0, end: 1, text: ''}, {start: 1, end: 2, text: ''}, {start: 2, end: 3, text: ''}], {}],
    [[{start: 0, end: 0, text: '!'}], {chunkSize: 0}],
    [[{start: 0, end: 0, text: '!'}], {chunkSize: 65_537}],
    [[{start: 0, end: 0, text: '!'}], {batchSize: 257}]
  ];
  for (const [edits, options] of cases) {
    await assert.rejects(buffer.prepareEditsAsync(edits, options), RangeError);
    assert.equal(buffer.snapshot(), before);
  }
  await assert.rejects(buffer.prepareEditsAsync(null), TypeError);
  buffer.dispose();
});

test('cooperative insertion normalizes CRLF across single-unit windows and keeps the one-version contract', async () => {
  const buffer = new TextBuffer('start\n');
  const input = 'one\r\ntwo\rthree\n😀';
  const prepared = await buffer.prepareEditsAsync([{start: buffer.length, end: buffer.length, text: input}], {
    chunkSize: 1, normalizeLineEndings: true
  });
  buffer.commitPrepared(prepared);
  assert.equal(buffer.getText(), 'start\none\ntwo\nthree\n😀');
  assert.equal(buffer.version, 2);
  buffer.dispose();
});

test('adjacent deletions and a replacement retain an unambiguous inverse transaction', async () => {
  for (const asynchronous of [false, true]) {
    const model = new EditorModel('abcdef');
    const edits = [{start: 0, end: 1, text: ''}, {start: 1, end: 3, text: ''}, {start: 3, end: 5, text: 'X'}];
    const prepared = asynchronous ? await model.prepareEditsAsync(edits) : model.prepareEdits(edits);
    model.commitPrepared(prepared);
    assert.equal(model.getText(), 'Xf');
    assert.equal(model.undo(), true);
    assert.equal(model.getText(), 'abcdef');
    assert.equal(model.redo(), true);
    assert.equal(model.getText(), 'Xf');
    model.dispose();
  }
});

test('prepared model binding enforces ownership, current revisions and read-only state', async () => {
  const model = new EditorModel('source');
  const other = new EditorModel('source');
  const prepared = await model.prepareEditsAsync([{start: 0, end: 1, text: 'S'}]);
  assert.throws(() => other.bindPreparedEdits(prepared.bufferEdit), /another buffer/);
  model.readOnly = true;
  assert.throws(() => model.commitPrepared(prepared), {code: 'SFEDITOR_READ_ONLY'});
  model.readOnly = false;
  model.applyEdits([{start: model.length, end: model.length, text: '!'}]);
  assert.throws(() => model.bindPreparedEdits(prepared.bufferEdit), {code: 'TEXT_VERSION_MISMATCH'});
  model.dispose();
  other.dispose();
});
