import test from 'node:test';
import assert from 'node:assert/strict';
import {ColorFont} from '../packages/rendering/src/text/color-fonts.js';
import {colorFontTables, glyphPng, chunk, makeColr, makeCpal} from './fixtures/rendering/color-font-tables.js';

const corruption = error => error?.code === 'SFRENDER140';
const unsupported = error => error?.code === 'SFRENDER146';

for (const [format, imageFormat, ids] of [[1, 17, [1, 3]], [2, 19, [1, 2]], [3, 18, [1, 3]], [4, 17, [1, 3]], [5, 19, [1, 3]]]) {
  test(`color glyph CBLC index ${format} and CBDT image ${imageFormat} preserve metrics and sparse identities`, () => {
    const font = colorFontTables({strikes: [{format, imageFormat, ids}]}), color = new ColorFont(font);
    assert.equal(color.hasColor, true);
    for (const glyphId of ids) {
      const bitmap = color.bitmap(glyphId, 12);
      assert.deepEqual({...bitmap, png: null}, {width: 2, height: 1, bearingX: -3, bearingY: 4,
        advance: 7, ppemX: 16, ppemY: 16, png: null});
      assert.deepEqual(bitmap.png, glyphPng());
      assert.equal(bitmap.png.buffer, font.bytes.buffer);
      assert.equal(color.bitmap(glyphId, 9), bitmap);
      assert.equal(color.bitmap(glyphId, 60), bitmap);
      assert.ok(Object.isFrozen(bitmap));
    }
    assert.equal(color.bitmap(0, 12), null);
    if (!ids.includes(2)) assert.equal(color.bitmap(2, 12), null);
    assert.equal(color.layers(1), null);
  });
}

test('color bitmap strike selection uses the smallest adequate physical strike and falls back to the largest present glyph', () => {
  const font = colorFontTables({strikes: [{ppem: 48, ppemX: 40, ids: [1]}, {ppem: 16, ids: [1, 2]}, {ppem: 32, ids: [1]}]});
  const color = new ColorFont(font);
  for (const [requested, expected] of [[1, 16], [16, 16], [16.01, 32], [40, 48], [100, 48]]) {
    assert.equal(color.bitmap(1, requested).ppemY, expected);
  }
  assert.equal(color.bitmap(1, 40).ppemX, 40);
  assert.equal(color.bitmap(2, 100).ppemY, 16);
});

test('COLRv0 preserves ordered overlapping layer ranges, foreground, exact CPAL bytes and alternate palettes', () => {
  const color = new ColorFont(colorFontTables({colr: {bases: [{glyphId: 1, first: 0, count: 2}, {glyphId: 4, first: 1, count: 1}]}, cpal: {}}));
  assert.equal(color.hasColor, true);
  assert.deepEqual(color.layers(1), [{glyphId: 2, color: [1, 2, 3, 255]}, {glyphId: 3, color: null}]);
  assert.deepEqual(color.layers(1, 1), [{glyphId: 2, color: [10, 20, 30, 0]}, {glyphId: 3, color: null}]);
  assert.deepEqual(color.layers(4), [{glyphId: 3, color: null}]);
  assert.equal(color.layers(0), null);
  assert.ok(Object.isFrozen(color.layers(1)));
  assert.ok(Object.isFrozen(color.layers(1)[0].color));
  assert.throws(() => color.layers(1, 2), corruption);
  assert.throws(() => color.layers(1, 0.5), corruption);
});

test('CPALv1 optional metadata is bounded while a missing CPAL disables COLR as specified', () => {
  assert.deepEqual(new ColorFont(colorFontTables({colr: {}, cpal: {version: 1}})).layers(1)[0].color, [1, 2, 3, 255]);
  const missing = new ColorFont(colorFontTables({colr: {}}));
  assert.equal(missing.hasColor, false); assert.equal(missing.layers(1), null);
  assert.equal(new ColorFont(colorFontTables()).hasColor, false);
  assert.throws(() => new ColorFont(colorFontTables({colr: {}, cpal: {version: 1}, edit(tables) {
    new DataView(tables.get('CPAL').buffer).setUint32(16, 0xfffffff0);
  }})), corruption);
});

for (const [name, options] of [
  ['COLR version', {colr: {version: 1}, cpal: {}}],
  ['CPAL version', {colr: {}, cpal: {version: 2}}],
  ['CBLC version', {strikes: [{}], edit: tables => new DataView(tables.get('CBLC').buffer).setUint16(0, 4)}],
  ['CBDT version', {strikes: [{}], edit: tables => new DataView(tables.get('CBDT').buffer).setUint16(2, 1)}],
  ['CBLC index', {strikes: [{}], edit: tables => new DataView(tables.get('CBLC').buffer).setUint16(64, 6)}],
  ['CBDT format', {strikes: [{}], edit: tables => new DataView(tables.get('CBLC').buffer).setUint16(66, 8)}],
  ['vertical small metrics', {strikes: [{flags: 2}]}],
  ['SVG-only color', {edit: tables => tables.set('SVG ', new Uint8Array(10))}]
]) test(`color-font unsupported ${name} has an explicit diagnostic`, () => {
  assert.throws(() => new ColorFont(colorFontTables(options)), unsupported);
});

for (const [name, edit] of [
  ['missing CBDT', tables => tables.delete('CBDT')],
  ['missing CBLC', tables => tables.delete('CBLC')],
  ['strike count', tables => new DataView(tables.get('CBLC').buffer).setUint32(4, 257)],
  ['strike glyph extent', tables => new DataView(tables.get('CBLC').buffer).setUint16(50, 65535)],
  ['strike list overlap', tables => new DataView(tables.get('CBLC').buffer).setUint32(8, 8)],
  ['strike list size', tables => new DataView(tables.get('CBLC').buffer).setUint32(12, 0xffffff)],
  ['subtable header overlap', tables => new DataView(tables.get('CBLC').buffer).setUint32(60, 4)],
  ['image header overlap', tables => new DataView(tables.get('CBLC').buffer).setUint32(68, 0)],
  ['decreasing image offsets', tables => new DataView(tables.get('CBLC').buffer).setUint32(72, 1000)],
  ['image range outside table', tables => new DataView(tables.get('CBLC').buffer).setUint32(76, 0xffffff)],
  ['shared metrics missing', tables => new DataView(tables.get('CBLC').buffer).setUint16(66, 19)]
]) test(`color-font rejects corrupt ${name} before raster decoding`, () => {
  assert.throws(() => new ColorFont(colorFontTables({strikes: [{}], edit})), corruption);
});

test('COLR and CPAL reject unsorted IDs, escaped layer/palette ranges, invalid glyphs and truncated metadata', () => {
  for (const colr of [
    {bases: [{glyphId: 2, first: 0, count: 1}, {glyphId: 1, first: 0, count: 1}]},
    {bases: [{glyphId: 1, first: 2, count: 1}]}, {layers: [[65535, 0], [2, 0]]}, {layers: [[2, 2], [3, 0]]}
  ]) assert.throws(() => new ColorFont(colorFontTables({colr, cpal: {}})), corruption);
  assert.throws(() => new ColorFont(colorFontTables({colr: {}, cpal: {starts: [3]}})), corruption);
  for (const [tag, value] of [['COLR', makeColr().slice(0, 13)], ['CPAL', makeCpal().slice(0, 10)]]) {
    assert.throws(() => new ColorFont(colorFontTables({colr: {}, cpal: {}, edit: tables => tables.set(tag, value)})), corruption);
  }
});

test('PNG extraction rejects corrupt signatures, CRCs, dimensions, missing ends and unsupported metadata chunks', () => {
  const brokenSignature = glyphPng(); brokenSignature[0] = 0;
  const brokenCrc = glyphPng(); brokenCrc[29] ^= 1;
  for (const png of [brokenSignature, brokenCrc, glyphPng(3, 1), glyphPng().slice(0, -12)]) {
    const color = new ColorFont(colorFontTables({strikes: [{png}]}));
    assert.throws(() => color.bitmap(1, 12), corruption);
  }
  const png = glyphPng(2, 1, {extra: [chunk('tEXt', Uint8Array.of(65, 0, 66))]});
  assert.throws(() => new ColorFont(colorFontTables({strikes: [{png}]})).bitmap(1, 12), unsupported);
  const srgb = glyphPng(2, 1, {extra: [chunk('sRGB', Uint8Array.of(0))]});
  assert.deepEqual(new ColorFont(colorFontTables({strikes: [{png: srgb}]})).bitmap(1, 12).png, srgb);
});

test('sparse CBLC tables reject duplicate IDs and PNG headers cannot escape their glyph extent', () => {
  for (const format of [4, 5]) {
    assert.throws(() => new ColorFont(colorFontTables({strikes: [{format, ids: [1, 3], imageFormat: format === 5 ? 19 : 17}],
      edit(tables) {
        const table = new DataView(tables.get('CBLC').buffer);
        table.setUint16(format === 4 ? 80 : 90, 1);
      }})), corruption);
  }
  const tooLong = colorFontTables({strikes: [{}], edit(tables) {
    new DataView(tables.get('CBDT').buffer).setUint32(9, 0x10000);
  }});
  assert.throws(() => new ColorFont(tooLong).bitmap(1, 12), corruption);
  const zeroWidth = colorFontTables({strikes: [{}], edit: tables => { tables.get('CBDT')[5] = 0; }});
  assert.throws(() => new ColorFont(zeroWidth).bitmap(1, 12), corruption);
});

test('color glyph budgets and caller inputs fail closed without allocating unbounded metadata', () => {
  const font = colorFontTables({strikes: [{}], colr: {}, cpal: {}});
  for (const options of [{maxGlyphs: 0}, {maxGlyphs: 15}, {maxLayers: 1}, {maxImageBytes: 10}, {maxImageBytes: Infinity}]) {
    assert.throws(() => new ColorFont(font, options), corruption);
  }
  const repeated = colorFontTables({strikes: Array.from({length: 17}, (_, index) => ({ppem: index + 1}))});
  assert.throws(() => new ColorFont(repeated, {maxGlyphs: 16}), corruption);
  const color = new ColorFont(font);
  for (const glyph of [-1, 16, 0.5, NaN]) assert.throws(() => color.bitmap(glyph, 16), corruption);
  for (const ppem of [0, -1, Infinity, NaN, '16']) assert.throws(() => color.bitmap(1, ppem), corruption);
});
