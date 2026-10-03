import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GraphemeSegmenter, graphemeSegments, nextGraphemeOffset, previousGraphemeOffset, subwordBoundaries,
  nextWordOffset, previousWordOffset, wordRangeAt, visualColumnAt, offsetAtVisualColumn, graphemeWidth, expandTabs
} from '@sharpforge/text';

const fixtures = [
  ['a\u0301b', ['a\u0301', 'b']], ['👩‍👩‍👧‍👦!', ['👩‍👩‍👧‍👦', '!']],
  ['🇵🇱🇯🇵x', ['🇵🇱', '🇯🇵', 'x']], ['👍🏽👍', ['👍🏽', '👍']], ['\r\nX', ['\r\n', 'X']],
  ['각각', ['각', '각']], ['क्\u200dष', ['क्\u200dष']]
];

for (const [text, expected] of fixtures) test(`grapheme movement keeps clusters intact: ${JSON.stringify(text)}`, () => {
  for (const forceFallback of [false, true]) {
    const segmenter = new GraphemeSegmenter({ forceFallback });
    const options = { segmenter };
    const segments = graphemeSegments(text, options);
    assert.deepEqual(segments.map(item => item.segment), expected);
    let offset = 0;
    for (const segment of segments) {
      assert.equal(previousGraphemeOffset(text, segment.end, options), offset);
      assert.equal(nextGraphemeOffset(text, offset, options), segment.end);
      for (let interior = segment.index; interior < segment.end; interior++) {
        assert.equal(nextGraphemeOffset(text, interior, options), segment.end);
      }
      offset = segment.end;
    }
  }
});

test('word/subword navigation handles acronym humps, digits, underscores and CJK', () => {
  assert.deepEqual(subwordBoundaries('XMLHttp2_Value'), [0, 3, 7, 8, 9, 14]);
  assert.equal(nextWordOffset('one two', 0), 4);
  assert.equal(previousWordOffset('one two', 4), 0);
  assert.equal(nextWordOffset('XMLHttp2_Value', 3, { subword: true }), 7);
  assert.equal(previousWordOffset('XMLHttp2_Value', 7, { subword: true }), 3);
  assert.equal(wordRangeAt('foo + 日本語', 1).segment, 'foo');
  const cjk = wordRangeAt('foo + 日本語', 7);
  assert.ok(cjk.index >= 6 && cjk.end <= 9 && cjk.segment.length > 0);
});

test('visual columns distinguish UTF-16 characters, graphemes, tabs, wide characters and virtual space', () => {
  const text = 'a\t界😀e\u0301';
  assert.equal(visualColumnAt(text, text.length, { tabSize: 4 }), 9);
  assert.equal(visualColumnAt(text, 2, { tabSize: 4 }), 4);
  assert.equal(offsetAtVisualColumn(text, 3, { tabSize: 4 }).offset, 1);
  assert.equal(offsetAtVisualColumn(text, 3, { tabSize: 4 }).insideTab, true);
  assert.equal(offsetAtVisualColumn(text, 5, { bias: 'right' }).offset, 3);
  assert.equal(offsetAtVisualColumn(text, 12).virtualSpaces, 3);
  assert.equal(graphemeWidth('👩‍👩‍👧‍👦'), 2);
  assert.equal(graphemeWidth('\u0301'), 0);
  assert.equal(expandTabs('a\tb\t', { tabSize: 4 }), 'a   b   ');
  assert.throws(() => graphemeWidth('\t', 0, { tabSize: 0 }), RangeError);
  assert.throws(() => offsetAtVisualColumn(text, -1), RangeError);
});
