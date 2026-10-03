import test from 'node:test';
import assert from 'node:assert/strict';
import {expandSnippet, parseSnippet, CSHARP_SNIPPETS, SnippetSession} from '../packages/editor/src/snippets/index.js';
import {EditorModel} from '../packages/editor/src/model.js';
import {rankCompletions, fuzzyCompletion, signatureCallContext, parameterLabelRange,
  smartNewline} from '../packages/editor/src/features/index.js';

test('snippet placeholders, forward mirrors, variables, choices and final stop use UTF-16 offsets', () => {
  const result = expandSnippet('$2 ${1|int,string|} ${2:😀Name} = $2; $TM_SELECTED_TEXT$0', {TM_SELECTED_TEXT: 'body'});
  assert.equal(result.text, '😀Name int 😀Name = 😀Name; body');
  assert.deepEqual(result.order, [1, 2, 0]);
  assert.equal(result.stops.get(2).length, 3);
  for (const range of result.stops.get(2)) assert.equal(result.text.slice(range.start, range.end), '😀Name');
  assert.deepEqual(result.stops.get(1)[0].choices, ['int', 'string']);
  assert.equal(result.stops.get(0)[0].start, result.text.length);
});

test('nested snippet placeholders and escaped punctuation are retained', () => {
  const result = expandSnippet('${1:outer ${2:inner}} $2 \\$1 ${3|a\\,b,c\\|d|}');
  assert.equal(result.text, 'outer inner inner $1 a,b');
  assert.deepEqual(result.order, [1, 2, 3, 0]);
  assert.equal(result.stops.get(2).length, 2);
});

test('invalid, recursive, excessive and transform snippets fail explicitly', () => {
  for (const template of ['${1:unterminated', '${1/regex/replace/}', '${1:${1}}', '${1|x,y}']) {
    assert.throws(() => expandSnippet(template));
  }
  assert.throws(() => parseSnippet('x'.repeat(100_001)), /large/);
  assert.throws(() => parseSnippet('${1:'.repeat(18) + 'x' + '}'.repeat(18)), /nesting/);
});

test('all builtin snippets expand and all required C# and surrounding templates are present', () => {
  for (const prefix of ['prop', 'ctor', 'for', 'foreach', 'if', 'try', 'cw', 'class', 'region', 'using']) {
    const snippet = CSHARP_SNIPPETS.find(item => item.prefix === prefix);
    assert(snippet, prefix);
    const expanded = expandSnippet(snippet.body, {TM_SELECTED_TEXT: 'Work();'});
    assert(expanded.text.length > 0);
    assert(expanded.order.includes(0));
  }
  assert(CSHARP_SNIPPETS.filter(item => item.surround).every(item => expandSnippet(item.body, {TM_SELECTED_TEXT: 'Work();'}).text.includes('Work();')));
});

test('snippet primary edits and synchronous linked mirrors undo together through editor edit hooks', () => {
  const model = new EditorModel('', {uri: 'a.cs'});
  const session = Object.create(SnippetSession.prototype);
  const editor = {
    model, uri: 'a.cs', input: {readOnly: false, get selectionEnd() { return Math.max(model.primarySelection.anchor, model.primarySelection.active); }},
    get value() { return model.value; }, get offset() { return Math.min(model.primarySelection.anchor, model.primarySelection.active); },
    goto(start, end = start) { model.setSelections([{anchor: start, active: end}]); },
    setDecorations() {},
    applyEdits(edits, options) {
      session.beforeEdit();
      try { return model.applyEdits(edits, options); }
      finally { session.afterEdit(); }
    }
  };
  session.context = {editor};
  session.popup = {close() {}};
  model.onDidChange(change => session.changed(change));
  session.insert('${1:name} + $1$0');
  assert.equal(model.value, 'name + name');
  editor.applyEdits([{start: 0, end: 4, text: 'updated'}], {source: 'typing', command: 'typing', undoStop: true});
  assert.equal(model.value, 'updated + updated');
  assert.equal(model.undoStack.depth, 2);
  assert.equal(session.groupModel, null);
  assert.equal(model.undo(), true);
  assert.equal(model.value, 'name + name');
  assert.equal(model.undo(), true);
  assert.equal(model.value, '');
  assert.equal(model.redo(), true);
  assert.equal(model.redo(), true);
  assert.equal(model.value, 'updated + updated');
});

test('completion fuzzy matches prefer prefix, preserve match positions, support filters and use bounded MRU', () => {
  const items = [{label: 'ReadLine', kind: 'method'}, {label: 'Read', kind: 'method'}, {label: 'RapidLoop', kind: 'class'},
    {label: 'Write', kind: 'method'}];
  assert.deepEqual(fuzzyCompletion('ReadLine', 'RL').positions, [0, 4]);
  assert.equal(fuzzyCompletion('ReadLine', 'ZZ'), null);
  assert.equal(rankCompletions(items, 'Read')[0].item.label, 'Read');
  assert.deepEqual(rankCompletions(items, 'RL', new Map(), 'class').map(item => item.item.label), ['RapidLoop']);
  const duplicates = [{label: 'AB'}, {label: 'Ab'}];
  assert.equal(rankCompletions(duplicates, '', new Map([['AB', 500]]) )[0].item.label, 'AB');
});

test('signature nesting counts only commas in the active call and ignores literals', () => {
  for (const [text, expected] of [['F(1, G(2, 3', 1], ['F(1, G(2, 3), ', 2], ['F("a,b", new int[] {1,2}, ', 2]]) {
    assert.equal(signatureCallContext(text, text.length).argument, expected);
  }
  assert.equal(signatureCallContext('F(1)', 4), null);
  const signature = {label: 'void F(int x, int y)', parameters: [{label: 'int x'}, {label: 'int y'}]};
  const range = parameterLabelRange(signature, signature.parameters[1], 1);
  assert.equal(signature.label.slice(...range), 'int y');
});

test('smart newline uses source EOL, indentation settings and a caret between empty braces', () => {
  assert.deepEqual(smartNewline('{}', 1), {text: '\n    \n', caret: 6});
  assert.deepEqual(smartNewline('  {}\r\n', 3), {text: '\r\n      \r\n  ', caret: 11});
  assert.equal(smartNewline('{', 1, 1, {insertSpaces: false}).text, '\n\t');
  assert.equal(smartNewline('    x;', 6).text, '\n    ');
});
