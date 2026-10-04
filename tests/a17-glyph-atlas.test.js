import test from 'node:test';
import assert from 'node:assert/strict';
import {GlyphAtlas} from '../packages/rendering/src/text/glyph-atlas.js';
import {glyphRasterKey} from '../packages/rendering/src/text/glyph-key.js';
import {uploadAtlasChanges} from '../packages/rendering/src/webgpu/atlas-upload.js';
import {createRecordingDocument} from './fixtures/rendering/recording-canvas.js';

function fixture(options = {}) {
  const document = createRecordingDocument();
  const createCanvas = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const calls = [];
  const provider = {rasterizeGlyph(glyph, raster) {
    calls.push({glyph, raster});
    return {source: {width: 14, height: 14}, width: 14, height: 14,
      logicalBounds: {x: 0, y: -10, width: 14 / raster.dpr, height: 14 / raster.dpr},
      alphaMode: 'premultiplied', colorSpace: 'srgb', colorGlyph: glyph.glyphId === 42};
  }};
  return {atlas: new GlyphAtlas({createCanvas, size: 32, maxBytes: 4096, ...options}), provider, calls, document};
}

test('Five thousand distinct numeric glyphs stay within the atlas budget and rerasterize after LRU eviction', () => {
  const {atlas, provider, calls} = fixture();
  const glyph = glyphId => ({fontId: 'face-version-1', glyphId, fontSize: 14});
  const initial = atlas.getGlyph(glyph(0), {provider});
  for (let index = 1; index < 5000; index++) {
    const entry = atlas.getGlyph(glyph(index), {provider});
    assert.equal(atlas.valid(entry), true);
    assert.ok(atlas.bytes <= 4096);
    assert.ok(atlas.entries.size <= 4);
  }
  assert.equal(atlas.valid(initial), false);
  const restored = atlas.getGlyph(glyph(0), {provider});
  assert.equal(atlas.valid(restored), true);
  assert.notEqual(restored.generation, initial.generation);
  assert.equal(calls.filter(call => call.glyph.glyphId === 0).length, 2);
  atlas.dispose();
  assert.equal(atlas.bytes, 0);
  assert.equal(atlas.valid(restored), false);
});

test('Numeric cache identity includes physical subpixel buckets, font version, size and DPR', () => {
  const {atlas, provider, calls} = fixture({size: 64, maxBytes: 16384});
  const glyph = {fontId: 'font-a', glyphId: 42, fontSize: 16};
  const first = atlas.getGlyph(glyph, {provider, subpixelX: 0.01});
  assert.equal(atlas.getGlyph(glyph, {provider, subpixelX: 0.249}), first);
  const next = atlas.getGlyph(glyph, {provider, subpixelX: 0.25});
  assert.notEqual(next, first);
  assert.equal(calls.at(-1).raster.subpixelX, 0.25);
  assert.equal(next.metrics.colorGlyph, true);
  assert.notEqual(atlas.getGlyph({...glyph, fontSize: 17}, {provider}), first);
  assert.notEqual(atlas.getGlyph({...glyph, fontId: 'font-b'}, {provider}), first);
  assert.notEqual(atlas.getGlyph(glyph, {provider, dpr: 2}), first);
  assert.equal(calls.length, 5);
  for (const options of [{subpixelX: 1}, {subpixelY: -0.1}, {dpr: 0}, {buckets: 100}]) {
    assert.throws(() => glyphRasterKey(glyph, options), error => error.code === 'SFRENDER131');
  }
  assert.throws(() => glyphRasterKey({...glyph, glyphId: -1}), error => error.code === 'SFRENDER131');
  atlas.dispose();
});

test('Pinned glyphs cannot be evicted and malformed rasters leave cache contents intact', () => {
  const {atlas, provider} = fixture({maxEntries: 2});
  const glyph = glyphId => ({fontId: 'font', glyphId, fontSize: 14});
  const first = atlas.getGlyph(glyph(1), {provider});
  atlas.getGlyph(glyph(2), {provider});
  first.page.pins++;
  assert.throws(() => atlas.getGlyph(glyph(3), {provider}), error => error.code === 'SFRENDER086');
  assert.equal(atlas.valid(first), true);
  assert.equal(atlas.entries.size, 2);
  first.page.pins--;
  assert.throws(() => atlas.getGlyph(glyph(4), {provider: {rasterizeGlyph: () => Promise.resolve({})}}),
    error => error.code === 'SFRENDER132');
  assert.equal(atlas.entries.size, 2);
  const replacement = atlas.getGlyph(glyph(3), {provider});
  assert.equal(atlas.valid(replacement), true);
  assert.equal(atlas.valid(first), false);
  atlas.dispose();
  assert.throws(() => atlas.getGlyph(glyph(1), {provider}), error => error.code === 'SFRENDER086');
});

test('Empty glyph rasters preserve advances without allocating pages and bound metadata', () => {
  const {atlas} = fixture();
  const provider = {rasterizeGlyph: () => ({width: 0, height: 0, logicalBounds: {x: 0, y: 0, width: 0, height: 0},
    alphaMode: 'premultiplied', colorSpace: 'srgb'})};
  for (let glyphId = 0; glyphId < 600; glyphId++) {
    const entry = atlas.getGlyph({fontId: 1, glyphId, fontSize: 12}, {provider});
    assert.equal(atlas.valid(entry), true);
    assert.equal(entry.empty, true);
  }
  assert.equal(atlas.bytes, 0);
  assert.equal(atlas.emptyEntries.size, 512);
  atlas.dispose();
  assert.equal(atlas.emptyEntries.size, 0);
});

test('Pending color glyph decodes are retried after invalidation and never become cached empty glyphs', () => {
  const {atlas, provider: readyProvider} = fixture();
  const glyph = {fontId: 'color-font', glyphId: 42, fontSize: 14};
  let pending = true, calls = 0;
  const provider = {rasterizeGlyph(value, options) {
    calls++;
    if (!pending) return readyProvider.rasterizeGlyph(value, options);
    return {pending: true, width: 0, height: 0, logicalBounds: {x: 0, y: 0, width: 0, height: 0},
      alphaMode: 'premultiplied', colorSpace: 'srgb'};
  }};
  const first = atlas.getGlyph(glyph, {provider});
  assert.equal(first.pending, true);
  assert.equal(atlas.valid(first), false);
  assert.equal(atlas.getGlyph(glyph, {provider}).pending, true);
  assert.equal(calls, 2);
  assert.equal(atlas.bytes, 0);
  assert.equal(atlas.emptyEntries.size, 0);
  pending = false;
  const ready = atlas.getGlyph(glyph, {provider});
  assert.equal(ready.metrics.colorGlyph, true);
  assert.equal(atlas.valid(ready), true);
  assert.equal(atlas.getGlyph(glyph, {provider}), ready);
  assert.equal(calls, 3);
  assert.throws(() => atlas.getGlyph({...glyph, glyphId: 43}, {provider: {rasterizeGlyph(value, options) {
    return {...readyProvider.rasterizeGlyph(value, options), pending: true};
  }}}), error => error.code === 'SFRENDER132');
  atlas.dispose();
});

test('Atlas uploads touch only dirty shelves and validate every source rectangle before writing', () => {
  const writes = [];
  const queue = {copyExternalImageToTexture: (...args) => writes.push(args)};
  const image = {source: {}, width: 64, height: 64, dirtyRects: [[4, 8, 16, 12], [24, 8, 16, 12]]};
  uploadAtlasChanges(queue, {}, image);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0][0].origin, [4, 8]);
  assert.deepEqual(writes[0][1].origin, [4, 8]);
  assert.deepEqual(writes[0][2], [16, 12]);
  writes.length = 0;
  assert.throws(() => uploadAtlasChanges(queue, {}, {...image, dirtyRects: [[0, 0, 4, 4], [63, 63, 2, 2]]}),
    error => error.code === 'SFRENDER134');
  assert.equal(writes.length, 0);
});
