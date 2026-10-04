const fontFamily = 'SharpForge Sans Fixture';
export const residentGlyphCount = 5000;
export const glyphIdentity = glyph => JSON.stringify([glyph.fontId, glyph.glyphId, glyph.fontSize]);

/** Collect authentic HarfBuzz output for distinct face/variation/glyph pairs; never fabricate a glyph index. */
export async function residentGlyphs(textService, {fontSize = 16, signal, yieldFrame = async () => {}} = {}) {
  signal?.throwIfAborted();
  if (fontSize !== 16 || textService.provider?.kind !== 'harfbuzz') {
    throw new TypeError('The atlas residency corpus requires the pinned HarfBuzz provider at 16 DIP');
  }
  const corpus = Array.from({length: 94}, (_, index) => String.fromCharCode(index + 33)).join(' ');
  const glyphs = [], identities = new Set();
  for (let instance = 0; instance < 64 && glyphs.length < residentGlyphCount; instance++) {
    signal?.throwIfAborted();
    const run = await textService.shape(corpus, {fontFamily, fontSize, fontWeight: 100 + 800 * instance / 63,
      direction: 'ltr', wrapping: 'nowrap', features: {liga: 0, clig: 0, kern: 0}, signal});
    if (run.glyphAccess !== 'numeric-glyphs' || run.provider !== 'harfbuzz') throw new Error('Atlas corpus lost numeric shaping provenance');
    for (const glyph of run.glyphs) {
      const bounds = textService.provider.glyphBounds(glyph), key = glyphIdentity(glyph);
      if (!glyph.glyphId || !bounds.width || !bounds.height || identities.has(key)) continue;
      identities.add(key);
      glyphs.push({...glyph});
      if (glyphs.length === residentGlyphCount) break;
    }
    if (instance % 8 === 7) await yieldFrame();
  }
  signal?.throwIfAborted();
  if (glyphs.length !== residentGlyphCount) throw new Error('Pinned fonts did not provide 5000 distinct nonempty font-instance/glyph pairs');
  return glyphs;
}

/** This atlas workload intentionally positions shaped glyphs in cells; it does not claim normal text line-layout semantics. */
export function residentGrid(glyphs, provider, {width = 2400, height = 1400} = {}) {
  if (glyphs.length !== residentGlyphCount || width !== 2400 || height !== 1400) {
    throw new RangeError('The 5000 glyph residency viewport is 2400×1400 DIP');
  }
  const positioned = glyphs.map((glyph, index) => {
    const bounds = provider.glyphBounds(glyph);
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
        bounds.width <= 0 || bounds.height <= 0 || Math.ceil(bounds.width) > 20 || Math.ceil(bounds.height) > 24) {
      throw new Error('Pinned glyph ink exceeds its stress cell; change the reviewed corpus rather than clipping the reference');
    }
    return {...glyph, x: index % 100 * 24 + 2 - Math.floor(bounds.x),
      y: Math.floor(index / 100) * 28 + 2 - Math.floor(bounds.y)};
  });
  return glyphRun(positioned, width, height, provider);
}

export function glyphRun(glyphs, width, height, provider) {
  return {kind: 'glyphRun', text: '', width, height, inkBounds: [0, 0, width, height],
    glyphs, lines: [], clusters: [], decorations: [], glyphAccess: 'numeric-glyphs',
    clusterAccess: 'explicit-glyph-grid', provider: 'harfbuzz', providerVersion: provider.version,
    version: provider.fontVersion, positioning: 'explicit-grid-from-real-shaping'};
}

/** Bounded new raster-size identities cause actual cache pressure without allocating an oversized live text plan. */
export function pressureRun(glyphs, provider, pass, dimensions) {
  if (!Number.isInteger(pass) || pass < 0 || pass >= 16) throw new RangeError('Invalid atlas pressure pass');
  const selected = [];
  let pixels = 0;
  for (let index = 0; index < 512; index++) {
    const original = glyphs[(pass * 512 + index) % glyphs.length];
    const glyph = {...original, fontSize: 96 + pass, x: index % 32 * 75, y: Math.floor(index / 32) * 87 + 84};
    const bounds = provider.glyphBounds(glyph);
    pixels += (Math.ceil(bounds.width) + 5) * (Math.ceil(bounds.height) + 5);
    selected.push(glyph);
    if (pixels >= 1024 * 1024) break;
  }
  return {run: glyphRun(selected, dimensions.width, dimensions.height, provider), declaredRasterPixels: pixels};
}
