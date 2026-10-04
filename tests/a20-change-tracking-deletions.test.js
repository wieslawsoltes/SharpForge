import test from 'node:test';
import assert from 'node:assert/strict';
import { ChangeTracking, EditorModel } from '@sharpforge/editor';
import { OverviewRuler } from '../packages/editor/src/view/overview-ruler.js';
import { createEditorFixture, pasteFixture } from '../scripts/editor-benchmarks/fixtures.js';

function fixture(t, text) {
  const model = new EditorModel(text, { uri: 'Tracking.cs', undo: { coalesceMs: 0 } });
  const reads = { current: 0, snapshots: 0 };
  // Count actual production stateAt/overview reads without replacing model or snapshot methods.
  const reader = {
    get lineCount() { return model.lineCount; },
    get length() { return model.length; },
    getLine(line) { reads.current++; return model.getLine(line); },
    offsetAt: position => model.offsetAt(position),
    snapshot() {
      const source = model.snapshot();
      return Object.freeze({ lineCount: source.lineCount, length: source.length,
        getLine(line) { reads.snapshots++; return source.getLine(line); },
        offsetAt: position => source.offsetAt(position), getText: (start, end) => source.getText(start, end) });
    }
  };
  const tracking = new ChangeTracking(reader);
  const unsubscribe = model.onDidChange(event => tracking.applyChange(event));
  const document = { createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() {} }) };
  const editor = { model, changeTracking: tracking, diagnostics: [], breakpoints: [], bookmarks: { lines: [] },
    decorationOwners: new Map(), offset: 0, element: { append() {} } };
  const overview = new OverviewRuler({ editor, document });
  t.after(() => { overview.dispose(); unsubscribe(); model.dispose(); });
  const edit = (start, end, text) => model.applyEdits([{ start, end, text }], { undoStop: true });
  const replaceLine = (line, text) => edit(model.lineStart(line), model.lineEnd(line), text);
  const marked = () => overview.marks().filter(mark => mark.kind !== 'caret').map(mark => [mark.line, mark.kind])
    .sort((left, right) => left[0] - right[0]);
  return { model, tracking, reads, overview, edit, replaceLine, marked };
}

const touched = tracking => [...tracking.touched].sort((left, right) => left - right);

test('64 KiB paste undo discards deleted touched lines and bounds subsequent overview source reads', t => {
  const { model, tracking, reads, overview, edit } = fixture(t, createEditorFixture(1024 * 1024).text);
  const original = model.snapshot();
  const pasted = pasteFixture();
  const lines = pasted.split('\n').length;
  assert.equal(pasted.length, 65536);
  assert.equal(lines, 2622);
  edit(0, 0, pasted);
  assert.equal(tracking.touched.size, lines);
  assert.equal(model.undo(), true);
  assert.equal(model.length, original.length);
  assert.equal(model.getText(0, 80), original.getText(0, 80));
  assert.deepEqual(touched(tracking), [0]);
  reads.current = reads.snapshots = 0;
  assert.deepEqual(overview.marks(), [{ line: 0, kind: 'caret' }]);
  assert.deepEqual(reads, { current: 1, snapshots: 2 });
  assert.equal(original.statistics.textMaterialized, false);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
});

test('repeated paste undo redo cycles do not accumulate obsolete markers or overview reads', t => {
  const { model, tracking, reads, overview, edit } = fixture(t, createEditorFixture(1024 * 1024).text);
  const pasted = pasteFixture();
  for (let cycle = 0; cycle < 8; cycle++) {
    edit(0, 0, pasted);
    assert.equal(tracking.touched.size, 2622);
    assert.equal(model.undo(), true);
    assert.deepEqual(touched(tracking), [0]);
    assert.equal(model.redo(), true);
    assert.equal(tracking.touched.size, 2622);
    assert.equal(model.undo(), true);
    assert.deepEqual(touched(tracking), [0]);
    reads.current = reads.snapshots = 0;
    overview.marks();
    assert.deepEqual(reads, { current: 1, snapshots: 2 });
  }
});

test('multiline replacement removes interior markers and retains both surviving boundaries and shifted outside markers', t => {
  const { model, tracking, replaceLine, edit } = fixture(t, 'one\ntwo\nthree\nfour\nfive\nsix');
  for (const line of [0, 2, 3, 4]) replaceLine(line, model.getLine(line).toUpperCase());
  assert.deepEqual(touched(tracking), [0, 2, 3, 4]);
  edit(model.offsetAt({ line: 1, character: 1 }), model.offsetAt({ line: 3, character: 2 }), 'new\nlast');
  assert.equal(model.getText(), 'ONE\ntnew\nlastUR\nFIVE\nsix');
  assert.deepEqual(touched(tracking), [0, 1, 2, 3]);
  for (const line of [0, 1, 2, 3]) assert.equal(tracking.stateAt(line), 'unsaved');
});

test('deletion ending exactly at a line start retains the surviving old-end marker at its new line', t => {
  const { model, tracking, replaceLine, edit } = fixture(t, 'a\nb\nc\nd\ne');
  replaceLine(0, 'A');
  replaceLine(3, 'D');
  replaceLine(4, 'E');
  edit(model.lineStart(1), model.lineStart(3), '');
  assert.equal(model.getText(), 'A\nD\nE');
  assert.deepEqual(touched(tracking), [0, 1, 2]);
  assert.equal(tracking.stateAt(1), 'unsaved');
});

test('deletion through EOF and whole-document replacement leave only surviving line candidates', t => {
  const { model, tracking, replaceLine, edit } = fixture(t, 'one\ntwo\nthree');
  replaceLine(2, 'THREE');
  edit(model.lineStart(1), model.length, '');
  assert.equal(model.getText(), 'one\n');
  assert.deepEqual(touched(tracking), [1]);
  edit(0, model.length, '');
  assert.equal(model.lineCount, 1);
  assert.deepEqual(touched(tracking), [0]);
  assert.equal(tracking.stateAt(0), 'unsaved');
});

for (const eol of ['\n', '\r\n', '\r']) {
  test(`deletion and undo preserve trailing touched markers with ${JSON.stringify(eol)} line endings`, t => {
    const { model, tracking, replaceLine, edit, marked } = fixture(t, ['a', 'b', 'c', 'd'].join(eol));
    replaceLine(1, 'B');
    replaceLine(3, 'D');
    edit(model.lineStart(1), model.lineStart(2), '');
    assert.equal(model.getText(), ['a', 'c', 'D'].join(eol));
    assert.deepEqual(touched(tracking), [1, 2]);
    assert.equal(model.undo(), true);
    assert.deepEqual(marked(), [[1, 'unsaved'], [3, 'unsaved']]);
  });
}

test('LF-only deletion within CRLF preserves marked prefix and suffix lines without shifting trailing markers', t => {
  const { model, tracking, replaceLine, edit } = fixture(t, 'a\r\nb\nc');
  for (let line = 0; line < 3; line++) replaceLine(line, model.getLine(line).toUpperCase());
  edit(2, 3, '');
  assert.equal(model.getText(), 'A\rB\nC');
  assert.deepEqual(touched(tracking), [0, 1, 2]);
  for (let line = 0; line < 3; line++) assert.equal(tracking.stateAt(line), 'unsaved');
});

test('LF insertion after CR joins one delimiter and keeps trailing markers at their existing line', t => {
  const { model, tracking, replaceLine, edit } = fixture(t, 'a\rb\nc');
  for (let line = 0; line < 3; line++) replaceLine(line, model.getLine(line).toUpperCase());
  edit(2, 2, '\n');
  assert.equal(model.getText(), 'A\r\nB\nC');
  assert.deepEqual(touched(tracking), [0, 1, 2]);
  assert.equal(tracking.stateAt(2), 'unsaved');
});

test('splitting and rejoining CRLF maps all surviving source marks through exact snapshot geometry', t => {
  const { model, tracking, replaceLine, edit } = fixture(t, 'a\r\nb\nc');
  for (let line = 0; line < 3; line++) replaceLine(line, model.getLine(line).toUpperCase());
  edit(2, 2, 'x');
  assert.equal(model.getText(), 'A\rx\nB\nC');
  assert.deepEqual(touched(tracking), [0, 1, 2, 3]);
  edit(2, 3, '');
  assert.equal(model.getText(), 'A\r\nB\nC');
  assert.deepEqual(touched(tracking), [0, 1, 2]);
});

test('reverse-ordered multiple edits map outside markers once and add final-coordinate ranges once', t => {
  const { model, tracking, replaceLine } = fixture(t, 'a\nb\nc\nd\ne\nf');
  for (const line of [0, 2, 5]) replaceLine(line, model.getLine(line).toUpperCase());
  model.applyEdits([
    { start: model.lineStart(3), end: model.lineEnd(4), text: 'X' },
    { start: 0, end: 0, text: 'new\n' }
  ], { undoStop: true });
  assert.equal(model.getText(), 'new\nA\nb\nC\nX\nF');
  assert.deepEqual(touched(tracking), [0, 1, 3, 4, 5]);
  assert.equal(tracking.stateAt(5), 'unsaved');
});

test('same-line and adjacent edit endpoints preserve inserted line spans without duplicate shifting', t => {
  const { model, tracking, replaceLine } = fixture(t, 'abcd\nkeep\ntail');
  replaceLine(2, 'TAIL');
  model.applyEdits([{ start: 2, end: 3, text: 'Q\n' }, { start: 1, end: 2, text: 'X\nY' }], { undoStop: true });
  assert.equal(model.getText(), 'aX\nYQ\nd\nkeep\nTAIL');
  assert.deepEqual(touched(tracking), [0, 1, 2, 4]);
  assert.equal(tracking.stateAt(4), 'unsaved');
});

test('grouped undo uses intermediate event snapshots while the live model is already fully restored', t => {
  const { model, tracking, edit, marked } = fixture(t, 'a\nb\nc\nd');
  model.beginUndoGroup('multiline');
  edit(0, 0, 'first\n');
  edit(model.lineStart(3), model.lineStart(4), '');
  model.endUndoGroup();
  assert.equal(model.undo(), true);
  assert.equal(model.getText(), 'a\nb\nc\nd');
  assert.deepEqual(marked(), []);
  assert.ok([...tracking.touched].every(line => line < model.lineCount));
});

test('saved and unsaved marks and hunk reverts keep their original snapshot semantics', t => {
  const { model, tracking, replaceLine, marked } = fixture(t, 'alpha\nbeta\ngamma');
  replaceLine(1, 'BETA');
  assert.equal(tracking.stateAt(1), 'unsaved');
  tracking.markSaved();
  assert.equal(tracking.stateAt(1), 'saved');
  replaceLine(1, 'BETTER');
  assert.equal(tracking.stateAt(1), 'unsaved');
  model.applyEdits([tracking.hunk(1)], { undoStop: true });
  assert.equal(model.getText(), 'alpha\nBETA\ngamma');
  assert.equal(tracking.stateAt(1), 'saved');
  assert.equal(model.undo(), true);
  assert.equal(tracking.stateAt(1), 'unsaved');
  assert.equal(model.redo(), true);
  assert.equal(tracking.stateAt(1), 'saved');
  model.applyEdits([tracking.hunk(1)], { undoStop: true });
  assert.equal(model.getText(), 'alpha\nbeta\ngamma');
  assert.equal(tracking.stateAt(1), 'unsaved');
  tracking.markSaved();
  assert.deepEqual(marked(), []);
});

test('events without precomputed ranges use their immutable before/after positions without flattening source', t => {
  const { model } = fixture(t, 'a\r\nb\nc');
  const tracking = new ChangeTracking(model);
  const off = model.onDidChange(event => tracking.applyChange({ before: event.before, after: event.after,
    changes: [...event.changes].reverse().map(({ start, end, text }) => ({ start, end, text })) }));
  t.after(off);
  model.applyEdits([{ start: 3, end: 4, text: 'B' }, { start: 0, end: 0, text: 'new\n' }]);
  assert.equal(model.getText(0, 7), 'new\na\r\n');
  assert.deepEqual(touched(tracking), [0, 1, 2]);
  assert.equal(model.snapshot().statistics.textMaterialized, false);
});
