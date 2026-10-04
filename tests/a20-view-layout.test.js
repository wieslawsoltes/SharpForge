import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorModel, LineLayout, VisualLineMap, DocumentLayout, FoldingModel, wrapLine, whitespaceMarkers, overviewMarks} from '@sharpforge/editor';

test('A20 line layout round trips grapheme offsets, tabs, CJK and emoji', () => {
  const service = new LineLayout({tabSize: 4});
  for (const text of ['abc xyz', 'a\t中😀z', 'e\u0301 👩‍💻 🇵🇱', '\t\tZ']) {
    const line = service.line(text, 1);
    for (let index = 0; index < line.offsets.length; index++) {
      assert.equal(service.offsetAt(line, service.xAt(line, line.offsets[index])), line.offsets[index]);
    }
    assert.equal(service.line(text, 1), line);
  }
  assert.throws(() => service.configure({tabSize: 0}), RangeError);
  service.configure({charWidth: 10});
  assert.equal(service.line('abcd').width, 40);
  service.dispose();
  assert.equal(service.cache.size, 0);
});

test('A20 visual line map handles 500000 lines with wraps, hidden intervals and inverse lookup', () => {
  const map = new VisualLineMap(500000);
  map.set(100, 4);
  map.set(101, 0);
  map.set(499999, 2);
  assert.equal(map.rowCount, 500003);
  assert.deepEqual(map.lineAt(103), {line: 100, continuation: 3});
  assert.deepEqual(map.lineAt(104), {line: 102, continuation: 0});
  assert.equal(map.rowAt(499999), 500001);
  assert.deepEqual(map.lineAt(500002), {line: 499999, continuation: 1});
  assert.throws(() => map.set(-1, 2), RangeError);
  assert.throws(() => new VisualLineMap(0), RangeError);
});

test('A20 wrap covers source without splitting extended graphemes', () => {
  const metrics = new LineLayout();
  const text = '    abc 中👩‍💻 hello there';
  const line = metrics.line(text);
  const segments = wrapLine(line, 70, {indent: 20});
  assert(segments.length > 1);
  assert.equal(segments.map(segment => text.slice(segment.start, segment.end)).join(''), text);
  for (const segment of segments) {
    assert(line.offsets.includes(segment.start));
    assert(line.offsets.includes(segment.end));
  }
  assert.equal(segments[1].indent, 20);
  assert.throws(() => wrapLine(line, 0), RangeError);
});

test('A20 viewport bounds materialized rows and folds preserve logical line numbering', () => {
  const model = new EditorModel('line\n'.repeat(500000), {uri: 'large.cs'});
  const editor = {model, folding: new FoldingModel(), options: {wordWrap: false, maxRenderedLineCharacters: 16384},
    largeFile: {active: true}, viewZones: new Map(), padding: 14, view: {viewport: {scrollLeft: 0}}};
  const layout = new DocumentLayout(editor, new LineLayout());
  const rows = layout.rows(499900 * 22, 800);
  assert(rows.length < 160);
  assert(rows[0].line > 499800);
  assert.equal(rows[0].record.text, 'line');
  editor.folding.setRanges([{startLine: 100, endLine: 200, collapsed: true}], model.lineCount);
  layout.applyFolding();
  assert.equal(layout.map.lineAt(layout.map.rowAt(100) + 1).line, 201);
  editor.folding.reveal(150);
  layout.applyFolding();
  assert.equal(layout.map.lineAt(layout.map.rowAt(100) + 1).line, 101);
  layout.dispose();
  model.dispose();
});

test('A20 whitespace changes only decoration data and overview endpoints are exact', () => {
  const text = ' \ta';
  const layout = new LineLayout().line(text);
  const markers = whitespaceMarkers(text, layout, {enabled: true, eol: '\r\n'});
  assert.deepEqual(markers.map(marker => marker.kind), ['space', 'tab', 'eol']);
  assert.equal(layout.text, text);
  assert.deepEqual(whitespaceMarkers(text, layout), []);
  const marks = overviewMarks(10000, 500, [{line: 0, kind: 'error'}, {line: 9999, kind: 'bookmark'}, {line: -1, kind: 'error'}]);
  assert.equal(marks[0].y, 0);
  assert.equal(marks[1].y, 499);
  assert.throws(() => overviewMarks(0, 500, []), RangeError);
});

test('A20 leading and inline zones retain row mapping through repeated layout resets', () => {
  const model = new EditorModel('a\nb\nc');
  const editor = {model, folding: new FoldingModel(), options: {wordWrap: false, maxRenderedLineCharacters: 16384},
    largeFile: {active: false}, viewZones: new Map([['lens', [{afterLine: -1, height: 22}, {afterLine: 0, height: 44}]]]),
    padding: 14, view: {viewport: {scrollLeft: 0}}};
  const layout = new DocumentLayout(editor, new LineLayout());
  for (let count = 0; count < 3; count++) {
    layout.reset();
    assert.equal(layout.leadingRows, 1);
    assert.equal(layout.map.rowCount, 5);
    assert.equal(layout.position(2).row, 4);
    assert.deepEqual(layout.rows(0, 400).map(row => row.line), [0, 1, 2]);
  }
  editor.viewZones.clear();
  layout.applyZones();
  assert.equal(layout.position(2).row, 1);
  assert.equal(layout.map.rowCount, 3);
  layout.dispose();
});

test('A20 long-line fragments clamp stale horizontal scroll and use bounded text reads', () => {
  const model = new EditorModel('a'.repeat(100000));
  const editor = {model, folding: new FoldingModel(), options: {wordWrap: false, maxRenderedLineCharacters: 1024},
    largeFile: {active: true}, viewZones: new Map(), padding: 14, view: {viewport: {scrollLeft: 999999999}}};
  const layout = new DocumentLayout(editor, new LineLayout());
  const line = layout.line(0);
  assert.equal(line.text.length, 1024);
  assert.equal(line.sliceStart + line.text.length, 100000);
  layout.dispose();
});
