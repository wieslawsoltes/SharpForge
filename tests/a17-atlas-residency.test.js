import test from 'node:test';
import assert from 'node:assert/strict';
import {portableText} from './fixtures/rendering/portable-text.js';
import {TextLayoutService} from '../packages/rendering/src/text/layout.js';
import {residentGlyphs, residentGrid, glyphIdentity, pressureRun} from './rendering/fixtures/atlas-residency-data.js';

test('atlas stress uses 5000 distinct real HarfBuzz font/glyph pairs and wholly visible ink cells', async () => {
  const provider = await portableText(), service = new TextLayoutService(provider);
  try {
    const glyphs = await residentGlyphs(service);
    assert.equal(glyphs.length, 5000);
    assert.equal(new Set(glyphs.map(glyphIdentity)).size, 5000);
    assert.ok(new Set(glyphs.map(glyph => glyph.fontId)).size > 50);
    const before = glyphs.map(glyph => [glyph.x, glyph.y]);
    const run = residentGrid(glyphs, provider);
    assert.equal(run.glyphAccess, 'numeric-glyphs');
    assert.deepEqual(glyphs.map(glyph => [glyph.x, glyph.y]), before, 'stress placement must not mutate real shaped output');
    for (const glyph of run.glyphs) {
      const font = provider.fonts.get(glyph.fontId), bounds = provider.glyphBounds(glyph);
      assert.ok(glyph.glyphId > 0 && glyph.glyphId < font.face.data.glyphCount);
      assert.ok(font.variations.wght >= 100 && font.variations.wght <= 900);
      assert.ok(glyph.x + bounds.x >= 0 && glyph.y + bounds.y >= 0);
      assert.ok(glyph.x + bounds.x + bounds.width <= run.width && glyph.y + bounds.y + bounds.height <= run.height);
    }
    const pressure = pressureRun(glyphs, provider, 0, run);
    assert.ok(pressure.run.glyphs.length > 0 && pressure.run.glyphs.length <= 512);
    assert.ok(pressure.declaredRasterPixels > 0 && pressure.declaredRasterPixels < 2 * 1024 * 1024);
    assert.throws(() => residentGrid(glyphs.slice(1), provider), /5000 glyph/);
    assert.throws(() => pressureRun(glyphs, provider, 16, run), /pressure pass/);
  } finally { service.dispose(); }
});

test('atlas corpus rejects cancellation before shaping and rejects unsupported provider/size claims', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled atlas setup'));
  const service = {provider: {kind: 'harfbuzz'}, shape() { throw new Error('must not shape'); }};
  await assert.rejects(residentGlyphs(service, {signal: controller.signal}), /cancelled atlas setup/);
  await assert.rejects(residentGlyphs(service, {fontSize: 17}), /pinned HarfBuzz/);
  await assert.rejects(residentGlyphs({provider: {kind: 'native-canvas'}}), /pinned HarfBuzz/);
});
