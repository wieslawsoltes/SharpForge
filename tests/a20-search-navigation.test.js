import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceText, TextBuffer, findLiteralMatch, findLiteralMatchAsync, SearchLimitError} from '@sharpforge/text';
import {EditorModel} from '../packages/editor/src/model.js';
import {addNextOccurrence} from '../packages/editor/src/commands/multi-caret.js';

const options = {clock: () => 0};
const span = result => result.match && [result.match.start, result.match.end, result.wrapped];

test('single-match navigation reaches forward and backward origins beyond 10000 earlier matches', async () => {
  const source = new SourceText('x '.repeat(10004), 'many.cs', 7);
  assert.deepEqual(span(findLiteralMatch(source, 'x', {...options, origin: 20000, maxSteps: 8})), [20000, 20001, false]);
  assert.deepEqual(span(findLiteralMatch(source, 'x', {...options, origin: 20000, direction: -1, maxSteps: 8})), [19998, 19999, false]);
  const forward = await findLiteralMatchAsync(source, 'x', {...options, origin: source.length, maxSteps: 8});
  assert.deepEqual(span(forward), [0, 1, true]);
  assert.equal(forward.match.uri, 'many.cs');
  assert.equal(forward.match.version, 7);
  assert.deepEqual(span(await findLiteralMatchAsync(source, 'x', {...options, origin: 0, direction: -1, maxSteps: 8})), [20006, 20007, true]);
  assert.equal(findLiteralMatch(source, 'x', {...options, origin: source.length, wrap: false}).match, null);
  assert.equal(findLiteralMatch(source, 'x', {...options, origin: 0, direction: -1, wrap: false}).match, null);
});

test('navigation finds nearest overlapping matches and wrapped spans crossing the original origin', () => {
  for (const [text, query, origin, direction, expected] of [
    ['banana', 'ana', 2, 1, [3, 6, false]],
    ['banana', 'ana', 6, -1, [3, 6, false]],
    ['banana', 'ana', 5, -1, [1, 4, false]],
    ['abc', 'abc', 1, 1, [0, 3, true]],
    ['abc', 'abc', 2, -1, [0, 3, true]],
    ['aaaa', 'aa', 3, -1, [1, 3, false]],
    ['aaaa', 'aa', 1, -1, [2, 4, true]]
  ]) assert.deepEqual(span(findLiteralMatch(text, query, {...options, origin, direction})), expected);
});

test('scalar matches survive chunk seams and origins inside UTF-16 pairs in either direction', async () => {
  const text = 'x'.repeat(255) + '😀a' + 'x'.repeat(255);
  for (const direction of [1, -1]) {
    const origin = direction > 0 ? 0 : text.length;
    const settings = {...options, direction, origin, chunkSize: 256};
    assert.deepEqual(span(findLiteralMatch(text, '😀a', settings)), [255, 258, false]);
    assert.deepEqual(span(await findLiteralMatchAsync(text, '😀a', settings)), [255, 258, false]);
    assert.equal(findLiteralMatch(text, '😀a', {...settings, origin: 256, wrap: false}).match, null);
    assert.deepEqual(span(findLiteralMatch(text, '😀a', {...settings, origin: 256})), [255, 258, true]);
  }
});

test('navigation retains literal case folding, Unicode word boundaries and merged selection exclusions', () => {
  assert.equal(findLiteralMatch('K k', 'K', options).match.text, 'K');
  assert.equal(findLiteralMatch('K k', 'K', {...options, matchCase: true}).match, null);
  const text = 'scatter cat catfish cat';
  assert.deepEqual(span(findLiteralMatch(text, 'cat', {...options, wholeWord: true,
    excludeRanges: [{start: 9, end: 11}, {start: 8, end: 10}]})), [20, 23, false]);
  assert.deepEqual(span(findLiteralMatch(text, 'cat', {...options, wholeWord: true,
    excludeRanges: [{start: 9, end: 9}]})), [20, 23, false]);
  assert.deepEqual(span(findLiteralMatch(text, 'cat', {...options, direction: -1, wholeWord: true,
    excludeRanges: [{start: 20, end: 23}]})), [8, 11, false]);
  const unicode = '𐐀cat cat𐐀 cat';
  assert.equal(findLiteralMatch(unicode, 'cat', {...options, wholeWord: true}).match.start, unicode.lastIndexOf('cat'));
  assert.equal(findLiteralMatch(text, 'cat', {...options, excludeRanges: [{start: 0, end: text.length}]}).match, null);
});

test('a near-end origin in a virtual 200 MiB ASCII source requests only bounded nearby slices', async () => {
  const length = 200 * 1024 * 1024;
  const needle = 'needle';
  const position = length - 20;
  const reads = [];
  const source = {
    uri: 'large.cs', version: 4, length,
    get text() { throw new Error('Navigation must not flatten the source'); },
    getText(start, end) {
      reads.push({start, end});
      assert(end - start <= 257);
      const first = Math.max(start, position);
      const last = Math.min(end, position + needle.length);
      return first < last ? 'x'.repeat(first - start) + needle.slice(first - position, last - position) + 'x'.repeat(end - last)
        : 'x'.repeat(end - start);
    }
  };
  for (const direction of [1, -1]) {
    const origin = direction > 0 ? position - 7 : position + needle.length + 7;
    assert.deepEqual(span(await findLiteralMatchAsync(source, needle, {...options, origin, direction, chunkSize: 256, maxSteps: 64})),
      [position, position + needle.length, false]);
  }
  assert(reads.every(read => read.start > length - 512));
  assert(reads.reduce((sum, read) => sum + read.end - read.start, 0) < 4096);
});

test('cooperative navigation holds an immutable source snapshot while the original buffer changes', async t => {
  const buffer = new TextBuffer('x'.repeat(600) + 'needle', {uri: 'captured.cs'});
  t.after(() => buffer.dispose());
  let yields = 0;
  const result = await findLiteralMatchAsync(buffer, 'needle', {...options, chunkSize: 256, yieldControl: async () => {
    if (!yields++) buffer.applyEdits([{start: 0, end: 0, text: 'new'}]);
  }});
  assert.deepEqual(span(result), [600, 606, false]);
  assert.equal(result.match.version, 1);
  assert.equal(buffer.version, 2);
  assert(yields >= 2);
});

test('step and elapsed limits fail explicitly before an incomplete scan could report wrapping or no match', async () => {
  assert.throws(() => findLiteralMatch('abcdef', 'missing', {...options, origin: 3, maxSteps: 3}),
    error => error instanceof SearchLimitError && error.reason === 'step');
  let now = 0;
  await assert.rejects(findLiteralMatchAsync('x'.repeat(600), 'missing', {
    chunkSize: 256, timeLimitMs: 1, clock: () => now, yieldControl: async () => { now = 2; }
  }), error => error instanceof SearchLimitError && error.reason === 'time');
});

test('navigation honors cancellation before scanning and between cooperative chunks', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(() => findLiteralMatch('text', 't', {...options, signal: cancelled.signal}), {name: 'AbortError'});
  await assert.rejects(findLiteralMatchAsync('text', 't', {...options, signal: cancelled.signal}), {name: 'AbortError'});
  const controller = new AbortController();
  let yields = 0;
  await assert.rejects(findLiteralMatchAsync('x'.repeat(600), 'missing', {...options, chunkSize: 256,
    signal: controller.signal, yieldControl: async () => { yields++; controller.abort(); }
  }), {name: 'AbortError'});
  assert.equal(yields, 1);
});

test('navigation rejects invalid bounds and oversized exclusions without reading unbounded source text', () => {
  for (const settings of [
    {origin: -1}, {origin: 5}, {origin: 1.5}, {direction: 0}, {wrap: 'yes'}, {chunkSize: 0},
    {excludeRanges: [{start: 0, end: 5}]}, {excludeRanges: Array.from({length: 10001}, () => ({start: 0, end: 1}))}
  ]) assert.throws(() => findLiteralMatch('text', 't', {...options, ...settings}));
  assert.throws(() => findLiteralMatch('text', 'x'.repeat(1025), options), /1024/);
  assert.deepEqual(findLiteralMatch('text', '', options), {match: null, wrapped: false});
});

test('Add Next Occurrence advances after the primary range beyond 10000 matches and wraps around selected ranges', t => {
  const model = new EditorModel('x '.repeat(10002));
  t.after(() => model.dispose());
  model.setSelections([{anchor: 20000, active: 20001}]);
  addNextOccurrence(model, {...options, maxSteps: 8});
  assert.deepEqual(model.selections.map(({start, end}) => [start, end]), [[20000, 20001], [20002, 20003]]);
  assert.equal(model.primarySelection.start, 20002);
  addNextOccurrence(model, {...options, maxSteps: 8});
  assert.deepEqual(model.selections.map(({start, end}) => [start, end]), [[0, 1], [20000, 20001], [20002, 20003]]);
  assert.equal(model.primarySelection.start, 0);
  assert.equal(model.undoStack.depth, 0);
});

test('Add Next Occurrence skips existing ranges and preserves the explicit 10000-selection capacity', t => {
  const model = new EditorModel('x '.repeat(10001));
  t.after(() => model.dispose());
  model.setSelections([{anchor: 0, active: 1}, {anchor: 2, active: 3}], {primaryIndex: 0});
  addNextOccurrence(model, options);
  assert.equal(model.primarySelection.start, 4);
  model.setSelections(Array.from({length: 10000}, (_, index) => ({anchor: index * 2, active: index * 2 + 1})), {primaryIndex: 9999});
  const previous = model.selections;
  assert.throws(() => addNextOccurrence(model, options), /Selection limit/);
  assert.equal(model.selections, previous);
  assert.equal(model.selections.length, 10000);
  assert.equal(model.undoStack.depth, 0);
});

test('Add Next Occurrence excludes a candidate containing an existing empty caret', t => {
  const model = new EditorModel('cat cat cat');
  t.after(() => model.dispose());
  model.setSelections([{anchor: 0, active: 3}, {anchor: 5, active: 5}], {primaryIndex: 0});
  addNextOccurrence(model, options);
  assert.deepEqual(model.selections.map(({start, end}) => [start, end]), [[0, 3], [5, 5], [8, 11]]);
  assert.equal(model.primarySelection.start, 8);
});
