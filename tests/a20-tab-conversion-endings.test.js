import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, advancedCommands, editorOptions, tabify, untabify} from '@sharpforge/editor';

for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']]) {
  test(`SF-A20-T41: untabify resets visual columns at every ${name} line`, () => {
    assert.equal(untabify(`abc${eol}\tvalue${eol}中\tx${eol}e\u0301\tlast${eol}`, 4),
      `abc${eol}    value${eol}中  x${eol}e\u0301   last${eol}`);
  });

  test(`SF-A20-T41: tabify converts every ${name} indentation without changing terminators`, () => {
    assert.equal(tabify(`    a${eol}        b${eol}  c${eol}${eol}`, 4), `\ta${eol}\t\tb${eol}  c${eol}${eol}`);
  });
}

test('SF-A20-T41: tab conversion preserves mixed EOL, blank lines and tab columns in mixed indentation', () => {
  const source = '    a\r    b\r\n        c\n \t  d\r\r\n';
  const tabs = '\ta\r\tb\r\n\t\tc\n\t  d\r\r\n';
  assert.equal(tabify(source, 4), tabs);
  assert.equal(untabify(tabs, 4), '    a\r    b\r\n        c\n      d\r\r\n');
  assert.equal(untabify('abc\r\t', 4), 'abc\r    ');
  assert.equal(tabify('', 4), '');
  assert.equal(untabify('\r\n\r\n', 4), '\r\n\r\n');
});

test('SF-A20-T41: disjoint multiline selections convert in one undo transaction and restore selection state', () => {
  const before = '    first\r    second\r\nkeep\n        third\r    fourth';
  const model = new EditorModel(before);
  model.setSelections([{anchor: 0, active: before.indexOf('keep')}, {anchor: before.indexOf('        third'), active: before.length}]);
  const selections = model.selections.map(selection => ({...selection}));
  const editor = {
    model, input: {readOnly: false}, options: editorOptions(), getSelections: () => model.selections,
    applyEdits: (edits, options) => model.applyEdits(edits, options)
  };
  advancedCommands(editor)['edit.tabify']();
  const expected = '\tfirst\r\tsecond\r\nkeep\n\t\tthird\r\tfourth';
  assert.equal(model.getText(), expected);
  assert.equal(model.undoStack.depth, 1);
  model.undo();
  assert.equal(model.getText(), before);
  assert.deepEqual(model.selections, selections);
  model.redo();
  assert.equal(model.getText(), expected);
  model.dispose();
});

test('SF-A20-T41: read-only tab conversion leaves the model and history unchanged', () => {
  const model = new EditorModel('    first\r\tsecond');
  model.setSelections([{anchor: 0, active: model.length}]);
  const editor = {model, input: {readOnly: true}, options: editorOptions(), getSelections: () => model.selections,
    applyEdits() { assert.fail('Read-only conversion must not request an edit'); }};
  advancedCommands(editor)['edit.tabify']();
  advancedCommands(editor)['edit.untabify']();
  assert.equal(model.getText(), '    first\r\tsecond');
  assert.equal(model.undoStack.depth, 0);
  model.dispose();
});
