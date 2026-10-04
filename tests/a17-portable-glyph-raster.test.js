import test from 'node:test';
import assert from 'node:assert/strict';
import {createFontShaper} from './fixtures/rendering/font-shaper.js';
import {createRecordingDocument} from './fixtures/rendering/recording-canvas.js';
import {PortableGlyphRasterizer} from '../packages/rendering/src/text/portable-rasterizer.js';

test('real numeric glyph outlines keep ink bounds and bitmap decode ownership without character substitution', async () => {
  const subject = await createFontShaper(), document = createRecordingDocument();
  const images = [], notifications = [];
  let complete;
  const rasterizer = new PortableGlyphRasterizer(subject.fonts, {createCanvas(width, height) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
  }, decodeImage: bytes => new Promise(resolve => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const image = {width: view.getUint32(16), height: view.getUint32(20), closed: 0, close() { this.closed++; }};
    images.push(image); complete = () => resolve(image);
  }), onChanged: () => notifications.push('ready')});
  try {
    const latin = subject.shape('A', {fontSize: 24}).items[0].glyphs[0];
    assert.match(rasterizer.glyphPath(latin).path, /[MLCQ]/);
    const bounds = rasterizer.glyphBounds(latin), raster = rasterizer.rasterize(latin, {dpr: 2, subpixelX: 0.25});
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.equal(raster.logicalBounds.width, raster.width / 2);
    assert.ok(raster.logicalBounds.x <= bounds.x && raster.logicalBounds.y <= bounds.y);
    assert.ok(raster.source.calls.some(call => call.name === 'fill'));
    assert.equal(raster.source.calls.some(call => call.name === 'fillText'), false);
    const emoji = subject.shape('👩‍💻', {fontSize: 32}).items[0].glyphs[0];
    const pending = rasterizer.rasterize(emoji);
    assert.equal(pending.pending, true); assert.equal(pending.width, 0);
    complete(); await rasterizer.prepare({glyphs: [emoji]});
    assert.deepEqual(notifications, ['ready']);
    const colored = rasterizer.rasterize(emoji);
    assert.equal(colored.colorGlyph, true); assert.ok(colored.width > 0 && colored.height > 0);
    assert.ok(colored.source.calls.some(call => call.name === 'drawImage' && call.args[0] === images[0]));
    assert.equal(images[0].closed, 0);
  } finally { rasterizer.dispose(); subject.dispose(); }
  assert.equal(images[0].closed, 1);
  assert.equal(rasterizer.glyphs.bytes, 0); assert.equal(rasterizer.images.bytes, 0);
});
