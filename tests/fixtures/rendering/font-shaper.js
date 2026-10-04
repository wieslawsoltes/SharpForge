import {readFile} from 'node:fs/promises';
import {bundledTextFixtures} from '../../../packages/rendering/src/text/bundled-fixtures.js';
import {loadBundledHarfBuzz} from '../../../packages/rendering/src/text/harfbuzz-loader.js';
import {PortableFontRegistry} from '../../../packages/rendering/src/text/font-registry.js';
import {HarfBuzzShaper} from '../../../packages/rendering/src/text/harfbuzz-shaper.js';
import {textOptions, prepareText, shapeTextRange} from '../../../packages/rendering/src/text/text-items.js';

/** Actual item shaping without the higher-level line layout or glyph raster provider. */
export async function createFontShaper(options = {}) {
  const fixture = bundledTextFixtures(new URL('../../../', import.meta.url));
  const {hb, module} = await loadBundledHarfBuzz({wasmBinary: await readFile(new URL(fixture.wasmURL))});
  const descriptors = await Promise.all(fixture.fonts.map(async face => ({...face, bytes: await readFile(new URL(face.url))})));
  const fonts = new PortableFontRegistry(hb, descriptors, {module, ...options});
  const shaper = new HarfBuzzShaper({hb, module, ...options});
  return {fonts, shaper, shape(text, input = {}) {
    const prepared = prepareText(text, textOptions(input), fonts, {...options, signal: input.signal});
    shaper.begin(text);
    try { return shapeTextRange(prepared, shaper, 0, text.length, input.signal); }
    finally { shaper.end(); }
  }, dispose() { shaper.dispose(); fonts.dispose(); }};
}
