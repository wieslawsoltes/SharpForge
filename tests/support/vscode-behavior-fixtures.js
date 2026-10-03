import assert from 'node:assert/strict';

const movementText = 'zero one\n  two\nthree';
const movements = [
  ['ArrowLeft', 11], ['ArrowRight', 13], ['ArrowUp', 3], ['ArrowDown', 18],
  ['Home', 11], ['End', 14], ['Mod+Home', 0], ['Mod+End', 20],
  ['Mod+ArrowLeft', 11], ['Mod+ArrowRight', 14], ['PageUp', 3], ['PageDown', 18]
];
const movementFixtures = movements.flatMap(([keys, target]) => [
  { keys, text: movementText, selections: [[12, 12]], expectedSelections: [[target, target]] },
  { keys: keys.startsWith('Mod+') ? keys.replace('Mod+', 'Mod+Shift+') : 'Shift+' + keys,
    text: movementText, selections: [[12, 12]], expectedSelections: [[12, target]] }
]);
const edit = (keys, text, selections, expectedText, extras = {}) => ({ keys, text, selections, expectedText, ...extras });
const state = (keys, check, setup, extras = {}) => ({ keys, text: 'one\ntwo\nthree', check, setup, ...extras });

/** Independent expected text/selection/state results; these fixtures do not derive expected commands from the binding table. */
export const vscodeBehaviorFixtures = [
  ...movementFixtures,
  edit('Backspace', 'A😀B', [[3, 3]], 'AB'),
  edit('Delete', 'A😀B', [[1, 1]], 'AB'),
  edit('Mod+Backspace', 'one two', [[7, 7]], 'one '),
  edit('Mod+Delete', 'one two', [[0, 0]], 'two'),
  edit('Enter', 'ab', [[1, 1]], 'a\nb'),
  edit('Tab', 'a', [[1, 1]], 'a    '),
  edit('Shift+Tab', '    a', [[4, 5]], 'a'),
  { keys: 'Mod+A', text: 'alpha\nbeta', expectedSelections: [[0, 10]] },
  edit('Mod+X', 'alpha beta', [[0, 5]], ' beta', { check: editor => assert.equal(editor.clipboardText, 'alpha') }),
  edit('Mod+V', 'ab', [[1, 1]], 'aPASTEb', { setup: editor => { editor.clipboardText = 'PASTE'; } }),
  { keys: 'Mod+C', text: 'alpha beta', selections: [[0, 5]], check: editor => assert.equal(editor.clipboardText, 'alpha') },
  edit('Mod+Z', 'a', [[1, 1]], 'a', { setup: editor => editor.insertText('b', { undoStop: true }), undo: false }),
  ...['Mod+Y', 'Mod+Shift+Z'].map(keys => edit(keys, 'a', [[1, 1]], 'ab', {
    setup: editor => { editor.insertText('b', { undoStop: true }); editor.undo(); }, undo: false
  })),
  { keys: 'Mod+D', text: 'one one', selections: [[0, 3]], expectedSelections: [[0, 3], [4, 7]] },
  { keys: 'Mod+Shift+L', text: 'one one', selections: [[1, 1]], expectedSelections: [[0, 3], [4, 7]] },
  edit('Mod+Shift+K', 'one\ntwo', [[5, 5]], 'one'),
  { keys: 'Mod+L', text: 'one\ntwo', selections: [[1, 1]], expectedSelections: [[0, 4]] },
  edit('Mod+Enter', '  one\ntwo', [[3, 3]], '  one\n  \ntwo'),
  edit('Mod+Shift+Enter', '  one\ntwo', [[3, 3]], '  \n  one\ntwo'),
  edit('Alt+Shift+ArrowUp', 'one\ntwo', [[5, 5]], 'one\ntwo\ntwo'),
  edit('Alt+Shift+ArrowDown', 'one\ntwo', [[1, 1]], 'one\none\ntwo'),
  edit('Alt+ArrowUp', 'one\ntwo', [[5, 5]], 'two\none'),
  edit('Alt+ArrowDown', 'one\ntwo', [[1, 1]], 'two\none'),
  { keys: 'Mod+Alt+ArrowUp', text: 'one\ntwo', selections: [[5, 5]], expectedSelections: [[1, 1], [5, 5]] },
  { keys: 'Mod+Alt+ArrowDown', text: 'one\ntwo', selections: [[1, 1]], expectedSelections: [[1, 1], [5, 5]] },
  { keys: 'Mod+Shift+\\', text: '(ab)', pairs: [[0, 3], [3, 0]], expectedSelections: [[3, 3]] },
  edit('Mod+]', 'a', [[0, 1]], '    a'),
  edit('Mod+[', '    a', [[0, 5]], 'a'),
  state('Mod+ArrowUp', editor => assert.equal(editor.view.scrollTop, 22), editor => { editor.view.scrollTop = 44; }),
  state('Mod+ArrowDown', editor => assert.equal(editor.view.scrollTop, 22)),
  state('Mod+Shift+[', editor => assert.equal(editor.folding.hidden(1), true), folding),
  state('Mod+Shift+]', editor => assert.equal(editor.folding.hidden(1), false), editor => { folding(editor); editor.folding.collapseAll(); }),
  state('Mod+K Mod+0', editor => assert.equal(editor.folding.hidden(2), true), folding),
  state('Mod+K Mod+J', editor => assert.equal(editor.folding.hidden(2), false), editor => { folding(editor); editor.folding.collapseAll(); }),
  edit('Mod+K Mod+C', 'one\ntwo', [[0, 7]], '// one\n// two'),
  edit('Mod+K Mod+U', '// one\n// two', [[0, 13]], 'one\ntwo'),
  edit('Mod+/', 'one\ntwo', [[0, 7]], '// one\n// two'),
  state('Alt+Z', editor => assert.equal(editor.options.wordWrap, true)),
  { keys: 'Escape', text: 'one', selections: [[3, 0]], expectedSelections: [[0, 0]],
    check: editor => assert.equal(editor.completionClosed, true) },
  state('Insert', editor => assert.equal(editor.overtype, true)),
  state('Mod+=', editor => assert.equal(editor.options.zoom, 110)),
  state('Mod+-', editor => assert.equal(editor.options.zoom, 90)),
  state('Mod+0', editor => assert.equal(editor.options.zoom, 100), editor => editor.setZoom(150)),
  ...[
    ['Mod+P', 'navigateTo'], ['Mod+Shift+P', 'commands'], ['F1', 'commands'], ['Mod+,', 'settings'],
    ['Mod+K Mod+S', 'keyboardSettings'], ['Mod+S', 'save'], ['Mod+Shift+S', 'saveAll'],
    ['Mod+F4', 'closeDocument'], ['Ctrl+F6', 'nextDocument'], ['Ctrl+Shift+F6', 'previousDocument'],
    ['Mod+Alt+N', 'newDocument'], ['Mod+Alt+O', 'openDocumentPrompt'], ['Mod+\\', 'splitVertical'],
    ['Alt+ArrowLeft', 'navigateBack'], ['Alt+ArrowRight', 'navigateForward'], ['F12', 'definition'],
    ['Shift+F12', 'references'], ['Mod+Shift+F', 'findFiles'], ['Mod+Shift+H', 'replaceFiles']
  ].map(([keys, command]) => state(keys, editor => assert.deepEqual(editor.requests, [{ command,
    params: { uri: editor.uri, offset: 0 } }]))),
  ...[
    ['Mod+F', 'openFind', [false]], ['Mod+H', 'openFind', [true]], ['F3', 'findNext', [false, 1]],
    ['Shift+F3', 'findNext', [false, -1]], ['Mod+Space', 'complete', []], ['Mod+Shift+Space', 'signatureHelp', []],
    ['Mod+K Mod+I', 'quickInfo', []], ['Mod+.', 'codeActions', []], ['F2', 'rename', []],
    ['Alt+Shift+F', 'format', [{}]], ['Alt+Shift+ArrowRight', 'expandSelection', []], ['Alt+Shift+ArrowLeft', 'shrinkSelection', []]
  ].map(([keys, method, args]) => state(keys, editor => assert.deepEqual(editor.featureResult, { method, args }), editor => {
    editor.insights = { [method]: (...received) => { editor.featureResult = { method, args: received }; } };
  }))
];

function folding(editor) { editor.folding.setRanges([{ startLine: 0, endLine: 2 }], editor.model.lineCount); }
