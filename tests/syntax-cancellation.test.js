import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceText, BoundedCache } from '@sharpforge/text';
import { SyntaxTree, lex, parse, CancellationToken, OperationCanceledError, cancellationInterval } from '@sharpforge/syntax';
import { benchmarkDocument } from '../packages/syntax/bench/incremental.bench.js';
import { greenDifference } from './support/syntax-edits.js';

// SF-A01-T12.3: cancellation is threaded through the scanner and the parser. Cancelling mid-parse of a 5 MB file throws
// OperationCanceledError within 20 ms, and the caches stay consistent.
const large = benchmarkDocument(5_000_000);
test('cancellation: a 5 MB parse polls its token at least every 20 ms and is abandoned in the scanner and in the parser', () => {
  assert(large.length >= 5_000_000);
  // The time between two polls bounds how long a cancellation request can go unnoticed. The test files run in parallel, so a
  // single stretch can be inflated by preemption or a garbage collection; the bound is asserted on the 99.9th percentile
  // of the stretches of the best of up to four runs (on an idle machine the longest stretch itself is about 10 ms).
  const clock = () => performance.now();
  let worst = Infinity,
    polls = 0,
    lexPolls = 0;
  for (let run = 0; run < 4 && worst >= 20; run++) {
    let last = clock();
    const gaps = [],
      token = new CancellationToken({
        poll: () => {
          const now = clock();
          gaps.push(now - last);
          last = now;
          return false;
        }
      });
    const tree = SyntaxTree.parseText(large, { cancellationToken: token });
    gaps.push(clock() - last);
    assert.equal(tree.green.fullWidth, large.length);
    gaps.sort((a, b) => a - b);
    worst = Math.min(worst, gaps[Math.floor(gaps.length * 0.999)]);
    polls = gaps.length - 1;
  }
  assert(worst < 20, `the 99.9th percentile stretch without a cancellation poll was ${worst.toFixed(2)} ms`);
  assert(polls > 5000, String(polls));
  lex(new SourceText(large), new BoundedCache(), {
    cancellationToken: new CancellationToken({
      poll: () => {
        lexPolls++;
        return false;
      }
    })
  });
  assert(lexPolls > 1000 && lexPolls < polls, 'both the scanner and the parser poll');
  for (const [phase, at] of [
    ['immediately', 1],
    ['scanner', Math.floor(lexPolls / 3)],
    ['parser', lexPolls + Math.floor((polls - lexPolls) / 2)],
    ['last poll', polls]
  ]) {
    let count = 0,
      requested = 0,
      thrown = 0;
    const token = new CancellationToken({
      poll: () => {
        if (++count < at) return false;
        requested = clock();
        return true;
      }
    });
    assert.throws(
      () => {
        try {
          SyntaxTree.parseText(large, { cancellationToken: token });
        } finally {
          thrown = clock();
        }
      },
      error => error instanceof OperationCanceledError && error.code === 'OperationCanceled' && error.name === 'OperationCanceledError',
      phase
    );
    assert.equal(count, at, phase + ': parsing stopped at the poll that requested cancellation');
    assert(thrown - requested < 20, phase);
    assert(token.isCancellationRequested);
  }
  assert.throws(() => lex(new SourceText(large), new BoundedCache(), { cancellationToken: CancellationToken.timeout(1) }), OperationCanceledError);
  assert.throws(
    () => parse(large, undefined, { cancellationToken: new CancellationToken({ poll: () => ++lexPolls > 1e9 || true }) }),
    OperationCanceledError
  );
});
test('cancellation: caches stay consistent after cancelled parses', () => {
  const text = benchmarkDocument(400_000),
    cache = new BoundedCache(65536),
    expected = SyntaxTree.parseText(text);
  for (const fraction of [0.1, 0.3, 0.6, 0.9]) {
    let polls = 0;
    const limit = Math.floor((text.length / 4 / cancellationInterval) * fraction) + 1,
      token = new CancellationToken({ poll: () => ++polls >= limit });
    assert.throws(() => SyntaxTree.parseText(text, { cache, cancellationToken: token }), OperationCanceledError, String(fraction));
    assert(polls >= limit);
  }
  const tree = SyntaxTree.parseText(text, { cache });
  assert.equal(greenDifference(tree.green, expected.green), null);
  assert.equal(tree.toFullString(), text);
  assert.deepEqual(tree.getDiagnostics(), expected.getDiagnostics());
  // An edit can be cancelled too; the tree it started from is unaffected and can be edited again.
  const change = [{ start: text.indexOf('var total'), length: 0, text: '/* note */ ' }];
  assert.throws(() => tree.withChangedText(change, { cancellationToken: new CancellationToken({ poll: () => true }) }), OperationCanceledError);
  const edited = tree.withChangedText(change),
    full = SyntaxTree.parseText(edited.source.text);
  assert.equal(greenDifference(edited.green, full.green), null);
  assert(edited.reusedNodeCount > 0);
  assert.equal(edited.options.cancellationToken, undefined, 'a token belongs to one parse and is not kept in the tree options');
});
test('cancellation: tokens can be cancelled directly, by deadline or through a shared flag', () => {
  const token = new CancellationToken();
  assert.equal(token.isCancellationRequested, false);
  token.throwIfCancellationRequested();
  token.cancel();
  assert.equal(token.isCancellationRequested, true);
  assert.throws(() => token.throwIfCancellationRequested(), OperationCanceledError);
  assert.throws(
    () => SyntaxTree.parseText('class C { }', { cancellationToken: token }),
    OperationCanceledError,
    'an already cancelled token stops even a tiny parse'
  );
  assert.equal(CancellationToken.timeout(60_000).isCancellationRequested, false);
  assert.equal(CancellationToken.timeout(-1).isCancellationRequested, true);
  const flag = new Int32Array(new SharedArrayBuffer(8)),
    shared = CancellationToken.fromSharedFlag(flag, 1);
  assert.equal(shared.isCancellationRequested, false);
  Atomics.store(flag, 1, 1);
  assert.equal(shared.isCancellationRequested, true);
  assert.equal(cancellationInterval, 256);
  assert.deepEqual(SyntaxTree.parseText('class C { }', { cancellationToken: new CancellationToken() }).getDiagnostics(), []);
});
