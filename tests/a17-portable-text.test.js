import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {portableText} from './fixtures/rendering/portable-text.js';
import {TextLayoutService, caretRectangle, hitTestText, selectionRectangles} from '../packages/rendering/src/text/layout.js';
import {segmentGraphemes} from '../packages/rendering/src/text/unicode.js';
import {DisplayList} from '../packages/rendering/src/drawing/display-list.js';
import {DrawingContext} from '../packages/rendering/src/drawing/context.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test('portable glyph IDs, UTF-16 clusters and offsets match the independently captured raw upstream engine', async () => {
  const oracle = JSON.parse(await readFile(new URL('./fixtures/rendering/harfbuzz-oracle.json', import.meta.url), 'utf8'));
  assert.equal(oracle.provenance.expectedSource, 'raw upstream hbjs glyph info and positions');
  assert.equal(oracle.provenance.wasmSha256, '3b802d1782b72fa5eeb0d7a108b561beb788248ecc1134845e20ba84e4642ca9');
  const provider = await portableText();
  try {
    for (const fixture of oracle.cases) {
      const run = await provider.shape(fixture.text, {...fixture.options, wrapping: 'nowrap'});
      assert.equal(run.glyphAccess, 'numeric-glyphs', fixture.id);
      assert.equal(run.clusterAccess, 'harfbuzz', fixture.id);
      assert.equal(run.glyphs.length, fixture.items.reduce((sum, item) => sum + item.glyphs.length, 0), fixture.id);
      for (const item of fixture.items) {
        const glyphs = run.glyphs.filter(glyph => glyph.cluster >= item.start && glyph.cluster < item.end);
        assert.equal(glyphs.length, item.glyphs.length, fixture.id);
        const scale = fixture.options.fontSize / item.unitsPerEm;
        for (let index = 0; index < glyphs.length; index++) {
          const glyph = glyphs[index], expected = item.glyphs[index];
          assert.equal(glyph.glyphId, expected.glyphId, fixture.id);
          assert.equal(glyph.cluster, expected.cluster, fixture.id);
          assert.ok(glyph.fontId.startsWith(item.fontSha256 + '@'), fixture.id);
          close(glyph.xAdvance, expected.x_advance * scale);
          close(glyph.yAdvance, expected.y_advance * scale);
          close(glyph.xOffset, expected.x_offset * scale);
          close(glyph.yOffset, expected.y_offset * scale);
        }
      }
      const list = new DrawingContext().DrawGlyphRun(run, [5, 7], '#123456').finish();
      assert.deepEqual(DisplayList.deserialize(list.serialize()).commands[0].run, list.commands[0].run);
    }
  } finally { provider.dispose(); }
});

test('portable layouts use actual font matching, contextual wrapping, tabs, trimming and shared cache keys', async () => {
  const provider = await portableText(), service = new TextLayoutService(provider);
  try {
    const text = 'office office office office';
    const full = service.layout(text, {fontFamily: 'SharpForge Sans Fixture', fontSize: 24, wrapping: 'nowrap'});
    assert.ok(full.glyphs.length < text.length, 'the loaded font supplies actual ligature glyphs');
    const unligated = service.layout(text, {fontFamily: 'SharpForge Sans Fixture', fontSize: 24, wrapping: 'nowrap', features: 'liga=0'});
    assert.notEqual(unligated, full);
    assert.ok(unligated.glyphs.length > full.glyphs.length);
    const normal = service.layout('AV', {fontFamily: 'SharpForge Sans Fixture', fontSize: 24, fontWeight: 400});
    const heavy = service.layout('AV', {fontFamily: 'SharpForge Sans Fixture', fontSize: 24, fontWeight: 800});
    const italic = service.layout('AV', {fontFamily: 'SharpForge Sans Fixture', fontSize: 24, fontStyle: 'italic'});
    assert.notEqual(normal.glyphs[0].fontId, heavy.glyphs[0].fontId);
    assert.notEqual(normal.glyphs[0].fontId, italic.glyphs[0].fontId);
    const wrapped = service.layout(text, {fontSize: 24, width: full.width / 3, wrapping: 'wrap', lineHeight: 40});
    assert.ok(wrapped.lines.length >= 3);
    assert.ok(wrapped.lines.every(line => line.width <= full.width / 3 + 1e-8));
    assert.equal(wrapped.height, wrapped.lines.length * 40);
    const boundaries = new Set([0, ...segmentGraphemes(text).map(cluster => cluster.end)]);
    assert.ok(wrapped.lines.every(line => boundaries.has(line.start) && boundaries.has(line.visibleEnd)));
    const trimmed = service.layout(text, {fontSize: 24, width: 100, wrapping: 'wrap', maxLines: 1, trimming: 1});
    assert.equal(trimmed.lines.length, 1); assert.equal(trimmed.trimmed, true);
    assert.ok(trimmed.lines[0].text.endsWith('…'));
    assert.ok(trimmed.lines[0].width <= 100);
    const tabbed = service.layout('a\tb', {fontSize: 24, wrapping: 'nowrap', tabSize: 4});
    const tab = tabbed.clusters.find(cluster => cluster.text === '\t');
    assert.ok(tab.rects[0][2] > 0); assert.equal(tabbed.glyphs.some(glyph => glyph.cluster === 1), false);
    const decorated = service.layout('office', {fontSize: 24, underline: true, strikethrough: true});
    assert.deepEqual(new Set(decorated.decorations.map(value => value.kind)), new Set(['underline', 'strikethrough']));
    const centered = service.layout('AV', {fontSize: 24, width: 200, alignment: 'center'});
    close(centered.lines[0].left, (200 - centered.lines[0].width) / 2);
    const colored = service.layout('office', {fontSize: 24, runs: [
      {start: 0, end: 2, style: {foreground: '#ff0000'}}, {start: 2, end: 6, style: {foreground: '#0000ff'}}
    ]});
    assert.ok(colored.glyphs.every(glyph => glyph.foreground === (glyph.cluster < 2 ? '#ff0000' : '#0000ff')));
    assert.equal(provider.shaper.input, 0, 'every measurement releases the reusable source allocation');
  } finally { service.dispose(); }
});

test('real cluster geometry snaps combining marks, ligatures and emoji, and respects bidi selection', async () => {
  const provider = await portableText();
  try {
    const run = await provider.shape('office a\u0301 אבג 👩‍💻', {fontSize: 24, direction: 'ltr'});
    for (const cluster of run.clusters) {
      if (cluster.end - cluster.start > 1) {
        const beginning = caretRectangle(run, cluster.start, 'backward');
        const end = caretRectangle(run, cluster.end - 1, 'forward');
        assert.deepEqual(caretRectangle(run, cluster.start + 1, 'backward'), beginning);
        assert.ok(Number.isFinite(end[0]));
      }
      const rect = cluster.rects[0], hit = hitTestText(run, rect[0] + rect[2] * 0.25, rect[1] + rect[3] / 2);
      assert.ok([cluster.start, cluster.end].includes(hit.position));
    }
    const hebrew = run.clusters.filter(cluster => /[אבג]/.test(cluster.text));
    assert.ok(hebrew.every(cluster => cluster.rtl));
    assert.ok(hebrew[0].rects[0][0] > hebrew.at(-1).rects[0][0]);
    const rectangles = selectionRectangles(run, 0, run.text.length);
    assert.ok(rectangles.length > 0); assert.ok(rectangles.every(rect => rect.every(Number.isFinite)));
    const missing = String.fromCodePoint(0x10fffd);
    assert.throws(() => provider.layout(missing), error => error.code === 'SFRENDER141');
    assert.equal(provider.shaper.input, 0);
  } finally { provider.dispose(); }
});
