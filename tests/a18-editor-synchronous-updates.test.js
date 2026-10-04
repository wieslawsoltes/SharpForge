import test from 'node:test';
import assert from 'node:assert/strict';
import {createVirtualEditor, gutterLine, sourceRows} from './fixtures/a18-virtual-editor-dom.js';

const diagnostic = severity => ({start: 4, length: 5, severity, range: {start: {line: 0, character: 4}}, message: severity});
const visibleText = editor => sourceRows(editor).join('\n');

test('A18 editor: source, history and diagnostics publish synchronously before one scheduled virtual frame', t => {
  let editor;
  let before;
  let changes = 0;
  const edits = [];
  const diagnostics = [diagnostic('warning')];
  const breakpoints = [{line: 2, verified: false, message: 'Pending'}];
  const point = {line: 2, start: 16, end: 19};
  const details = {phase: 'stopped', description: 'Current instruction'};
  const fixture = createVirtualEditor(t, {
    onEdits: change => edits.push(change),
    onChange: value => {
      changes++;
      editor.setDiagnostics(diagnostics);
      editor.setBreakpoints(breakpoints);
      editor.setExecutionLocation(point, details);
      editor.setSelectedFrameLine(3);
      assert.equal(editor.value, value);
      assert.equal(editor.sourceSnapshot().text, value);
      assert.equal(editor.highlightIndex.source, editor.sourceSnapshot());
      assert.equal(editor.diagnostics[0].message, 'warning');
      assert.equal(editor.breakpoints, breakpoints);
      assert.equal(editor.executionPoint, point);
      assert.equal(editor.executionDetails, details);
      assert.equal(editor.selectedFrameLine, 3);
      assert.equal(editor.history.length, 1);
      assert.equal(editor.view.lines.elementFor(0).replaceWrites, before);
    }
  });
  editor = fixture.editor;
  const text = Array.from({length: 3000}, (_, line) => `int value${line} = ${line};\n`).join('');
  editor.setModel('Large.cs', text);
  fixture.flushFrames();
  const source = editor.sourceSnapshot();
  const row = editor.view.lines.elementFor(0);
  before = row.replaceWrites;
  const start = text.indexOf('= 0') + 2;
  editor.input.setSelectionRange(start, start + 1);
  editor.input.dispatch('beforeinput', {inputType: 'insertText', data: '7'});
  assert.equal(changes, 1);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].before, source);
  assert.equal(edits[0].after, editor.sourceSnapshot());
  assert.equal(editor.sourceSnapshot().version, source.version + 1);
  assert.equal(editor.offset, start + 1);
  assert.equal(fixture.frames.size, 1);
  fixture.flushFrames();
  assert.equal(row.replaceWrites, before + 1);
  assert(editor.highlight.querySelector('.sf-diagnostic-warning'));
  assert(editor.highlight.querySelector('.sf-current-statement'));
  assert(gutterLine(editor, 2).classList.contains('breakpoint'));
  assert(gutterLine(editor, 2).classList.contains('execution'));
  assert(gutterLine(editor, 3).classList.contains('selected-frame'));
  assert(editor.highlightMetrics.domLines < 40);
});

test('A18 editor: decoration state is immediate and explicit paint flushes the virtual presentation', t => {
  const fixture = createVirtualEditor(t);
  const {editor} = fixture;
  editor.setModel('Immediate.cs', 'int value = 1;\nConsole.WriteLine(value);');
  fixture.flushFrames();
  editor.setDiagnostics([diagnostic('error')]);
  editor.setBreakpoints([{line: 2}]);
  editor.setExecutionLocation({line: 1, start: 0, end: 3}, {description: 'At entry'});
  editor.setSelectedFrameLine(2);
  assert.equal(editor.diagnostics[0].severity, 'error');
  assert.equal(editor.executionLine, 1);
  assert.equal(editor.selectedFrameLine, 2);
  assert.equal(fixture.frames.size, 1);
  editor.paintViewport();
  assert.equal(fixture.frames.size, 0, 'an explicit render consumes its scheduled frame');
  assert(editor.highlight.querySelector('.sf-diagnostic-error'));
  assert(editor.highlight.querySelector('.sf-current-statement'));
  assert(gutterLine(editor, 1).classList.contains('error'));
  assert(gutterLine(editor, 2).classList.contains('breakpoint'));
  assert(editor.view.lines.elementFor(0).classList.contains('sf-execution-line'));
  assert(editor.view.lines.elementFor(1).classList.contains('sf-selected-frame-line'));
  editor.setDiagnostics([]);
  editor.setExecutionLocation(null);
  editor.setSelectedFrameLine(null);
  fixture.flushFrames();
  assert.equal(editor.highlight.querySelector('.sf-diagnostic-error'), null);
  assert.equal(editor.highlight.querySelector('.sf-current-statement'), null);
  assert.equal(editor.highlight.querySelector('.sf-execution-line'), null);
  assert.equal(editor.highlight.querySelector('.sf-selected-frame-line'), null);
});

test('A18 editor: nested callbacks keep native undo groups and present the newest revision once', t => {
  let editor;
  let row;
  let before;
  const changes = [];
  const fixture = createVirtualEditor(t, {onChange: value => {
    changes.push(value);
    editor.setDiagnostics([diagnostic(value.includes('= 2;') ? 'warning' : 'error')]);
    if (value.includes('= 2;')) editor.setValue('int value = 3;');
    assert.equal(row.replaceWrites, before);
    assert.equal(editor.sourceSnapshot().text, editor.value);
  }});
  editor = fixture.editor;
  editor.setModel('Nested.cs', 'int value = 1;');
  fixture.flushFrames();
  row = editor.view.lines.elementFor(0);
  before = row.replaceWrites;
  editor.setValue('int value = 2;');
  assert.deepEqual(changes, ['int value = 2;', 'int value = 3;']);
  assert.equal(editor.history.length, 2);
  assert.equal(editor.value, 'int value = 3;');
  assert.equal(editor.diagnostics[0].severity, 'error', 'an outer callback must not clear newer diagnostics');
  fixture.flushFrames();
  assert.equal(visibleText(editor), 'int value = 3;');
  assert.equal(row.replaceWrites, before + 1);
  assert.equal(editor.highlight.querySelector('.sf-diagnostic-warning'), null);
  assert(editor.highlight.querySelector('.sf-diagnostic-error'));
  editor.onChange = null;
  editor.undo();
  assert.equal(editor.value, 'int value = 2;');
  editor.undo();
  assert.equal(editor.value, 'int value = 1;');
});

test('A18 editor: a throwing source callback leaves prepared values renderable and the next update usable', t => {
  let editor;
  let fail = true;
  let cursors = 0;
  const failure = new Error('Consumer failed');
  const fixture = createVirtualEditor(t, {
    onChange: () => {
      editor.setDiagnostics([diagnostic(fail ? 'error' : 'warning')]);
      editor.setBreakpoints([{line: 1}]);
      if (fail) throw failure;
    }, onCursor: () => cursors++
  });
  editor = fixture.editor;
  editor.setModel('Failure.cs', 'int value = 1;');
  fixture.flushFrames();
  const count = cursors;
  assert.throws(() => editor.setValue('int value = 2;'), error => error === failure);
  assert.equal(cursors, count);
  assert.equal(editor.sourceSnapshot().text, 'int value = 2;');
  assert.equal(editor.highlightIndex.source.text, 'int value = 2;');
  assert.equal(editor.diagnostics[0].severity, 'error');
  assert.equal(fixture.frames.size, 1);
  fixture.flushFrames();
  assert.equal(visibleText(editor), 'int value = 2;');
  assert(gutterLine(editor, 1).classList.contains('breakpoint'));
  fail = false;
  editor.setValue('int value = 3;');
  fixture.flushFrames();
  assert.equal(cursors, count + 1);
  assert.equal(visibleText(editor), 'int value = 3;');
  assert(editor.highlight.querySelector('.sf-diagnostic-warning'));
});

test('A18 editor: exceptions before setters or from onCursor cannot strand prepared source or DOM', t => {
  let editor;
  let phase = 'none';
  const failure = new Error('Callback boundary');
  const fixture = createVirtualEditor(t, {
    onChange: () => { if (phase === 'change') throw failure; },
    onCursor: () => { if (phase === 'cursor') { editor.setSelectedFrameLine(1); throw failure; } }
  });
  editor = fixture.editor;
  editor.setModel('Boundary.cs', 'int value = 1;');
  phase = 'change';
  assert.throws(() => editor.setValue('int value = 2;'), error => error === failure);
  fixture.flushFrames();
  assert.equal(editor.highlightIndex.source.text, 'int value = 2;');
  assert.equal(visibleText(editor), 'int value = 2;');
  phase = 'cursor';
  assert.throws(() => editor.setValue('int value = 3;'), error => error === failure);
  fixture.flushFrames();
  assert.equal(visibleText(editor), 'int value = 3;');
  assert(gutterLine(editor, 1).classList.contains('selected-frame'));
  phase = 'none';
  editor.setValue('int value = 4;');
  fixture.flushFrames();
  assert.equal(visibleText(editor), 'int value = 4;');
});

test('A18 editor: disposal during publication discards pending row writes and queued resize work', t => {
  let editor;
  let row;
  let before;
  const fixture = createVirtualEditor(t, {onChange: () => {
    editor.setDiagnostics([diagnostic('warning')]);
    editor.setExecutionLocation({line: 1, start: 0, end: 3});
    editor.dispose();
    assert.equal(row.replaceWrites, before);
  }});
  editor = fixture.editor;
  editor.setModel('Dispose.cs', 'int value = 1;');
  fixture.flushFrames();
  row = editor.view.lines.elementFor(0);
  before = row.replaceWrites;
  editor.setValue('int value = 2;');
  assert.equal(editor.disposed, true);
  assert.equal(editor.sourceSnapshot().text, 'int value = 2;');
  const writes = {...fixture.writes};
  fixture.observers[0].callback();
  editor.sync();
  fixture.flushFrames();
  assert.deepEqual(fixture.writes, writes);
  assert.equal(editor.element.children.length, 0);
  assert.equal(row.replaceWrites, before);
});

test('A18 editor: undo and redo immediately restore source, caret, selection, history and diagnostics', t => {
  let editor;
  const changes = [];
  const fixture = createVirtualEditor(t, {onChange: value => {
    changes.push(value);
    editor.setDiagnostics([diagnostic(value.includes('second') ? 'warning' : 'error')]);
    editor.setBreakpoints([{line: 2}]);
    editor.setExecutionLocation({line: 2, start: value.indexOf('Console'), end: value.indexOf('Console') + 7});
    editor.setSelectedFrameLine(1);
  }});
  editor = fixture.editor;
  const text = 'int first = 1;\nConsole.WriteLine(first);';
  editor.setModel('History.cs', text);
  editor.input.setSelectionRange(4, 9);
  editor.insert('second');
  const changed = editor.value;
  assert.equal(editor.offset, 10);
  assert.equal(editor.input.selectionEnd, 10);
  editor.undo();
  assert.equal(editor.value, text);
  assert.equal(editor.sourceSnapshot().text, text);
  assert.equal(editor.offset, 4);
  assert.equal(editor.input.selectionEnd, 9);
  assert.equal(editor.history.length, 0);
  assert.equal(editor.future.length, 1);
  assert.equal(editor.diagnostics[0].severity, 'error');
  fixture.flushFrames();
  assert.equal(visibleText(editor), text);
  editor.undo(true);
  assert.equal(editor.value, changed);
  assert.equal(editor.offset, 10);
  assert.equal(editor.input.selectionEnd, 10);
  assert.equal(editor.history.length, 1);
  assert.equal(editor.future.length, 0);
  assert.equal(editor.diagnostics[0].severity, 'warning');
  fixture.flushFrames();
  assert.equal(visibleText(editor), changed);
  assert.deepEqual(changes, [changed, text, changed]);
});

test('A18 editor: selected and execution line movement reuses syntax nodes and removes cleared row state', t => {
  const fixture = createVirtualEditor(t);
  const {editor} = fixture;
  editor.setModel('Visibility.cs', 'int value = 1;\nConsole.WriteLine(value);');
  fixture.flushFrames();
  const lines = [editor.view.lines.elementFor(0), editor.view.lines.elementFor(1)];
  const children = lines.map(line => [...line.children]);
  editor.setSelectedFrameLine(1);
  editor.setExecutionLocation({line: 2});
  fixture.flushFrames();
  assert(lines[0].classList.contains('sf-selected-frame-line'));
  assert(lines[1].classList.contains('sf-execution-line'));
  editor.setSelectedFrameLine(2);
  editor.setExecutionLocation({line: 1}, {description: 'Updated location'});
  fixture.flushFrames();
  assert.equal(lines[0].classList.contains('sf-selected-frame-line'), false);
  assert.equal(lines[1].classList.contains('sf-execution-line'), false);
  assert(lines[1].classList.contains('sf-selected-frame-line'));
  assert(lines[0].classList.contains('sf-execution-line'));
  assert(gutterLine(editor, 1).title.includes('Updated location'));
  assert.deepEqual(lines.map(line => line.children), children);
  editor.setSelectedFrameLine(null);
  editor.setExecutionLocation(null);
  fixture.flushFrames();
  assert.equal(editor.highlight.querySelector('.sf-selected-frame-line'), null);
  assert.equal(editor.highlight.querySelector('.sf-execution-line'), null);
});
