import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createFontShaper} from './fixtures/rendering/font-shaper.js';

test('real font fallback and script itemization preserve the raw oracle glyphs and UTF-16 positions', async () => {
  const oracle = JSON.parse(await readFile(new URL('./fixtures/rendering/harfbuzz-oracle.json', import.meta.url), 'utf8'));
  const subject = await createFontShaper();
  try {
    for (const fixture of oracle.cases) {
      const shaped = subject.shape(fixture.text, fixture.options), glyphs = shaped.items.flatMap(item => item.glyphs);
      for (const item of fixture.items) {
        const actual = glyphs.filter(glyph => glyph.cluster >= item.start && glyph.cluster < item.end);
        assert.equal(actual.length, item.glyphs.length, fixture.id);
        for (let index = 0; index < actual.length; index++) {
          const glyph = actual[index], expected = item.glyphs[index], scale = fixture.options.fontSize / item.unitsPerEm;
          assert.equal(glyph.glyphId, expected.glyphId, fixture.id);
          assert.equal(glyph.cluster, expected.cluster, fixture.id);
          assert.ok(glyph.fontId.startsWith(item.fontSha256 + '@'), fixture.id);
          for (const [field, raw] of [['xAdvance', 'x_advance'], ['yAdvance', 'y_advance'], ['xOffset', 'x_offset'], ['yOffset', 'y_offset']]) {
            assert.ok(Math.abs(glyph[field] - expected[raw] * scale) < 1e-8, fixture.id + ': ' + field);
          }
        }
      }
      assert.equal(subject.shaper.input, 0);
    }
    assert.throws(() => subject.shape(String.fromCodePoint(0x10fffd)), error => error.code === 'SFRENDER141');
    assert.throws(() => subject.shape('a', {features: 'malformed-feature'}), error => error.code === 'SFRENDER143');
    assert.throws(() => subject.shape('a\u0301', {runs: [
      {start: 0, end: 1, style: {fontSize: 14}}, {start: 1, end: 2, style: {fontSize: 24}}
    ]}), error => error.code === 'SFRENDER143');
  } finally { subject.dispose(); }
  assert.equal(subject.fonts.faces.length, 0); assert.equal(subject.fonts.instances.size, 0);
  assert.equal(subject.shaper.input, 0); assert.equal(subject.shaper.buffer, null);
});
