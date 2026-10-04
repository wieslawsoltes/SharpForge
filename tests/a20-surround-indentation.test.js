import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, editorOptions, CSHARP_SNIPPETS, SnippetSession, expandSnippet, indentSnippet} from '@sharpforge/editor';

function element(tag = 'section') {
  return {
    tag, children: [], listeners: new Map(),
    setAttribute() {}, focus() {},
    addEventListener(type, action) { this.listeners.set(type, action); },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelector(name) { return this.children.find(child => child.tag === name); },
    click() { return this.listeners.get('click')?.(); }
  };
}

function fixture(text, {start = 0, end = text.length, options = {}, snippets = []} = {}) {
  const model = new EditorModel(text, {uri: 'Program.cs'});
  model.setSelections([{anchor: start, active: end}]);
  const session = Object.create(SnippetSession.prototype);
  const editor = {
    model, uri: model.uri, options: editorOptions({endOfLine: model.preferredEol, ...options}),
    input: {readOnly: false, get selectionEnd() { return Math.max(model.primarySelection.anchor, model.primarySelection.active); }},
    get offset() { return Math.min(model.primarySelection.anchor, model.primarySelection.active); },
    get value() { throw new Error('Snippet insertion must read the selected model range, not the entire document'); },
    goto(anchor, active = anchor) { model.setSelections([{anchor, active}]); },
    setDecorations() {},
    applyEdits(edits, settings) { return model.applyEdits(edits, settings); }
  };
  session.context = {editor, document: {createElement: tag => element(tag)}};
  session.popup = {element: element(), close() {}, show() {}};
  session.catalog = [...CSHARP_SNIPPETS, ...snippets];
  return {
    model, editor, session,
    surround(prefix) {
      session.picker(true);
      const choice = session.popup.element.children.find(child => child.textContent?.startsWith(`${prefix} —`));
      assert.ok(choice, `Missing Surround With choice ${prefix}`);
      choice.click();
    }
  };
}

for (const [name, eol] of [['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']]) {
  test(`SF-A20-T25: region wrapping preserves ${name} body endings and does not indent later lines`, () => {
    const before = `one();${eol}two();`;
    const {model, surround} = fixture(before);
    surround('region');
    assert.equal(model.getText(), `#region Name${eol}${before}${eol}#endregion`);
    assert.equal(model.undoStack.depth, 1);
    model.undo();
    assert.equal(model.getText(), before);
    model.dispose();
  });

  test(`SF-A20-T25: block wrapping uses configured two-space indentation with ${name}`, () => {
    const before = `  one();${eol}    two();`;
    const {model, surround} = fixture(before, {options: {indentSize: 2}});
    surround('if');
    const expected = ['  if (condition)', '  {', '    one();', '      two();', '  }'].join(eol);
    assert.equal(model.getText(), expected);
    assert.equal(model.undoStack.depth, 1);
    model.undo();
    assert.equal(model.getText(), before);
    model.dispose();
  });
}

test('SF-A20-T25: mixed body terminators are unchanged while new wrapper lines use configured EOL', () => {
  const before = 'one();\r\n  two();\rthree();\nfour();';
  const {model, surround} = fixture(before, {options: {endOfLine: '\r\n', indentSize: 2}});
  surround('if');
  assert.equal(model.getText(), 'if (condition)\r\n{\r\n  one();\r\n    two();\r  three();\n  four();\r\n}');
  model.undo();
  assert.equal(model.getText(), before);
  model.dispose();
});

test('SF-A20-T25: region preserves existing body indentation with indentation excluded from the selection', () => {
  const before = '    one();\r    \ttwo();';
  const {model, surround} = fixture(before, {start: 4, options: {insertSpaces: false, tabSize: 4}});
  surround('region');
  assert.equal(model.getText(), '    #region Name\r    one();\r    \ttwo();\r    #endregion');
  model.undo();
  assert.equal(model.getText(), before);
  model.dispose();
});

test('SF-A20-T25: block templates use tabs and preserve relative body tabs', () => {
  const before = '\tone();\r\n\t\ttwo();';
  const {model, surround} = fixture(before, {start: 1, options: {insertSpaces: false, tabSize: 4}});
  surround('using');
  assert.equal(model.getText(), '\tusing (var resource = expression)\r\n\t{\r\n\t\tone();\r\n\t\t\ttwo();\r\n\t}');
  model.undo();
  assert.equal(model.getText(), before);
  model.dispose();
});

test('SF-A20-T25: each selected-text placeholder follows its own indentation context', () => {
  const before = 'one();\rtwo();';
  const snippets = [{prefix: 'twice', label: 'Two contexts', surround: true,
    body: '  $TM_SELECTED_TEXT\n$TM_SELECTED_TEXT$0'}];
  const {model, surround} = fixture(before, {snippets});
  surround('twice');
  assert.equal(model.getText(), '  one();\r  two();\rone();\rtwo();');
  model.dispose();
});

test('SF-A20-T25: selected snippet-looking text and empty lines remain literal', () => {
  const before = '  $1;\r\n\r\n  $TM_SELECTED_TEXT;';
  const {model, surround} = fixture(before);
  surround('region');
  assert.equal(model.getText(), '  #region Name\r\n  $1;\r\n\r\n  $TM_SELECTED_TEXT;\r\n  #endregion');
  model.dispose();
});

test('SF-A20-T25: read-only surrounding does not modify text or history', () => {
  const {model, editor, surround} = fixture('one();\rtwo();');
  editor.input.readOnly = true;
  surround('if');
  assert.equal(model.getText(), 'one();\rtwo();');
  assert.equal(model.undoStack.depth, 0);
  model.dispose();
});

test('SF-A20-T25: template EOL adaptation includes CR and preserves the existing public literal-indent contract', () => {
  assert.equal(indentSnippet('one\rtwo\r\nthree\nfour', '\t', '\r\n'), 'one\r\n\ttwo\r\n\tthree\r\n\tfour');
  const {model, session} = fixture('Work();');
  session.insert('if (${1:condition}) {\n\t$TM_SELECTED_TEXT\n}$0', {start: 0, end: 7});
  assert.equal(model.getText(), 'if (condition) {\n\tWork();\n}');
  model.dispose();
});

test('SF-A20-T25: contextual variable formatting preserves placeholder ranges and rejects invalid formatter output', () => {
  const result = expandSnippet('${1:name}\n  $BODY$0', {BODY: 'one\rtwo'}, {
    formatVariable({value, prefix}) { return value.replace(/\r/g, '\r' + prefix.slice(prefix.lastIndexOf('\n') + 1)); }
  });
  assert.equal(result.text, 'name\n  one\r  two');
  assert.equal(result.stops.get(1)[0].end, 4);
  assert.equal(result.stops.get(0)[0].start, result.text.length);
  assert.throws(() => expandSnippet('$BODY', {BODY: 'one'}, {formatVariable: () => null}), TypeError);
});
