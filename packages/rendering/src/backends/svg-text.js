import {DrawingError} from '../drawing/commands.js';
import {cssColor} from '../media/colors.js';
import {colorGlyphOpacity} from '../text/portable-paint.js';

/** SVG retains actual HarfBuzz glyph outlines; embedded bitmap glyphs preserve the font's intrinsic pixels. */
export function drawSvgGlyphs(backend, parent, command, run, resources, options) {
  const provider = backend.textService?.provider;
  if (typeof provider?.glyphPath !== 'function') throw new DrawingError('SFRENDER085', 'Numeric SVG text needs the matching font provider');
  const group = backend.node('g', {transform: `translate(${command.origin.join(' ')})`}, parent);
  const bounds = [0, 0, run.width, run.height];
  for (const glyph of run.glyphs) {
    const fill = backend.paint(glyph.foreground ?? command.brush, bounds, resources, options);
    const opacity = colorGlyphOpacity(glyph.foreground ?? command.brush, resources, options.resolve);
    const layers = provider.glyphLayers?.(glyph);
    if (layers?.length) {
      for (const layer of layers) backend.node('path', {d: layer.path,
        transform: `translate(${glyph.x} ${glyph.y}) scale(${layer.scale} ${-layer.scale})`,
        fill: layer.color ? cssColor(layer.color) : fill, opacity: layer.color ? opacity : 1, 'fill-rule': 'nonzero'}, group);
      continue;
    }
    const outline = provider.glyphPath(glyph);
    if (outline.path) {
      backend.node('path', {d: outline.path, transform: `translate(${glyph.x} ${glyph.y}) scale(${outline.scale} ${-outline.scale})`,
        fill, 'fill-rule': 'nonzero'}, group);
      continue;
    }
    const image = provider.rasterizeGlyph(glyph, {dpr: options.dpr ?? 1, color: fill});
    if (!image.width || !image.height) continue;
    const imageGroup = backend.node('g', {opacity}, group);
    backend.drawImage(imageGroup, image, [glyph.x + image.logicalBounds.x, glyph.y + image.logicalBounds.y,
      image.logicalBounds.width, image.logicalBounds.height]);
  }
  for (const decoration of run.decorations ?? []) backend.node('rect', {x: decoration.rect[0], y: decoration.rect[1],
    width: decoration.rect[2], height: decoration.rect[3], fill: backend.paint(decoration.foreground ?? command.brush, bounds, resources, options)}, group);
}
