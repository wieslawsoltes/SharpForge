import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePath, pathToSvg} from '../packages/rendering/src/geometry/path-markup.js';
import {pathCorpus} from './rendering/fixtures/path-corpus.js';

test('the hundred-path corpus includes pinned Fluent icons and preserves normalized figures and fill modes', () => {
  const corpus = pathCorpus();
  assert.equal(corpus.length, 100);
  assert.equal(new Set(corpus.map(entry => entry.source)).size, 100);
  assert.equal(corpus.filter(entry => entry.sourceBlob).length, 3);
  for (const entry of corpus) {
    const geometry = parsePath(entry.source);
    assert.equal(geometry.fillRule, entry.fillRule);
    assert.deepEqual(parsePath((entry.fillRule === 'nonzero' ? 'F1 ' : 'F0 ') + pathToSvg(geometry)), geometry, entry.id);
  }
});

test('invalid path separators and non-finite values retain precise input offsets', () => {
  for (const [source, offset] of [['M,0 0', 1], ['M0,,0', 3], ['M0 0,', 4], ['M0 0,L1 1', 4], ['M1e999 0', 1]]) {
    assert.throws(() => parsePath(source), error => error.code === 'SFRENDER030' && error.offset === offset, source);
  }
});
