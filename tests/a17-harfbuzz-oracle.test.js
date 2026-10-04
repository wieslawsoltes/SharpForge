import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captureHarfBuzzOracle} from '../packages/rendering/tools/capture-harfbuzz-oracle.js';

test('the pinned glyph oracle is reproducible through raw upstream APIs without the portable provider', async () => {
  const expected = JSON.parse(await readFile(new URL('./fixtures/rendering/harfbuzz-oracle.json', import.meta.url), 'utf8'));
  assert.deepEqual(await captureHarfBuzzOracle(), expected);
});
