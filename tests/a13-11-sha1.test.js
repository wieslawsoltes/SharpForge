import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha1 } from '@sharpforge/cil';
import { sha1 as symbolSha1, hex } from '@sharpforge/symbols';

const reference = bytes => createHash('sha1').update(bytes).digest('hex');

test('CIL exposes the identical symbols SHA-1 function and standard vectors', () => {
  assert.equal(sha1, symbolSha1);
  for (const [text, digest] of [['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['The quick brown fox jumps over the lazy dog', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12']]) {
    assert.equal(hex(sha1(new TextEncoder().encode(text))), digest);
  }
});

test('SHA-1 padding and multi-block boundaries agree with the independent host digest', () => {
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 16384]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + 7) & 255);
    assert.equal(hex(sha1(bytes)), reference(bytes));
  }
});

test('SHA-1 respects Buffer/subarray bounds and owns each result', () => {
  const source = Buffer.from([99, 1, 2, 3, 88]);
  const view = source.subarray(1, 4), snapshot = Buffer.from(source);
  const digest = sha1(view);
  assert.equal(hex(digest), reference(view));
  digest.fill(0);
  assert.deepEqual(source, snapshot);
  assert.equal(hex(sha1(view)), reference(view));
  assert.equal(hex(sha1(Uint8Array.from(source).subarray(1, 4))), reference(view));
});

test('legacy symbols array-like byte coercion is preserved by the shared function', () => {
  for (const input of [[1, 2, 255], { 0: 257, 1: -1, length: 2 }]) {
    assert.equal(hex(sha1(input)), reference(Uint8Array.from(input)));
  }
  assert.throws(() => sha1(null), TypeError);
});
