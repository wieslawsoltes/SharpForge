import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor} from '@sharpforge/editor';
import {editorDom} from './fixtures/a18-editor-dom.js';

function createEditor(t, options = {}) {
  const fixture = editorDom();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  Object.defineProperty(globalThis, 'ResizeObserver', {value: fixture.document.defaultView.ResizeObserver, configurable: true});
  const editor = new CodeEditor(fixture.element, options);
  t.after(() => {
    if (!editor.disposed) editor.dispose();
    if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous);
    else delete globalThis.ResizeObserver;
  });
  return {...fixture, editor};
}

const diagnostic = severity => ({start: 4, length: 5, severity, range: {start: {line: 0, character: 4}}, message: severity});
const writes = editor => ({highlight: editor.highlight.htmlWrites, gutter: editor.gutter.htmlWrites});

test('A18 editor: source and all decorations publish synchronously with one DOM flush per native change', t => {
  let editor;
  let before;
  let changes = 0;
  const cursors = [];
  const diagnostics = [diagnostic('warning')];
  const breakpoints = [{line: 2, verified: false, message: 'Pending'}];
  const point = {line: 2, start: 16, end: 19};
  const details = {phase: 'stopped', description: 'Current instruction'};
  const fixture = createEditor(t, {
    onChange: value => {
      changes++;
      editor.setDiagnostics(diagnostics);
      editor.setBreakpoints(breakpoints);
      editor.setExecutionLocation(point, details);
      editor.setSelectedFrameLine(3);
      assert.equal(editor.value, value);
      assert.equal(editor.sourceSnapshot().text, value);
      assert.equal(editor.highlightIndex.source.text, value);
      assert.equal(editor.lexedSource, editor.sourceSnapshot());
      assert.equal(editor.diagnostics, diagnostics);
      assert.equal(editor.breakpoints, breakpoints);
      assert.equal(editor.executionPoint, point);
      assert.equal(editor.executionDetails, details);
      assert.equal(editor.selectedFrameLine, 3);
      assert.equal(editor.history.length, 1);
      assert.deepEqual(writes(editor), before, 'source preparation must not expose intermediate decoration DOM');
    },
    onCursor: position => {
      cursors.push(position);
      if (before) assert.deepEqual(writes(editor), before, 'cursor callback participates in the same synchronous publication');
    }
  });
  editor = fixture.editor;
  const text = Array.from({length: 3000}, (_, line) => `int value${line} = ${line};\n`).join('');
  editor.setModel('Large.cs', text);
  const source = editor.sourceSnapshot();
  before = writes(editor);
  const start = text.indexOf('= 0') + 2;
  editor.input.setRangeText('7', start, start + 1, 'end');
  editor.changed();
  assert.equal(changes, 1);
  assert.deepEqual(writes(editor), {highlight: before.highlight + 1, gutter: before.gutter + 1});
  assert.equal(editor.sourceSnapshot().version, source.version + 1);
  assert.equal(cursors.at(-1).offset, start + 1);
  assert.equal(editor.history[0].text, text);
  assert(editor.highlight.querySelector('.sf-squiggle-warning'));
  assert(editor.highlight.querySelector('.sf-current-statement'));
  assert(editor.gutter.querySelector('[data-line="2"]').classList.contains('breakpoint'));
  assert(editor.gutter.querySelector('[data-line="2"]').classList.contains('execution'));
  assert(editor.gutter.querySelector('[data-line="3"]').classList.contains('selected-frame'));
  assert(editor.highlightMetrics.lastLine - editor.highlightMetrics.firstLine < 40);
});

test('A18 editor: decoration setters outside a change still update their DOM before returning', t => {
  const {editor} = createEditor(t);
  editor.setModel('Immediate.cs', 'int value = 1;\nConsole.WriteLine(value);');
  editor.setDiagnostics([diagnostic('error')]);
  assert(editor.highlight.querySelector('.sf-squiggle'));
  assert(editor.gutter.querySelector('[data-line="1"]').classList.contains('error'));
  editor.setBreakpoints([{line: 2}]);
  assert(editor.gutter.querySelector('[data-line="2"]').classList.contains('breakpoint'));
  editor.setExecutionLocation({line: 1, start: 0, end: 3}, {description: 'At entry'});
  assert(editor.highlight.querySelector('.sf-current-statement'));
  assert.equal(editor.element.querySelector('.sf-execution-line').hidden, false);
  editor.setSelectedFrameLine(2);
  assert.equal(editor.element.querySelector('.sf-selected-frame-line').hidden, false);
  assert(editor.gutter.querySelector('[data-line="2"]').classList.contains('selected-frame'));
  editor.setDiagnostics([]);
  editor.setExecutionLocation(null);
  editor.setSelectedFrameLine(null);
  assert.equal(editor.highlight.querySelector('.sf-squiggle'), null);
  assert.equal(editor.highlight.querySelector('.sf-current-statement'), null);
  assert.equal(editor.element.querySelector('.sf-execution-line').hidden, true);
  assert.equal(editor.element.querySelector('.sf-selected-frame-line').hidden, true);
});

test('A18 editor: nested source callbacks retain their histories and flush only the final visible state', t => {
  let editor;
  let before;
  const changes = [];
  ({editor} = createEditor(t, {onChange: value => {
    changes.push(value);
    editor.setDiagnostics([diagnostic(value.includes('= 2;') ? 'warning' : 'error')]);
    if (value.includes('= 2;')) editor.setValue('int value = 3;');
    assert.deepEqual(writes(editor), before);
    assert.equal(editor.sourceSnapshot().text, editor.value);
  }}));
  editor.setModel('Nested.cs', 'int value = 1;');
  before = writes(editor);
  editor.setValue('int value = 2;');
  assert.deepEqual(changes, ['int value = 2;', 'int value = 3;']);
  assert.deepEqual(editor.history.map(item => item.text), ['int value = 1;', 'int value = 2;']);
  assert.equal(editor.value, 'int value = 3;');
  assert.equal(editor.previous, editor.value);
  assert.equal(editor.highlight.textContent, 'int value = 3;\n');
  assert.equal(editor.highlight.querySelector('.sf-squiggle-warning'), null);
  assert(editor.highlight.querySelector('.sf-squiggle'));
  assert.deepEqual(writes(editor), {highlight: before.highlight + 1, gutter: before.gutter + 1});
});

test('A18 editor: a throwing source callback flushes prepared values and does not poison the next update', t => {
  let editor;
  let fail = true;
  let cursors = 0;
  const failure = new Error('Consumer failed');
  ({editor} = createEditor(t, {
    onChange: () => {
      editor.setDiagnostics([diagnostic(fail ? 'error' : 'warning')]);
      editor.setBreakpoints([{line: 1}]);
      if (fail) throw failure;
    },
    onCursor: () => cursors++
  }));
  editor.setModel('Failure.cs', 'int value = 1;');
  const cursorCount = cursors;
  const before = writes(editor);
  assert.throws(() => editor.setValue('int value = 2;'), error => error === failure);
  assert.equal(cursors, cursorCount, 'a failed onChange must not invent a subsequent onCursor callback');
  assert.equal(editor.sourceSnapshot().text, 'int value = 2;');
  assert.equal(editor.highlightIndex.source.text, 'int value = 2;');
  assert.equal(editor.highlight.textContent, 'int value = 2;\n');
  assert(editor.gutter.querySelector('[data-line="1"]').classList.contains('breakpoint'));
  assert.deepEqual(writes(editor), {highlight: before.highlight + 1, gutter: before.gutter + 1});
  fail = false;
  editor.setValue('int value = 3;');
  assert.equal(cursors, cursorCount + 1);
  assert.equal(editor.highlight.textContent, 'int value = 3;\n');
  assert(editor.highlight.querySelector('.sf-squiggle-warning'));
});

test('A18 editor: exceptions before any setter and from onCursor cannot leave source or pending DOM stale', t => {
  let editor;
  let phase = 'none';
  const failure = new Error('Callback boundary');
  ({editor} = createEditor(t, {
    onChange: () => { if (phase === 'change') throw failure; },
    onCursor: () => {
      if (phase === 'cursor') {
        editor.setSelectedFrameLine(1);
        throw failure;
      }
    }
  }));
  editor.setModel('Boundary.cs', 'int value = 1;');
  phase = 'change';
  assert.throws(() => editor.setValue('int value = 2;'), error => error === failure);
  assert.equal(editor.highlightIndex.source.text, 'int value = 2;');
  assert.equal(editor.highlight.textContent, 'int value = 2;\n');
  phase = 'cursor';
  assert.throws(() => editor.setValue('int value = 3;'), error => error === failure);
  assert.equal(editor.highlight.textContent, 'int value = 3;\n');
  assert(editor.gutter.querySelector('[data-line="1"]').classList.contains('selected-frame'));
  phase = 'none';
  editor.setValue('int value = 4;');
  assert.equal(editor.highlight.textContent, 'int value = 4;\n');
});

test('A18 editor: disposal in a source callback discards pending detached DOM writes and queued resize work', t => {
  let editor;
  let disposedWrites;
  const fixture = createEditor(t, {onChange: () => {
    editor.setDiagnostics([diagnostic('warning')]);
    editor.setExecutionLocation({line: 1, start: 0, end: 3});
    editor.dispose();
    disposedWrites = writes(editor);
  }});
  editor = fixture.editor;
  editor.setModel('Dispose.cs', 'int value = 1;');
  const before = writes(editor);
  editor.setValue('int value = 2;');
  assert.equal(editor.disposed, true);
  assert.deepEqual(disposedWrites, before, 'staged decorations must not repaint the detached overlay');
  assert.deepEqual(writes(editor), before);
  assert.equal(editor.element.children.length, 0);
  assert.equal(editor.sourceSnapshot().text, 'int value = 2;');
  fixture.observers[0].callback();
  editor.sync();
  assert.deepEqual(writes(editor), before);
  assert.equal(editor.element.children.length, 0);
});

test('A18 editor: undo and redo keep source, caret, selection, history and final decorations synchronous', t => {
  let editor;
  let before;
  const changes = [];
  ({editor} = createEditor(t, {onChange: value => {
    changes.push(value);
    editor.setDiagnostics([diagnostic(value.includes('second') ? 'warning' : 'error')]);
    editor.setBreakpoints([{line: 2}]);
    editor.setExecutionLocation({line: 2, start: value.indexOf('Console'), end: value.indexOf('Console') + 7});
    editor.setSelectedFrameLine(1);
    assert.deepEqual(writes(editor), before);
  }}));
  const text = 'int first = 1;\nConsole.WriteLine(first);';
  editor.setModel('History.cs', text);
  editor.input.setSelectionRange(4, 9);
  before = writes(editor);
  editor.insert('second');
  const changed = editor.value;
  assert.deepEqual(writes(editor), {highlight: before.highlight + 1, gutter: before.gutter + 1});
  assert.equal(editor.offset, 10);
  assert.equal(editor.input.selectionEnd, 10);
  before = writes(editor);
  editor.undo();
  assert.equal(editor.value, text);
  assert.equal(editor.sourceSnapshot().text, text);
  assert.equal(editor.highlight.textContent, text + '\n');
  assert.equal(editor.offset, 4);
  assert.equal(editor.input.selectionEnd, 9);
  assert.equal(editor.history.length, 0);
  assert.equal(editor.future.length, 1);
  assert.deepEqual(writes(editor), {highlight: before.highlight + 1, gutter: before.gutter + 1});
  before = writes(editor);
  editor.undo(true);
  assert.equal(editor.value, changed);
  assert.equal(editor.highlight.textContent, changed + '\n');
  assert.equal(editor.offset, 10);
  assert.equal(editor.input.selectionEnd, 10);
  assert.equal(editor.history.length, 1);
  assert.equal(editor.future.length, 0);
  assert.deepEqual(changes, [changed, text, changed]);
  assert.deepEqual(writes(editor), {highlight: before.highlight + 1, gutter: before.gutter + 1});
});

test('A18 editor: identical selected and execution lines do not rewrite native hidden attributes', t => {
  const {editor} = createEditor(t);
  editor.setModel('Visibility.cs', 'int value = 1;\nConsole.WriteLine(value);');
  const lines = ['.sf-selected-frame-line', '.sf-execution-line'].map(selector => editor.element.querySelector(selector));
  const assignments = [];
  for (const line of lines) {
    let hidden = line.hidden;
    Object.defineProperty(line, 'hidden', {
      get: () => hidden,
      set: value => { assignments.push([line.className, value]); hidden = value; }
    });
  }
  editor.setDiagnostics([]);
  editor.setBreakpoints([]);
  editor.setSelectedFrameLine(null);
  editor.setExecutionLocation(null);
  editor.cursor();
  assert.equal(assignments.length, 0);
  editor.setSelectedFrameLine(1);
  editor.setExecutionLocation({line: 2});
  assert.equal(assignments.length, 2);
  editor.setSelectedFrameLine(2);
  editor.setExecutionLocation({line: 1}, {description: 'Updated location'});
  editor.cursor();
  assert.equal(assignments.length, 2, 'visible line movement must update top and gutter without toggling visibility');
  assert.equal(lines[0].style.top, '36px');
  assert.equal(lines[1].style.top, '14px');
  assert(editor.gutter.querySelector('[data-line="1"]').getAttribute('title').includes('Updated location'));
  editor.setSelectedFrameLine(null);
  editor.setExecutionLocation(null);
  assert.equal(assignments.length, 4);
});
