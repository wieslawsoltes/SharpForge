import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentGraphemes, unicodeTextVersions} from '../packages/rendering/src/text/unicode.js';
import {textBidi, lineBidiTail, visualTextItems} from '../packages/rendering/src/text/bidi.js';

test('pinned extended graphemes preserve marks, Indic conjuncts, emoji, Hangul and UTF-16 boundaries', () => {
  const fixtures = [
    ['a\u0301', [2]], ['\r\n', [2]], ['a\r\nb', [1, 3, 4]],
    ['🇵🇱🇺', [4, 6]], ['👩🏽‍🚀', [7]], ['👨‍👩‍👧‍👦', [11]],
    ['\u0915\u094d\u0937', [3]], ['\u1100\u1161\u11a8', [3]],
    ['\u0600a', [2]], ['a\u200bb', [1, 2, 3]], ['a b', [1, 2, 3]]
  ];
  for (const [text, boundaries] of fixtures) {
    assert.deepEqual(segmentGraphemes(text).map(cluster => cluster.end), boundaries, JSON.stringify(text));
  }
  assert.deepEqual(unicodeTextVersions, {graphemes: '17.0.0', scripts: '17.0.0', lineBreak: '17.0.0', bidi: '13.0.0'});
  assert.throws(() => segmentGraphemes('abc', {maxClusters: 2}), error => error.code === 'SFRENDER082');
});

test('line bidi reset applies at a nonzero soft-line start and scalar levels cover both surrogate code units', () => {
  const bidi = textBidi('abc אבג   ד', 'ltr');
  assert.ok(bidi.levels[7] & 1, 'interior paragraph spaces initially belong to the RTL context');
  assert.deepEqual(lineBidiTail(bidi, 4, 10), {start: 7, level: 0});
  const word = {start: 4, end: 7, id: 'word'}, tail = {start: 7, end: 10, id: 'trailing whitespace'};
  assert.deepEqual(visualTextItems(bidi, [word, tail], 4, 10).map(item => item.id), ['word', 'trailing whitespace']);
  const math = textBidi('a 𞸀 1', 'ltr');
  assert.equal(math.levels[2], math.levels[3]);
  assert.equal(math.levels[2] & 1, 1);
  const brackets = textBidi('(אבג)', 'auto');
  assert.equal(brackets.paragraphs[0].level, 1);
  assert.ok([...brackets.levels].every(level => level & 1));
});
