import test from 'node:test';
import assert from 'node:assert/strict';
import {findTextMatches} from '@sharpforge/text';
import {cooperativeLiteralSearch, workerRegexSearch} from '../packages/editor/src/features/cooperative-search.js';

test('chunk boundaries preserve the shared matcher nonoverlap, case-fold and word-boundary semantics', async () => {
  for (const [text, query, wholeWord] of [
    ['a'.repeat(4000), 'aaa', false],
    [('abc value VALUE food\r\n').repeat(100), 'value', true],
    [('😀x😀x\r\nA\rB\n').repeat(100), '😀x', false],
    ['a'.repeat(254) + 'marker tail\n' + 'a'.repeat(600), 'marker', true],
    [('a'.repeat(251) + ' value! ').repeat(10), 'value', true]
  ]) {
    const document = {uri: 'a', version: 3, text};
    const expected = findTextMatches([document], query, {wholeWord, maxMatches: 10_000, timeLimitMs: 1000});
    let yields = 0;
    const result = await cooperativeLiteralSearch([document], query, {wholeWord, chunkSize: 256,
      yieldControl: async () => { yields++; }});
    assert.deepEqual(result.matches.map(({start, end, line, character}) => ({start, end, line, character})),
      expected.matches.map(({start, end, line, character}) => ({start, end, line, character})));
    assert.equal(result.truncated, expected.truncated);
    assert(yields > 0);
  }
});

test('cooperative search is cancellable between slices and reports progress without publishing partial success', async () => {
  const controller = new AbortController();
  const progress = [];
  const result = cooperativeLiteralSearch([{uri: 'a', text: 'line\n'.repeat(50_000), version: 1}], 'tail', {
    signal: controller.signal, chunkSize: 1024, onProgress: value => progress.push(value),
    yieldControl: async () => { if (progress.length === 3) controller.abort(); }
  });
  await assert.rejects(result, {name: 'AbortError'});
  assert.equal(progress.length, 3);
  assert(progress[2].processed < progress[2].total);
  await assert.rejects(cooperativeLiteralSearch([], 'value', {chunkSize: 1}), /chunk size/);
});

test('persistent snapshots are read in bounded slices without materializing document text', async () => {
  const text = 'line\r\n'.repeat(20_000) + 'needle';
  let largestRead = 0;
  const snapshot = {uri: 'a', version: 5, length: text.length,
    get text() { throw new Error('Whole-document materialization is prohibited'); },
    getText(start, end) { largestRead = Math.max(largestRead, end - start); return text.slice(start, end); }};
  const result = await cooperativeLiteralSearch([snapshot], 'needle', {chunkSize: 1024, yieldControl: async () => {}});
  assert.equal(result.matches[0].start, text.length - 6);
  assert.equal(result.matches[0].line, 20_000);
  assert(largestRead <= 1025);
});

test('global match limits remain exact when each chunk contains rejected whole-word matches', async () => {
  const document = {uri: 'a', version: 1, text: 'a'.repeat(40_000) + ' a a a '};
  const result = await cooperativeLiteralSearch([document], 'a', {wholeWord: true, maxMatches: 2, chunkSize: 32_768,
    yieldControl: async () => {}});
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].start, 40_001);
  assert.equal(result.truncated, true);
});

test('regex worker receives bounded chunks and cancellation terminates its isolated computation', async () => {
  const workers = [];
  class FakeWorker {
    constructor() { this.documents = []; this.terminated = false; workers.push(this); }
    postMessage(message) {
      if (message.type === 'document') this.documents.push({...message, text: ''});
      if (message.type === 'chunk') {
        assert(message.text.length <= 65_536);
        this.documents.at(-1).text += message.text;
      }
      if (message.type === 'search') queueMicrotask(() => this.onmessage({data: {
        result: findTextMatches(this.documents, message.query, {...message.options, timeLimitMs: 1000})
      }}));
    }
    terminate() { this.terminated = true; }
  }
  const result = await workerRegexSearch([{uri: 'a', version: 1, text: 'value=123'}], '(\\w+)=(\\d+)', {workerFactory: () => new FakeWorker()});
  assert.equal(result.matches[0].captures[1], '123');
  assert.equal(result.backend, 'worker-safe-regex');
  assert.equal(workers[0].terminated, true);
  const controller = new AbortController();
  const pending = workerRegexSearch([{uri: 'a', version: 1, text: 'x'.repeat(200_000)}], 'x+', {
    signal: controller.signal, workerFactory: () => new FakeWorker(), onProgress: () => controller.abort()
  });
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(workers[1].terminated, true);
});
