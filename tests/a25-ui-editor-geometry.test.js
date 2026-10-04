import test from 'node:test';
import assert from 'node:assert/strict';
import { gitEditorView, gitEditorVisibleLines, gitEditorCursorGeometry, subscribeGitEditorView } from '../apps/studio/git-editor-geometry.js';
import { createStudioEditorCollaborationHost } from '../apps/studio/git-collab-editor-host.js';
import { editorFixture } from './helpers/a25-collab-studio.js';

function nativeFixture(rows = []) {
  const layoutCalls = [];
  const rectangleCalls = [];
  const caretCalls = [];
  const contributions = new Set();
  const editor = {
    lineHeight: 22, padding: 14, input: { scrollTop: 700000 },
    element: { clientHeight: 110, getBoundingClientRect: () => ({ left: 20, top: 80, width: 700, height: 110 }) },
    model: { length: 1000, positionAt: offset => ({ line: Math.floor(offset / 20), character: offset % 20 }) },
    folding: { hidden: line => line === 8 },
    onCursor() {},
    registerContribution(contribution) {
      contributions.add(contribution);
      return () => contributions.delete(contribution);
    }
  };
  editor.view = {
    scrollTop: 1000,
    viewport: { clientWidth: 600, clientHeight: 66,
      getBoundingClientRect: () => ({ left: 96, top: 100, right: 696, bottom: 166, width: 600, height: 66 }) },
    coordsAt(offset) { caretCalls.push(offset); return { left: 112, top: 46, height: 22, local: true }; },
    layout: { rows(...args) { layoutCalls.push(args); return rows; } },
    lines: { elementFor(line, continuation) { return rows.find(row => row.line === line && row.continuation === continuation)?.element; } },
    bidi: { rectangles(element, start, end) { rectangleCalls.push({ element, start, end }); return element.rectangles; } }
  };
  return { editor, rows, layoutCalls, rectangleCalls, caretCalls, contributions };
}

test('legacy blame geometry retains textarea scrolling and bounds the number of mounted rows', () => {
  const editor = { lineHeight: 22, padding: 14, input: { scrollTop: 50 }, element: { clientHeight: 44 } };
  assert.equal(gitEditorView(editor), null);
  assert.equal(gitEditorCursorGeometry(editor), null);
  assert.equal(subscribeGitEditorView(editor, {}), null);
  assert.deepEqual(gitEditorVisibleLines(editor, 5), [
    { index: 1, top: -14, height: 22 }, { index: 2, top: 8, height: 22 },
    { index: 3, top: 30, height: 22 }, { index: 4, top: 52, height: 22 }
  ]);
  editor.element.clientHeight = 10000;
  assert.equal(gitEditorVisibleLines(editor).length, 160);
});

test('native blame follows visible logical rows across wrapping, folding and logical scroll scaling', () => {
  const value = nativeFixture([
    { line: 1, continuation: 0, top: 978 },
    { line: 2, continuation: 0, top: 989 },
    { line: 2, continuation: 1, top: 1011 },
    { line: 200, continuation: 0, top: 1033 },
    { line: 201, continuation: 0, top: 1066 }
  ]);
  assert.equal(gitEditorView(value.editor), value.editor.view);
  assert.deepEqual(gitEditorVisibleLines(value.editor, 250), [
    { index: 2, top: 9, height: 22 }, { index: 200, top: 53, height: 22 }
  ]);
  assert.deepEqual(value.layoutCalls, [[1000, 66, { overscan: 0, limit: 160 }]]);
  assert.deepEqual(gitEditorVisibleLines(value.editor, 200), [{ index: 2, top: 9, height: 22 }]);
  value.rows.splice(0, value.rows.length,
    { line: 2, continuation: 0, top: 978 }, { line: 2, continuation: 1, top: 1000 });
  assert.deepEqual(gitEditorVisibleLines(value.editor), [{ index: 2, top: 20, height: 22 }],
    'a visible wrapped continuation retains attribution when its first fragment is above the viewport');
});

test('native carets use editor coordinates once and omit folded source locations', () => {
  const value = nativeFixture();
  const geometry = gitEditorCursorGeometry(value.editor);
  assert.deepEqual({ left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height },
    { left: 76, top: 20, width: 600, height: 66 });
  assert.deepEqual(geometry.caret(-100), { x: 36, y: 26, height: 22 });
  assert.deepEqual(geometry.caret(10000), { x: 36, y: 26, height: 22 });
  assert.equal(geometry.caret(160), null);
  assert.deepEqual(value.caretCalls, [0, 1000], 'caret offsets are clamped without resolving a hidden folded line');
});

test('native selections use wrapped DOM-range fragments, clip offscreen rectangles and enforce the node budget', () => {
  // The native bidi API intentionally returns width/height rectangles without DOMRect.bottom.
  const first = { rectangles: [
    { left: 102, top: 78, width: 9, height: 22 }, { left: 101, top: 99, width: 7, height: 22 },
    { left: 110, top: 122, width: 20, height: 22 }, { left: 120, top: 166, width: 10, height: 22 }
  ] };
  const second = { rectangles: [{ left: 130, top: 144, width: 30, height: 22 }] };
  const value = nativeFixture([
    { line: 5, continuation: 0, top: 1000, record: { start: 100, sliceStart: 4 }, segment: { start: 0, end: 6 }, element: first },
    { line: 5, continuation: 1, top: 1022, record: { start: 100, sliceStart: 4 }, segment: { start: 6, end: 12 }, element: second },
    { line: 20, continuation: 0, top: 1044, record: { start: 400, sliceStart: 0 }, segment: { start: 0, end: 20 }, element: first }
  ]);
  const geometry = gitEditorCursorGeometry(value.editor);
  const expected = [
    { x: 5, y: -1, width: 7, height: 22 }, { x: 14, y: 22, width: 20, height: 22 },
    { x: 34, y: 44, width: 30, height: 22 }
  ];
  assert.deepEqual(geometry.selections(115, 105), expected);
  assert.deepEqual(value.rectangleCalls, [{ element: first, start: 1, end: 6 }, { element: second, start: 0, end: 5 }]);
  value.rectangleCalls.length = 0;
  assert.deepEqual(geometry.selections(105, 115, 2), expected.slice(0, 2));
  assert.deepEqual(value.rectangleCalls, [{ element: first, start: 1, end: 6 }]);
  value.rectangleCalls.length = 0;
  assert.deepEqual(geometry.selections(0, 1000, 0), []);
  assert.deepEqual(geometry.selections(105, 105), []);
  assert.equal(value.rectangleCalls.length, 0);
});

test('native view subscriptions retain editor callbacks and detach cleanly', () => {
  const value = nativeFixture();
  const originalCursor = value.editor.onCursor;
  const events = [];
  const unsubscribe = subscribeGitEditorView(value.editor, { render: () => events.push('render'), cursor: () => events.push('cursor') });
  for (const contribution of value.contributions) { contribution.render(); contribution.cursor(); }
  assert.deepEqual(events, ['render', 'cursor']);
  assert.equal(value.editor.onCursor, originalCursor);
  unsubscribe();
  unsubscribe();
  assert.equal(value.contributions.size, 0);
});

test('collaboration observes native logical cursor events rather than hidden textarea selection events', () => {
  const value = editorFixture();
  const native = nativeFixture();
  value.editor.view = native.editor.view;
  value.editor.registerContribution = native.editor.registerContribution;
  const binding = createStudioEditorCollaborationHost(value.workbench, value.editor, {}, { createCursors: () => value.cursors });
  const selections = [];
  binding.onSelectionChange(selection => selections.push(selection));
  binding.setSelection({ anchor: 4, focus: 1 });
  value.editor.input.dispatchEvent(new Event('select'));
  assert.deepEqual(selections, [], 'native logical selections are not inferred from the hidden textarea event surface');
  for (const contribution of native.contributions) contribution.cursor();
  assert.deepEqual(selections, [{ anchor: 4, focus: 1 }]);
  assert.equal(value.editor.onCursor, value.originalCursor);
  binding.dispose();
  assert.equal(native.contributions.size, 0);
  assert.equal(value.cursors.disposed, 1);
});
