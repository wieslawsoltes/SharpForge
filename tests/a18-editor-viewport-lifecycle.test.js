import test from 'node:test';
import assert from 'node:assert/strict';
import {CodeEditor} from '@sharpforge/editor';
import {SourceText} from '@sharpforge/text';
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

test('A18 editor: one native revision paints once despite synchronous diagnostic and cursor callbacks', async t => {
  const changes = [];
  const cursors = [];
  let editor;
  const fixture = createEditor(t, {onChange: value => { changes.push(value); editor.setDiagnostics([]); }, onCursor: value => cursors.push(value)});
  editor = fixture.editor;
  const text = Array.from({length: 3000}, (_, line) => `int value${line} = ${line};\n`).join('');
  editor.setModel('Large.cs', text);
  const firstSource = editor.sourceSnapshot();
  const writes = editor.highlight.htmlWrites;
  const gutterWrites = editor.gutter.htmlWrites;
  const start = text.indexOf('= 0') + 2;
  editor.input.setRangeText('7', start, start + 1, 'end');
  await editor.input.fire('input');
  assert.equal(changes.length, 1);
  assert.equal(editor.highlight.htmlWrites, writes + 1, 'changed source replaces the visible markup only once');
  assert.equal(editor.gutter.htmlWrites, gutterWrites, 'an edit on the same line must retain identical gutter nodes');
  assert.equal(editor.offset, start + 1);
  assert.equal(editor.input.selectionEnd, start + 1);
  assert.equal(cursors.at(-1).offset, start + 1);
  assert.equal(editor.sourceSnapshot().version, firstSource.version + 1);
  assert.equal(editor.sourceSnapshot(), editor.sourceSnapshot());
  assert.equal(editor.highlightMetrics.totalTokens, editor.highlightIndex.tokenCount);
  assert(editor.highlightMetrics.lastLine - editor.highlightMetrics.firstLine < 40);
  assert(editor.highlight.querySelectorAll('span').length < 1000);
  await editor.input.fire('input');
  assert.equal(changes.length, 1, 'duplicate native input must not publish a second source revision');
  assert.equal(editor.highlight.htmlWrites, writes + 1);
});

test('A18 editor: equivalent diagnostics preserve nodes, while visible severity and execution changes repaint', t => {
  const {editor} = createEditor(t);
  editor.setModel('Decorated.cs', 'int answer = (42);\nConsole.WriteLine(answer);');
  const diagnostic = {start: 4, length: 6, severity: 'warning', range: {start: {line: 0, character: 4}}, message: 'First'};
  editor.setDiagnostics([diagnostic]);
  const warning = editor.highlight.querySelector('.sf-squiggle-warning');
  assert(warning);
  const writes = editor.highlight.htmlWrites;
  const latest = {...diagnostic, message: 'Updated analysis details'};
  editor.setDiagnostics([latest]);
  editor.paint();
  editor.cursor();
  assert.equal(editor.diagnostics[0], latest, 'latest diagnostics remain observable even when their paint is identical');
  assert.equal(editor.highlight.htmlWrites, writes);
  assert.equal(editor.highlight.querySelector('.sf-squiggle-warning'), warning);
  editor.setDiagnostics([{...latest, severity: 'error'}]);
  assert.equal(editor.highlight.htmlWrites, writes + 1);
  assert.equal(editor.highlight.querySelector('.sf-squiggle-warning'), null);
  assert(editor.gutter.querySelector('[data-line="1"]').classList.contains('error'));
  editor.setExecutionLocation({line: 1, start: 0, end: 3}, {phase: 'stopped', description: 'Paused here'});
  assert(editor.highlight.querySelector('.sf-current-statement'));
  assert(editor.gutter.querySelector('[data-line="1"]').getAttribute('title').includes('Paused here'));
  const executionWrites = editor.highlight.htmlWrites;
  editor.setExecutionLocation({line: 1, start: 0, end: 3}, {phase: 'stopped', description: 'New detail'});
  assert.equal(editor.highlight.htmlWrites, executionWrites);
  assert(editor.gutter.querySelector('[data-line="1"]').getAttribute('title').includes('New detail'));
  editor.setExecutionLocation(null);
  assert.equal(editor.highlight.querySelector('.sf-current-statement'), null);
});

test('A18 editor: scrolling, resizing and horizontal movement retain viewport, gutter and caret contracts', t => {
  const {editor, element, observers} = createEditor(t);
  const text = Array.from({length: 3000}, (_, line) => `int row${line} = ${line};\n`).join('');
  editor.setModel('Scroll.cs', text);
  const source = editor.sourceSnapshot();
  const offset = source.offsetAt({line: 1500, character: 5});
  editor.input.setSelectionRange(offset, offset + 3);
  editor.input.scrollTop = 1500 * 22;
  editor.input.scrollLeft = 80;
  editor.setBreakpoints([{line: 1501, verified: false, enabled: false, message: 'Pending breakpoint'}]);
  editor.setSelectedFrameLine(1501);
  editor.cursor();
  assert(editor.highlightMetrics.firstLine <= 1500 && editor.highlightMetrics.lastLine > 1500);
  assert(editor.highlightMetrics.lastLine - editor.highlightMetrics.firstLine <= 30);
  assert(editor.highlight.style.transform.startsWith('translate(-80px,'));
  const row = editor.gutter.querySelector('[data-line="1501"]');
  for (const name of ['current', 'breakpoint', 'pending', 'disabled-breakpoint', 'selected-frame']) assert(row.classList.contains(name));
  assert.equal(editor.offset, offset);
  assert.equal(editor.input.selectionEnd, offset + 3);
  assert.equal(element.querySelector('.sf-current-line').style.top, '14px');
  const writes = editor.highlight.htmlWrites;
  editor.input.scrollLeft = 120;
  editor.sync();
  assert.equal(editor.highlight.htmlWrites, writes, 'horizontal scroll translates existing syntax nodes');
  assert(editor.highlight.style.transform.startsWith('translate(-120px,'));
  element.clientHeight = 660;
  observers[0].callback();
  assert(editor.highlightMetrics.lastLine - editor.highlightMetrics.firstLine > 30);
  assert(editor.highlightMetrics.lastLine - editor.highlightMetrics.firstLine < 45);
  assert.equal(editor.offset, offset);
  assert.equal(editor.sourceSnapshot(), source);
});

test('A18 editor: offscreen source edits reuse visible nodes and model switches clear stale decoration state', t => {
  const {editor} = createEditor(t);
  const text = ('int n = 1;\n').repeat(3000);
  editor.setModel('First.cs', text);
  const writes = editor.highlight.htmlWrites;
  const start = text.lastIndexOf('1');
  editor.input.setRangeText('2', start, start + 1, 'end');
  editor.changed();
  assert.equal(editor.highlight.htmlWrites, writes, 'unchanged visible text must keep its existing nodes');
  assert.equal(editor.sourceSnapshot().text, text.slice(0, start) + '2' + text.slice(start + 1));
  editor.setDiagnostics([{start: 0, length: 3, range: {start: {line: 0}}, severity: 'error'}]);
  assert(editor.highlight.querySelector('.sf-squiggle'));
  editor.setModel('Second.cs', 'class Other {}');
  assert.equal(editor.diagnostics.length, 0);
  assert.equal(editor.highlight.querySelector('.sf-squiggle'), null);
  assert.equal(editor.highlight.textContent, 'class Other {}\n');
  assert.equal(editor.sourceSnapshot().uri, 'Second.cs');
  assert.deepEqual(editor.sourceSnapshot().lineStarts, new SourceText(editor.value).lineStarts);
});

test('A18 editor: disposal disconnects the viewport and ignores a previously queued resize notification', t => {
  const {editor, element, observers} = createEditor(t);
  editor.setModel('Dispose.cs', 'class C {}');
  const input = editor.input;
  assert(input.getAttribute('aria-description').includes('Escape'));
  editor.dispose();
  const writes = element.htmlWrites;
  observers[0].callback();
  editor.sync();
  assert.equal(observers[0].disconnected, true);
  assert.equal(element.htmlWrites, writes);
  assert.equal(element.children.length, 0);
  assert.equal(input.getAttribute('aria-description'), null);
});
