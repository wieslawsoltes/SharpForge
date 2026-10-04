import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentGraphemes, unicodeTextVersions} from '../packages/rendering/src/text/unicode.js';

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
