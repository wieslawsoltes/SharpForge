import {DrawingContext, TextLayoutService, createPortableTextProvider, bundledTextFixtures, Canvas2DBackend} from '@sharpforge/rendering';
import {canvasPixels} from '../rgba.js';

const maximumAssetBytes = 8 * 1024 * 1024;

function canvasFactory(document) {
  return (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
}

function fixtureLoader(base) {
  const prefix = new URL('packages/rendering/vendor/', base);
  return async (input, {signal} = {}) => {
    const url = new URL(input, base);
    if (url.origin !== prefix.origin || !url.pathname.startsWith(prefix.pathname) || url.username || url.password) {
      throw new TypeError('Text fixture assets must come from the local pinned vendor directory');
    }
    const response = await fetch(url, {signal, credentials: 'omit', redirect: 'error'});
    if (!response.ok || Number(response.headers.get('Content-Length')) > maximumAssetBytes) throw new Error('Text fixture asset load failed');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > maximumAssetBytes) throw new RangeError('Text fixture asset byte budget exceeded');
    return bytes;
  };
}

function verifyNumericBackend(surface, definition, evidence) {
  if (!surface) throw new Error('Numeric text fixture requires a retained rendering surface');
  if (surface.backend !== 'webgpu') return {...evidence, observedGlyphInstances: null, observedColorGlyphInstances: null};
  const commands = surface.renderer.plan?.root.commands ?? [];
  let observedGlyphInstances = 0, observedColorGlyphInstances = 0;
  for (const command of commands) {
    const mesh = command.mesh;
    if (command.kind !== 'draw' || mesh?.kind !== 'glyph') continue;
    observedGlyphInstances += mesh.count;
    const stride = mesh.data.length / mesh.count;
    for (let index = 0; index < mesh.count; index++) if (mesh.data[index * stride + 18] === 1) observedColorGlyphInstances++;
  }
  if (!observedGlyphInstances) throw new Error('HarfBuzz fixture did not exercise the numeric GPU glyph pipeline');
  if (definition.colorGlyphs && !observedColorGlyphInstances) throw new Error('Color glyph fixture rendered no intrinsic RGBA instances');
  return {...evidence, observedGlyphInstances, observedColorGlyphInstances};
}

function canvasReference(createCanvas, textService, list, resources, definition) {
  const canvas = createCanvas(1, 1);
  const renderer = new Canvas2DBackend(canvas, {createCanvas, textService});
  try {
    renderer.render(list, resources, {width: definition.width, height: definition.height, dpr: definition.dpr ?? 1,
      blendColorSpace: definition.blendColorSpace ?? 'srgb'});
    return {kind: 'canvas2d-numeric-outline', provider: 'harfbuzz', glyphAccess: 'numeric-glyphs', ...canvasPixels(canvas)};
  } finally {
    renderer.dispose();
    canvas.width = canvas.height = 0;
  }
}

/** Real pinned HarfBuzz shaping, numeric outline/color rasterization and a same-run Canvas reference; no system-font fallback. */
export async function createNumericTextFixture(definition, {document, resources}) {
  const base = new URL('../../../', import.meta.url), createCanvas = canvasFactory(document);
  const assets = bundledTextFixtures(base);
  const provider = await createPortableTextProvider({...assets, loadBinary: fixtureLoader(base), createCanvas});
  const textService = new TextLayoutService(provider);
  try {
    const value = definition.text ?? 'AV fi A\u0301\nمرحبا אבג\nकर्म 👩‍💻';
    const run = await textService.shape(value, {fontFamily: 'SharpForge Sans Fixture', fontSize: definition.fontSize,
      fontWeight: definition.fontWeight ?? 400, fontStyle: definition.fontStyle ?? 'normal',
      width: definition.width - 16, lineHeight: definition.fontSize * 1.3, underline: !!definition.underline});
    if (provider.kind !== 'harfbuzz' || run.glyphAccess !== 'numeric-glyphs' || !run.glyphs?.length) {
      throw new Error('Numeric text fixture requires the real HarfBuzz glyph provider');
    }
    const context = new DrawingContext({elementId: definition.id, version: 1});
    context.DrawGlyphRun(resources.register('glyphRun', run), [4.25, 4.5], definition.foreground ?? '#285880');
    const list = context.finish([0, 0, definition.width, definition.height]);
    const evidence = {provider: provider.kind, glyphAccess: run.glyphAccess, glyphCount: run.glyphs.length,
      fontIds: [...new Set(run.glyphs.map(glyph => glyph.fontId))], fontSize: definition.fontSize,
      fontWeight: definition.fontWeight ?? 400, fontStyle: definition.fontStyle ?? 'normal',
      harfBuzzJsVersion: '0.8.0', assetSha256: assets.fonts.map(font => font.sha256)};
    return {list, width: definition.width, height: definition.height, textService,
      verify: surface => verifyNumericBackend(surface, definition, evidence),
      reference: () => canvasReference(createCanvas, textService, list, resources, definition),
      dispose: () => textService.dispose()};
  } catch (error) {
    textService.dispose();
    throw error;
  }
}
