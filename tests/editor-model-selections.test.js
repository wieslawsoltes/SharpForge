import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorModel } from '../packages/editor/src/model.js';
import { normalizeSelections, transformSelections } from '../packages/editor/src/selections.js';
import {
  addCaret, addNextOccurrence, addAllOccurrences, removeLastCaret, collapseSelections, insertCaretsAtLineEnds, replaceSelections
} from '../packages/editor/src/commands/multi-caret.js';
import { setBoxSelection, applyBoxText, boxSelectionEdits } from '../packages/editor/src/commands/box-selection.js';
import { copySelections, pasteSelections, pasteBox } from '../packages/editor/src/commands/multi-clipboard.js';

const carets = model => model.selections.map(({ anchor, active }) => [anchor, active]);

test('selection normalization deterministically merges overlap and preserves primary direction and head alias', () => {
  const result = normalizeSelections([{ anchor: 1, head: 6 }, { anchor: 8, active: 4 }, { anchor: 20, active: 20 }], 10, 1);
  assert.deepEqual(result.selections.map(({ anchor, active, head }) => [anchor, active, head]), [[8, 1, 1], [10, 10, 10]]);
  assert.equal(result.primaryIndex, 0);
  const transformed = transformSelections(result.selections, [{ start: 0, end: 1, text: 'prefix' }], 15);
  assert.deepEqual(transformed.selections.map(({ anchor, active }) => [anchor, active]), [[13, 6], [15, 15]]);
});

test('model stores operation undo independent of a 500 KB document and restores save points', () => {
  const model = new EditorModel('x'.repeat(500000), { undo: { maxOperations: 1200 } });
  for (let index = 0; index < 1000; index++) model.applyEdits([{ start: 0, end: 0, text: 'a' }], { undoStop: true });
  assert.equal(model.undoStack.depth, 1000);
  assert.equal(model.undoStack.statistics.retainedCharacters, 1000);
  assert.equal(model.isDirty, true);
  for (let index = 0; index < 1000; index++) assert.equal(model.undo(), true);
  assert.equal(model.length, 500000);
  assert.equal(model.isDirty, false);
  assert.equal(model.canRedo, true);
  model.redo();
  model.markSaved();
  assert.equal(model.isDirty, false);
  model.undo();
  assert.equal(model.isDirty, true);
  model.redo();
  assert.equal(model.isDirty, false);
});

test('five-caret typing is one undo step with exact selection restore; time/command coalescing has explicit boundaries', () => {
  const model = new EditorModel('a b c d e');
  const original = [0, 2, 4, 6, 8].map(active => ({ anchor: active, active }));
  model.setSelections(original, { primaryIndex: 3 });
  replaceSelections(model, '!', { command: 'typing', time: 1 });
  assert.equal(model.value, '!a !b !c !d !e');
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(model.value, 'a b c d e');
  assert.deepEqual(carets(model), original.map(({ anchor, active }) => [anchor, active]));
  assert.equal(model.primaryIndex, 3);
  model.redo();
  assert.equal(model.value, '!a !b !c !d !e');
  const typing = new EditorModel();
  replaceSelections(typing, 'a', { command: 'typing', time: 0 });
  replaceSelections(typing, 'b', { command: 'typing', time: 100 });
  assert.equal(typing.undoStack.depth, 1);
  typing.pushUndoStop();
  replaceSelections(typing, 'c', { command: 'typing', time: 101 });
  assert.equal(typing.undoStack.depth, 2);
  typing.undo();
  assert.equal(typing.value, 'ab');
  typing.undo();
  assert.equal(typing.value, '');
});

test('random operations undo and redo against retained string oracles', () => {
  const model = new EditorModel('seed\r\n');
  const oracle = [model.value];
  let seed = 58392;
  const next = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  for (let operation = 0; operation < 500; operation++) {
    const start = next(model.length + 1);
    const end = start + next(Math.min(4, model.length - start) + 1);
    const text = ['a', '\r', '\n', '😀'][next(4)];
    model.applyEdits([{ start, end, text }], { undoStop: true });
    oracle.push(oracle.at(-1).slice(0, start) + text + oracle.at(-1).slice(end));
    assert.equal(model.value, oracle.at(-1));
  }
  for (let index = oracle.length - 2; index >= 0; index--) { model.undo(); assert.equal(model.value, oracle[index]); }
  for (let index = 1; index < oracle.length; index++) { model.redo(); assert.equal(model.value, oracle[index]); }
});

test('model prepares atomic workspace participants and rollback preserves document/history/selection/scroll', () => {
  const model = new EditorModel('one\ntwo');
  model.scroll = { top: 100, left: 12 };
  model.setSelections([{ anchor: 4, active: 7 }]);
  const checkpoint = model.checkpoint();
  const events = [];
  model.onDidChange(event => events.push(event));
  const prepared = model.prepareEdits([{ start: 0, end: 3, text: 'ONE' }], { undoStop: true });
  assert.equal(model.value, 'one\ntwo');
  model.commitPrepared(prepared, { notify: false });
  assert.equal(model.value, 'ONE\ntwo');
  assert.equal(events.length, 0);
  model.restoreCheckpoint(checkpoint);
  assert.equal(model.value, 'one\ntwo');
  assert.equal(model.undoStack.depth, 0);
  assert.deepEqual(carets(model), [[4, 7]]);
  assert.deepEqual(model.scroll, { top: 100, left: 12 });
  model.applyEdits([{ start: 0, end: 3, text: 'ONE' }]);
  assert.equal(events[0].text, 'ONE\ntwo');
});

test('multi-caret commands add occurrences, remove newest and insert line-end carets', () => {
  const model = new EditorModel('word word\nword');
  addNextOccurrence(model);
  assert.deepEqual(carets(model), [[0, 4]]);
  addNextOccurrence(model);
  assert.deepEqual(carets(model), [[0, 4], [5, 9]]);
  addAllOccurrences(model);
  assert.equal(model.selections.length, 3);
  removeLastCaret(model);
  assert.equal(model.selections.length, 2);
  collapseSelections(model);
  assert.equal(model.selections.length, 1);
  addCaret(model, 12);
  assert.equal(model.selections.length, 2);
  model.setSelections([{ anchor: 0, active: model.length }]);
  insertCaretsAtLineEnds(model);
  assert.deepEqual(carets(model), [[9, 9], [14, 14]]);
});

test('box typing splits partial tabs, uses wide visual columns and inserts virtual spaces', () => {
  const model = new EditorModel('a\tb\n界x\nz');
  setBoxSelection(model, { anchorLine: 0, activeLine: 2, anchorColumn: 3, activeColumn: 3, tabSize: 4 });
  applyBoxText(model, '!');
  assert.equal(model.value, 'a  ! b\n界x!\nz  !');
  model.undo();
  assert.equal(model.value, 'a\tb\n界x\nz');
  assert.ok(model.selections.every(selection => selection.box));
});

test('multicaret clipboard round-trips N fragments and rectangular pastes grow missing lines atomically', () => {
  const source = new EditorModel('first second third');
  source.setSelections([{ anchor: 0, active: 5 }, { anchor: 6, active: 12 }, { anchor: 13, active: 18 }]);
  const copied = copySelections(source);
  assert.equal(copied.text, 'first\nsecond\nthird');
  const target = new EditorModel('a b c');
  target.setSelections([0, 2, 4].map(active => ({ anchor: active, active })));
  pasteSelections(target, copied.text, { metadata: copied.metadata });
  assert.equal(target.value, 'firsta secondb thirdc');
  target.undo();
  assert.equal(target.value, 'a b c');
  const box = new EditorModel('a');
  box.setSelections([{ anchor: 1, active: 1 }]);
  pasteBox(box, ['X', 'Y', 'Z']);
  assert.equal(box.value, 'aX\n Y\n Z');
  assert.equal(box.selections.length, 3);
  box.undo();
  assert.equal(box.value, 'a');
  assert.throws(() => pasteSelections(target, 'x', { metadata: '{' }), /Malformed/);
});

test('box deletion avoids manufacturing virtual spaces and insertion budgets reject before any model edit', () => {
  const model = new EditorModel('a\nb');
  setBoxSelection(model, { anchorLine: 0, activeLine: 1, anchorColumn: 1000, activeColumn: 1001 });
  const edits = boxSelectionEdits(model, model.selections, '', { padVirtualSpace: false });
  assert.ok(edits.every(edit => edit.start === edit.end && edit.text === ''));
  assert.throws(() => applyBoxText(model, 'X', { maxInsertedCharacters: 8 }), /budget/);
  assert.equal(model.value, 'a\nb');
  assert.equal(model.undoStack.depth, 0);
  model.setSelections([{ anchor: 1, active: 1 }]);
  assert.throws(() => pasteBox(model, ['abcd', 'abcd', 'abcd'], { maxInsertedCharacters: 10 }), /budget/);
  assert.equal(model.value, 'a\nb');
  assert.equal(model.undoStack.depth, 0);
});

test('explicit nested groups override per-command stops and selection jumps while preserving saved state identity', () => {
  const model = new EditorModel('one two');
  const saved = model.undoStack.stateId;
  model.beginUndoGroup('snippet');
  model.applyEdits([{ start: 0, end: 3, text: 'ONE' }], { command: 'typing', undoStop: true });
  model.setSelections([{ anchor: 7, active: 4 }]);
  model.beginUndoGroup('mirror');
  model.applyEdits([{ start: 4, end: 7, text: 'TWO' }], { command: 'snippet-mirror', undoStop: true });
  model.endUndoGroup();
  model.endUndoGroup();
  assert.equal(model.value, 'ONE TWO');
  assert.equal(model.undoStack.depth, 1);
  assert.notEqual(model.undoStack.stateId, saved);
  model.undo();
  assert.equal(model.value, 'one two');
  assert.equal(model.undoStack.stateId, saved);
  assert.equal(model.isDirty, false);
  model.redo();
  assert.equal(model.value, 'ONE TWO');
});
