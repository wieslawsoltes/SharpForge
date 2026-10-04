import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { PieceTable, SourceText, TextBuffer, LineIndex, TextVersionError, decodeText, encodeText } from '@sharpforge/text';

function random(seed) {
  return maximum => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return maximum ? seed % maximum : 0;
  };
}

function referencePosition(text, offset) { return new SourceText(text).positionAt(offset); }

test('piece table: 100000 deterministic mixed-EOL/UTF-16 edits match a string oracle', () => {
  const next = random(0x7132ab09);
  const table = new PieceTable('original\r\n😀\rline\n');
  let oracle = table.getText();
  const inserts = ['', 'a', '\r', '\n', '\r\n', '😀', 'e\u0301', '\ud800', '\udc00', 'tail'];
  const retained = [];
  for (let operation = 0; operation < 100000; operation++) {
    if (operation % 10000 === 0) retained.push({ snapshot: table.snapshot(), text: oracle });
    const start = next(oracle.length + 1);
    const count = next(Math.min(12, oracle.length - start) + 1);
    const inserted = inserts[next(inserts.length)];
    table.replace(start, count, inserted);
    oracle = oracle.slice(0, start) + inserted + oracle.slice(start + count);
    assert.equal(table.getText(), oracle, `operation ${operation}`);
    if (operation % 19 !== 0) continue;
    const source = new SourceText(oracle);
    assert.deepEqual(table.snapshot().lineStarts, source.lineStarts);
    for (const offset of [0, start, oracle.length, next(oracle.length + 1)]) {
      assert.deepEqual(table.positionAt(offset), source.positionAt(offset), `position at ${operation}/${offset}`);
    }
    const sliceStart = next(oracle.length + 1);
    const sliceEnd = sliceStart + next(oracle.length - sliceStart + 1);
    assert.equal(table.substring(sliceStart, sliceEnd), oracle.substring(sliceStart, sliceEnd));
  }
  for (const item of retained) assert.equal(item.snapshot.getText(), item.text);
  assert.ok(table.statistics.height <= 2 * Math.log2(table.statistics.pieces + 1) + 1);
});

test('piece table: reading a 100 MB buffer boundary materializes only the requested slice', () => {
  const length = 100 * 1024 * 1024;
  const table = new PieceTable('x'.repeat(length - 4) + '\r\n😀');
  const snapshot = table.snapshot();
  assert.equal(snapshot.statistics.textMaterialized, false);
  assert.equal(table.substring(length - 8, length), 'xxxx\r\n😀');
  assert.equal(snapshot.statistics.textMaterialized, false);
  assert.equal(snapshot.statistics.pieces, 1);
  table.insert(0, 'head');
  table.delete(table.length - 2, 2);
  assert.equal(snapshot.length, length);
  assert.equal(snapshot.substring(length - 4), '\r\n😀');
  assert.equal(table.substring(0, 8), 'headxxxx');
  assert.equal(table.substring(table.length - 2), '\r\n');
  assert.equal(snapshot.statistics.textMaterialized, false);
});

test('line index: CRLF seams, CR/LF splits and all coordinate boundaries remain exact', () => {
  const index = new LineIndex('a\rb\nc\r\nd');
  index.applyChange(2, 0, '\n');
  const text = 'a\r\nb\nc\r\nd';
  assert.deepEqual(index.lineStarts, new SourceText(text).lineStarts);
  for (let offset = 0; offset <= text.length; offset++) assert.deepEqual(index.positionAt(offset), referencePosition(text, offset));
  assert.equal(index.offsetAt({ line: 0, character: 999 }), 1);
  assert.equal(index.offsetAt({ line: 999, character: 999 }), text.length);
  assert.equal(index.offsetAt({ line: -1, character: -1 }), 0);
  assert.throws(() => index.applyChange(-1, 0, 'x'), RangeError);
  assert.throws(() => index.applyChange(0, -1, 'x'), RangeError);
});

test('text buffer: multi-edits are one immutable version with inverse coordinates and exact ranges', () => {
  const buffer = new TextBuffer('a\r\nb\nc', { uri: 'file.cs', version: 10 });
  const before = buffer.snapshot();
  const events = [];
  const stop = buffer.onDidChange(event => events.push(event));
  const event = buffer.applyEdits([{ start: 0, end: 1, text: 'AA' }, { start: 5, deleteCount: 1, text: 'CCC' }]);
  assert.equal(buffer.getText(), 'AA\r\nb\nCCC');
  assert.equal(buffer.version, 11);
  assert.equal(before.text, 'a\r\nb\nc');
  assert.equal(events.length, 1);
  assert.deepEqual(event.changes[1].range, { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } });
  assert.deepEqual(event.inverseEdits.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 0, end: 2, text: 'a' }, { start: 6, end: 9, text: 'c' }
  ]);
  buffer.applyEdits(event.inverseEdits);
  assert.equal(buffer.getText(), before.text);
  stop();
  buffer.insert(0, '');
  assert.equal(events.length, 2);
  assert.equal(buffer.version, 12);
});

test('text buffer: prepare/commit is atomic; overlap, stale versions and disposed changes fail explicitly', () => {
  const buffer = new TextBuffer('abcdef');
  assert.throws(() => buffer.applyEdits([{ start: 0, end: 3, text: '' }, { start: 2, end: 4, text: '' }]), /overlap/);
  assert.equal(buffer.text, 'abcdef');
  const prepared = buffer.prepareEdits([{ start: 1, end: 2, text: 'X' }]);
  assert.equal(buffer.text, 'abcdef');
  const checkpoint = buffer.checkpoint();
  buffer.commitPrepared(prepared, { notify: false });
  assert.equal(buffer.text, 'aXcdef');
  buffer.restoreCheckpoint(checkpoint);
  assert.equal(buffer.text, 'abcdef');
  buffer.insert(0, '!');
  assert.throws(() => buffer.commitPrepared(prepared), TextVersionError);
  assert.throws(() => buffer.applyEdits([], { expectedVersion: 1 }), TextVersionError);
  buffer.dispose();
  assert.throws(() => buffer.insert(0, 'x'), /disposed/);
});

test('text buffer: indexed EOL metadata and UTF encodings preserve BOM, mixed endings and final newline', () => {
  const buffer = new TextBuffer('a\r\nb\r\nc\n', { encoding: 'utf-16le', bom: true });
  assert.equal(buffer.metadata.dominantEol, '\r\n');
  assert.equal(buffer.metadata.mixedEol, true);
  buffer.insert(1, '\nnew', { normalizeLineEndings: true });
  assert.equal(buffer.getLine(0), 'a');
  assert.equal(buffer.getLine(1), 'new');
  const oldContent = buffer.text.replace(/[\r\n]/g, '');
  buffer.convertEol('\n');
  assert.equal(buffer.text.replace(/[\r\n]/g, ''), oldContent);
  assert.equal(buffer.metadata.mixedEol, false);
  assert.equal(buffer.metadata.finalNewline, true);
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be']) {
    const result = decodeText(encodeText(buffer.text, { encoding, bom: true }));
    assert.equal(result.text, buffer.text);
    assert.equal(result.encoding, encoding);
    assert.equal(result.bom, true);
  }
  assert.throws(() => encodeText('abc', { encoding: 'latin1' }), /Unsupported/);
});

test('text buffer: start/middle/end edits in one million lines remain indexed and below a 2 ms p95 budget', t => {
  const buffer = new TextBuffer('line\r\n'.repeat(1000000));
  const measurements = [];
  for (const region of ['start', 'middle', 'end']) {
    const values = [];
    for (let iteration = 0; iteration < 120; iteration++) {
      const offset = region === 'start' ? 0 : region === 'middle' ? Math.floor(buffer.length / 2) : buffer.length;
      const started = performance.now();
      buffer.insert(offset, 'x');
      const elapsed = performance.now() - started;
      buffer.delete(offset, 1);
      if (iteration >= 20) values.push(elapsed);
    }
    values.sort((first, second) => first - second);
    const median = values[50];
    const p95 = values[95];
    measurements.push({ region, median, p95 });
    assert.ok(p95 < 2, `${region}: p95 ${p95.toFixed(3)} ms exceeds 2 ms`);
  }
  assert.equal(buffer.lineCount, 1000001);
  assert.equal(buffer.snapshot().statistics.textMaterialized, false);
  t.diagnostic(JSON.stringify(measurements));
});
