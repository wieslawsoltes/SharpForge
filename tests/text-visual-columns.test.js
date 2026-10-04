import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TextBuffer, VisualColumnIndex, GraphemeSegmenter, graphemeSegments, visualColumnAt, unicodeGraphemeVersion } from '@sharpforge/text';
import { EditorModel } from '../packages/editor/src/model.js';

async function referenceCases() {
  const source = await readFile(new URL('./fixtures/unicode-16.0.0/GraphemeBreakTest.txt', import.meta.url), 'utf8');
  const cases = [];
  for (const raw of source.split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    let text = '';
    const boundaries = [];
    for (const token of line.split(/\s+/)) {
      if (token === '÷') boundaries.push(text.length);
      else if (token !== '×') text += String.fromCodePoint(parseInt(token, 16));
    }
    cases.push({ text, boundaries, source: line });
  }
  return cases;
}

function guardedSource(buffer) {
  const observed = { maxRead: 0, reads: 0 };
  const snapshots = new WeakMap();
  return {
    observed,
    onDidChange(listener) {
      return buffer.onDidChange(event => listener({ ...event, before: wrap(event.before), after: wrap(event.after) }));
    },
    snapshot() { return wrap(buffer.snapshot()); }
  };
  function wrap(snapshot) {
    if (snapshots.has(snapshot)) return snapshots.get(snapshot);
    const guarded = {
      get text() { throw new Error('Visual columns must not flatten the document'); },
      length: snapshot.length, version: snapshot.version,
      positionAt: offset => snapshot.positionAt(offset), lineStart: line => snapshot.lineStart(line), lineEnd: line => snapshot.lineEnd(line),
      charCodeAt: offset => snapshot.charCodeAt(offset),
      getText(start, end) {
        assert.ok(end - start <= 16385, 'Every read must stay within the maximum chunk plus a split surrogate');
        observed.maxRead = Math.max(observed.maxRead, end - start);
        observed.reads++;
        return snapshot.getText(start, end);
      }
    };
    snapshots.set(snapshot, guarded);
    return guarded;
  }
}

function expectedColumn(buffer, offset, options) {
  const position = buffer.positionAt(offset);
  return visualColumnAt(buffer.getLine(position.line), position.character, options);
}

function blockedScheduler() {
  const pending = [];
  return { schedule: () => new Promise(resolve => pending.push(resolve)), release() { for (const resolve of pending.splice(0)) resolve(); } };
}

test('pinned segmentation passes every Unicode 16.0 extended-grapheme conformance row', async () => {
  assert.equal(unicodeGraphemeVersion, '16.0.0');
  const cases = await referenceCases();
  assert.ok(cases.length > 1000);
  for (const fixture of cases) {
    assert.deepEqual([0, ...graphemeSegments(fixture.text).map(item => item.end)], fixture.boundaries, fixture.source);
  }
});

test('default and explicit native segmentation retain Unicode 16.0 host compatibility', {
  skip: process.versions.unicode !== '16.0' ? 'The native comparison is pinned to a Unicode 16.0 Intl runtime' : false
}, async () => {
  const native = new GraphemeSegmenter({ segmenter: new Intl.Segmenter('und', { granularity: 'grapheme' }) });
  for (const fixture of await referenceCases()) {
    assert.deepEqual(graphemeSegments(fixture.text), [...native.segments(fixture.text)], fixture.source);
  }
});

test('existing editor grapheme fixtures agree with the actual host Intl segmenter', () => {
  const native = new GraphemeSegmenter({ segmenter: new Intl.Segmenter('und', { granularity: 'grapheme' }) });
  for (const text of ['a\u0301b', '👩‍👩‍👧‍👦!', '🇵🇱🇯🇵x', '👍🏽👍', '\r\nX', '각각', 'क्\u200dष', 'a\t界😀e\u0301\ud800']) {
    assert.deepEqual(graphemeSegments(text), [...native.segments(text)], `Host Unicode ${process.versions.unicode}: ${JSON.stringify(text)}`);
  }
});

test('chunked columns agree at every UTF-16 position, including split graphemes, pairs, tabs and CRLF', async () => {
  const text = '\u0600a\t界😀e\u0301👩‍👩‍👧‍👦🇵🇱🇯🇵क्\u200dष각\ud800a\udc00\r\n\u0301\u200dZ\nEND';
  for (const chunkSize of [1, 3, 7]) for (const tabSize of [1, 4, 8]) for (const ambiguousWidth of [1, 2]) {
    const buffer = new TextBuffer(text);
    const source = guardedSource(buffer);
    const index = new VisualColumnIndex(source, { chunkSize, checkpointInterval: 2 });
    for (let offset = 0; offset <= text.length; offset++) {
      const options = { tabSize, ambiguousWidth };
      assert.equal(await index.get(offset, options), expectedColumn(buffer, offset, options), `${chunkSize}/${tabSize}/${offset}`);
      assert.equal(index.getCached(offset, options), expectedColumn(buffer, offset, options));
    }
    assert.ok(source.observed.maxRead <= chunkSize + 1);
    index.dispose();
  }
});

test('a 200 MiB single line yields, stays chunk bounded, and supports exact subsequent cached lookups', async () => {
  const length = 200 * 1024 * 1024;
  const suffix = '\t界e\u0301';
  const prefix = length - suffix.length;
  const buffer = new TextBuffer('a'.repeat(prefix) + suffix);
  const source = guardedSource(buffer);
  const index = new VisualColumnIndex(source, { schedule: () => new Promise(resolve => setImmediate(resolve)) });
  assert.equal(index.getCached(length), null);
  const result = await index.get(length);
  assert.equal(result, prefix + (4 - prefix % 4) + 3);
  assert.ok(index.statistics.yields > 100);
  assert.ok(index.statistics.checkpoints <= index.options.maxCheckpoints);
  assert.ok(source.observed.maxRead <= 4097);
  assert.equal(buffer.statistics.textMaterialized, false);
  const before = index.statistics.scannedCodeUnits;
  assert.equal(index.getCached(length), result);
  assert.equal(index.statistics.scannedCodeUnits, before);
  assert.equal(await index.get(prefix - 1), prefix - 1);
  assert.ok(index.statistics.scannedCodeUnits - before <= 8192);
  assert.equal(buffer.statistics.textMaterialized, false);
  index.dispose();
});

test('an unfinished multi-megabyte combining cluster retains only numeric state across chunks', async () => {
  const marks = 2 * 1024 * 1024;
  const buffer = new TextBuffer('e' + '\u0301'.repeat(marks) + '\tZ');
  const source = guardedSource(buffer);
  const index = new VisualColumnIndex(source, { schedule: () => new Promise(resolve => setImmediate(resolve)) });
  assert.equal(await index.get(marks / 2), 0);
  assert.equal(await index.get(marks + 1), 1);
  assert.equal(await index.get(buffer.length), 5);
  assert.ok(source.observed.maxRead <= 4097);
  assert.equal(buffer.statistics.textMaterialized, false);
  index.dispose();
});

test('edits reuse the indexed prefix and invalidate changed answers, including surrogate and combining seams', async () => {
  const buffer = new TextBuffer('a'.repeat(1024 * 1024) + '\t界😀');
  const index = new VisualColumnIndex(buffer, { schedule: () => Promise.resolve() });
  const end = buffer.length;
  const beforeColumn = await index.get(end);
  const before = index.statistics.scannedCodeUnits;
  buffer.applyEdits([{ start: end, end, text: '\u0301Z' }]);
  assert.equal(await index.get(end), beforeColumn - 2, 'The caret is now inside the extended emoji cluster');
  assert.equal(await index.get(buffer.length), beforeColumn + 1);
  assert.ok(index.statistics.scannedCodeUnits - before <= 32768, 'Appending must reuse the megabyte prefix');
  buffer.applyEdits([{ start: end - 1, end, text: 'X' }]);
  for (let offset = end - 2; offset <= buffer.length; offset++) assert.equal(await index.get(offset), expectedColumn(buffer, offset));
  index.dispose();
});

test('unaffected line checkpoints relocate across earlier edits and joined or split lines never reuse wrong columns', async () => {
  const buffer = new TextBuffer('first\r\n' + 'a\t界'.repeat(200) + '\r\nlast');
  const index = new VisualColumnIndex(buffer, { checkpointInterval: 8, chunkSize: 4 });
  let offset = buffer.lineEnd(1);
  const expected = await index.get(offset);
  const before = index.statistics.scannedCodeUnits;
  buffer.applyEdits([{ start: 2, end: 2, text: '\n\t' }]);
  offset += 2;
  assert.equal(index.getCached(offset), expected);
  assert.equal(index.statistics.scannedCodeUnits, before);
  buffer.applyEdits([{ start: 5, end: 10, text: 'X' }]);
  for (const position of [0, 5, 10, buffer.length - 4, buffer.length]) {
    assert.equal(await index.get(position), expectedColumn(buffer, position));
  }
  index.dispose();
});

test('model columns survive undo/redo, invalidate silent rollback, and retain shared read-only behavior', async () => {
  const model = new EditorModel('a\t界e\u0301', { visualColumns: { chunkSize: 2, checkpointInterval: 2 } });
  assert.equal(await model.visualColumnAtOffset(model.length), 7);
  const checkpoint = model.checkpoint();
  model.applyEdits([{ start: 0, end: 1, text: 'AAAA' }]);
  assert.equal(await model.visualColumnAtOffset(model.length), 11);
  assert.equal(model.undo(), true);
  assert.equal(await model.visualColumnAtOffset(model.length), 7);
  assert.equal(model.redo(), true);
  assert.equal(await model.visualColumnAtOffset(model.length), 11);
  model.restoreCheckpoint(checkpoint);
  assert.equal(await model.visualColumnAtOffset(model.length), 7);
  model.setReadOnly(true);
  assert.equal(await model.visualColumnAtOffset(model.length), 7);
  assert.throws(() => model.applyEdits([{ start: 0, end: 0, text: 'x' }]), { code: 'SFEDITOR_READ_ONLY' });
  model.dispose();
  await assert.rejects(model.visualColumnAtOffset(0), { code: 'VISUAL_COLUMN_DISPOSED' });
});

test('cancel, stale text and disposal reject promptly and release pending work', async () => {
  for (const reason of ['cancel', 'edit', 'dispose']) {
    const buffer = new TextBuffer('a'.repeat(100));
    const scheduler = blockedScheduler();
    const index = new VisualColumnIndex(buffer, { chunkSize: 2, yieldAfterUnits: 4, schedule: scheduler.schedule });
    const controller = new AbortController();
    const pending = index.get(buffer.length, { signal: controller.signal });
    if (reason === 'cancel') controller.abort();
    if (reason === 'edit') buffer.applyEdits([{ start: 0, end: 0, text: '\t' }]);
    if (reason === 'dispose') index.dispose();
    const code = { cancel: 'VISUAL_COLUMN_CANCELLED', edit: 'TEXT_VERSION_MISMATCH', dispose: 'VISUAL_COLUMN_DISPOSED' }[reason];
    await assert.rejects(pending, { code });
    scheduler.release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(index.statistics.pending, 0);
    index.dispose();
  }
});

test('checkpoint, result, line and pending budgets are enforced without a document-length cutoff', async () => {
  const buffer = new TextBuffer('abc\t'.repeat(1000) + '\n' + 'z'.repeat(100));
  const index = new VisualColumnIndex(buffer, { maxCheckpoints: 2, maxLines: 2, maxResults: 2, checkpointInterval: 2, chunkSize: 3 });
  assert.equal(await index.get(buffer.length), 100);
  assert.equal(await index.get(buffer.lineEnd(0)), 4000);
  assert.ok(index.statistics.checkpoints <= 2);
  assert.ok(index.statistics.lines <= 2);
  assert.equal(await index.get(3), 3);
  index.dispose();
  const scheduler = blockedScheduler();
  const limited = new VisualColumnIndex(buffer, { maxPending: 1, chunkSize: 2, yieldAfterUnits: 2, schedule: scheduler.schedule });
  const first = limited.get(100);
  await assert.rejects(limited.get(200), { code: 'VISUAL_COLUMN_LIMIT' });
  limited.dispose();
  await assert.rejects(first, { code: 'VISUAL_COLUMN_DISPOSED' });
  scheduler.release();
  for (const options of [{ chunkSize: 0 }, { maxCheckpoints: -1 }, { yieldAfterMs: 17 }]) {
    assert.throws(() => new VisualColumnIndex(buffer, options), RangeError);
  }
  const valid = new VisualColumnIndex(buffer);
  for (const offset of [-1, buffer.length + 1, NaN, 1.5]) await assert.rejects(valid.get(offset), RangeError);
  await assert.rejects(valid.get(1, { tabSize: 0 }), RangeError);
  valid.dispose();
});
