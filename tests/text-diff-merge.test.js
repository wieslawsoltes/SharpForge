import test from 'node:test';
import assert from 'node:assert/strict';
import { diffCharacters, diffLines, diffWords, merge3 } from '@sharpforge/text';

function apply(first, second, changes) {
  let offset = 0;
  const output = [];
  for (const change of changes) {
    output.push(first.slice(offset, change.oldStart), second.slice(change.newStart, change.newEnd));
    offset = change.oldEnd;
  }
  output.push(first.slice(offset));
  return output.join('');
}

function distance(first, second) {
  const rows = Array.from({ length: first.length + 1 }, () => new Uint32Array(second.length + 1));
  for (let oldIndex = 1; oldIndex <= first.length; oldIndex++) {
    for (let newIndex = 1; newIndex <= second.length; newIndex++) {
      rows[oldIndex][newIndex] = first[oldIndex - 1] === second[newIndex - 1]
        ? rows[oldIndex - 1][newIndex - 1] + 1 : Math.max(rows[oldIndex - 1][newIndex], rows[oldIndex][newIndex - 1]);
    }
  }
  return first.length + second.length - 2 * rows[first.length][second.length];
}

test('Myers diff: randomized scripts round-trip and match the dynamic-programming minimum', () => {
  let seed = 728491;
  const random = maximum => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % maximum; };
  for (let iteration = 0; iteration < 3000; iteration++) {
    const first = Array.from({ length: random(12) }, () => 'abc'[random(3)]).join('');
    const second = Array.from({ length: random(12) }, () => 'abc'[random(3)]).join('');
    const result = diffCharacters(first, second, { timeLimitMs: 1000 });
    assert.equal(result.minimal, true);
    assert.equal(apply(first, second, result.changes), second, JSON.stringify({ first, second, changes: result.changes }));
    const cost = result.changes.reduce((sum, change) => sum + change.oldEnd - change.oldStart + change.newEnd - change.newStart, 0);
    assert.equal(cost, distance(first, second), `${first}/${second}`);
  }
});

test('line diff retains CRLF offsets and bounded character/word refinement', () => {
  const first = 'same\r\none value\r\ntail\r\n';
  const second = 'same\r\nnew value\r\ntail\r\n';
  const result = diffLines(first, second, { timeLimitMs: 1000 });
  assert.equal(apply(first, second, result.changes), second);
  assert.equal(result.hunks.length, 1);
  assert.equal(result.hunks[0].oldStartLine, 1);
  assert.equal(result.hunks[0].oldEndLine, 2);
  assert.ok(result.hunks[0].innerChanges.length > 0);
  assert.equal(diffLines('a  b\n', 'ab\n', { ignoreWhitespace: 'all' }).changes.length, 0);
  const words = diffWords('one two three', 'one FOUR three');
  assert.equal(apply('one two three', 'one FOUR three', words.changes), 'one FOUR three');
  const emoji = diffCharacters('😀old', '😀new');
  assert.equal(emoji.changes[0].oldStart, 2);
});

test('diff limits return an exact replacement fallback and cancellation remains explicit', () => {
  const first = 'a'.repeat(10000);
  const second = 'b'.repeat(10000);
  const result = diffCharacters(first, second, { maxSteps: 100 });
  assert.equal(result.truncated, true);
  assert.equal(result.minimal, false);
  assert.equal(apply(first, second, result.changes), second);
  assert.equal(diffLines(first, second, { maxInputCharacters: 100 }).reason, 'input size');
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => diffLines('a', 'b', { signal: controller.signal }), { name: 'AbortError' });
});

test('merge3 automatically combines independent edits and identical changes', () => {
  const base = 'one\ntwo\nthree\n';
  const ours = 'ONE\ntwo\nthree\n';
  const theirs = 'one\ntwo\nTHREE\n';
  const result = merge3(base, ours, theirs, { timeLimitMs: 1000 });
  assert.equal(result.text, 'ONE\ntwo\nTHREE\n');
  assert.equal(result.clean, true);
  assert.equal(merge3(base, ours, ours).text, ours);
  assert.equal(merge3(base, base, theirs).text, theirs);
  assert.equal(merge3('abc', 'Abc', 'abC', { granularity: 'character' }).text, 'AbC');
});

test('merge3 conflicts carry exact stable branch/base/result ranges and preserve dominant EOL', () => {
  const args = ['head\r\nbase\r\ntail\r\n', 'head\r\nours\r\ntail\r\n', 'head\r\ntheirs\r\ntail\r\n'];
  const first = merge3(...args);
  const second = merge3(...args);
  assert.equal(first.clean, false);
  assert.equal(first.conflicts.length, 1);
  assert.deepEqual(first.conflicts, second.conflicts);
  const conflict = first.conflicts[0];
  assert.equal(conflict.base, args[0].slice(conflict.baseStart, conflict.baseEnd));
  assert.equal(conflict.ours, args[1].slice(conflict.oursStart, conflict.oursEnd));
  assert.equal(conflict.theirs, args[2].slice(conflict.theirsStart, conflict.theirsEnd));
  assert.equal(first.text.slice(conflict.start, conflict.end), '<<<<<<< ours\r\nours\r\n=======\r\ntheirs\r\n>>>>>>> theirs\r\n');
  assert.equal(first.text.slice(conflict.end), 'tail\r\n');
  const insertions = merge3('', 'ours', 'theirs');
  assert.equal(insertions.conflicts[0].baseStart, 0);
  assert.equal(insertions.conflicts[0].baseEnd, 0);
});
