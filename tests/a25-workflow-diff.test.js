import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines } from '../packages/git/src/diff/lines.js';
import { createHunks, formatPatch } from '../packages/git/src/diff/patch.js';
import { applyPatch, applySelectedLines } from '../packages/git/src/patch-apply.js';
import { mergeText, mergeFile } from '../packages/git/src/merge/diff3.js';

function minimumDistance(before, after) {
  let previous = Array.from({ length: after.length + 1 }, (_, index) => index);
  for (let left = 0; left < before.length; left++) {
    const current = [left + 1];
    for (let right = 0; right < after.length; right++) current.push(before[left] === after[right]
      ? previous[right] : Math.min(previous[right + 1], current[right]) + 1);
    previous = current;
  }
  return previous.at(-1);
}

test('150 deterministic line pairs reconstruct both inputs and Myers reaches the exact minimum edit distance', () => {
  let seed = 87123;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let fixture = 0; fixture < 150; fixture++) {
    const before = Array.from({ length: next() % 12 }, () => `${next() % 5}\n`);
    const after = Array.from({ length: next() % 12 }, () => `${next() % 5}\n`);
    for (const algorithm of ['myers', 'histogram']) {
      const operations = diffLines(before, after, { algorithm });
      assert.deepEqual(operations.filter(item => item.type !== 'insert').map(item => item.line), before, `${algorithm} before ${fixture}`);
      assert.deepEqual(operations.filter(item => item.type !== 'delete').map(item => item.line), after, `${algorithm} after ${fixture}`);
      if (algorithm === 'myers') assert.equal(operations.filter(item => item.type !== 'equal').length, minimumDistance(before, after));
    }
  }
});

test('unified patches round-trip no-newline files and support selected hunks and lines', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk';
  const after = 'A\nb\nc\nd\nE\nf\ng\nh\ni\nj\nK';
  const operations = diffLines(before, after);
  const hunks = createHunks(operations, { context: 0 });
  assert.equal(hunks.length, 3);
  const patch = formatPatch(before, after, { context: 1, path: 'file.txt', oldMode: 0o100644, newMode: 0o100644 });
  assert.equal(applyPatch(before, patch), after);
  assert.equal(applyPatch(after, patch, { reverse: true }), before);
  const selected = hunks[1].lines.filter(line => line.type !== 'equal').map(line => line.index);
  assert.equal(applySelectedLines(before, after, { selectedLines: selected }), 'a\nb\nc\nd\nE\nf\ng\nh\ni\nj\nk');
  assert.throws(() => applyPatch('different', patch), { code: 'Conflict' });
  assert.throws(() => diffLines('a\nb\n', 'c\nd\n', { maxWork: 1 }), { code: 'Limit' });
});

test('diff3 resolves independent edits and exposes all marker styles, binary conflicts and union merges', () => {
  assert.equal(mergeText('a\nb\nc\nd\ne\n', 'A\nb\nc\nd\ne\n', 'a\nb\nc\nd\nE\n').text, 'A\nb\nc\nd\nE\n');
  for (const style of ['merge', 'diff3', 'zdiff3']) {
    const merged = mergeText('base\n', 'ours\n', 'theirs\n', { style });
    assert.equal(merged.clean, false);
    assert.match(merged.text, /<<<<<<< HEAD\nours\n/u);
    assert.equal(merged.text.includes('||||||| base'), style !== 'merge');
  }
  assert.equal(mergeText('', 'one\n', 'two\n', { driver: 'union' }).text, 'one\ntwo\n');
  const binary = mergeFile(new Uint8Array([0, 1]), new Uint8Array([0, 2]), new Uint8Array([0, 3]));
  assert.equal(binary.clean, false);
  assert.deepEqual(binary.data, new Uint8Array([0, 2]));
});
