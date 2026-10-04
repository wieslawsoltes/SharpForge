import {DrawingContext, RenderSurface, ResourceTable, TextLayoutService, createPortableTextProvider,
  bundledTextFixtures, parsePath, hitTestText, selectionRectangles} from '@sharpforge/rendering';

/** Standalone drawing sample. The host supplies authorized asset loading and explicit DIP dimensions. */
export async function createPortableDrawing(container, {assetBase, loadBinary, backend = 'auto', width = 640, height = 320, signal} = {}) {
  const createCanvas = (w, h) => {
    const canvas = container.ownerDocument.createElement('canvas'); canvas.width = w; canvas.height = h; return canvas;
  };
  const provider = await createPortableTextProvider({...bundledTextFixtures(assetBase), loadBinary, createCanvas, signal});
  const text = new TextLayoutService(provider), resources = new ResourceTable();
  let surface;
  try {
    const run = await text.shape('Portable office\nالسَّلَامُ  אבג\nक्षि  👩‍💻', {fontFamily: 'SharpForge Sans Fixture',
      fontSize: 24, width: width - 80, lineHeight: 42, signal});
    const accent = resources.register('brush', {kind: 'solid', color: '#2070d0', opacity: 1});
    const context = new DrawingContext({elementId: 'portable-example', version: 1});
    context.DrawRoundedRectangle([12, 12, width - 24, height - 24], [16, 8, 16, 8], '#f8f8fc', {brush: accent, width: 2});
    context.DrawGeometry(parsePath('M24 250q32-32 64 0t64 0'), null, {brush: accent, width: 4,
      startCap: 'round', endCap: 'round', dashArray: [3, 1]});
    context.DrawGlyphRun(resources.register('glyphRun', run), [40, 32], '#202030');
    const list = context.finish([0, 0, width, height]);
    surface = new RenderSurface(container, {backend, resources, textService: text});
    await surface.ready;
    surface.updateDisplayList(list, resources, width, height, container.ownerDocument.defaultView.devicePixelRatio || 1);
    return {surface, displayList: list,
      setAccent(color) { resources.update(accent, {kind: 'solid', color, opacity: 1}); surface.draw(); },
      hitTest(x, y) { return hitTestText(run, x - 40, y - 32); },
      selection(start, end) { return selectionRectangles(run, start, end).map(rect => [rect[0] + 40, rect[1] + 32, rect[2], rect[3]]); },
      dispose() { surface.dispose(); text.dispose(); resources.dispose(); }};
  } catch (error) { surface?.dispose(); text.dispose(); resources.dispose(); throw error; }
}
