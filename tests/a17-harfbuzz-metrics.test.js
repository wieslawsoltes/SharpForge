import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadBundledHarfBuzz} from '../packages/rendering/src/text/harfbuzz-loader.js';
import {bundledTextFixtures} from '../packages/rendering/src/text/bundled-fixtures.js';
import {harfBuzzMetrics} from '../packages/rendering/src/text/harfbuzz-metrics.js';

test('full native font-extents ABI leaves subsequent real HarfBuzz shaping intact', async () => {
  const fixtures = bundledTextFixtures(new URL('../', import.meta.url));
  const {hb, module} = await loadBundledHarfBuzz({loadBinary: url => readFile(new URL(url)), wasmURL: fixtures.wasmURL});
  const bytes = await readFile(new URL(fixtures.fonts[0].url));
  const blob = hb.createBlob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    font.setScale(face.upem, face.upem);
    assert.deepEqual(harfBuzzMetrics(module, font), {ascender: 1069, descender: -293, lineGap: 0});
    assert.deepEqual(harfBuzzMetrics(module, font), {ascender: 1069, descender: -293, lineGap: 0});
    buffer.addText('office');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer, '');
    assert.deepEqual(buffer.getGlyphInfos().map(value => value.codepoint), [82, 1264, 70, 72]);
    assert.deepEqual(buffer.getGlyphInfos().map(value => value.cluster), [0, 1, 4, 5]);
  } finally {
    buffer.destroy();
    font.destroy();
    face.destroy();
    blob.destroy();
  }
});
