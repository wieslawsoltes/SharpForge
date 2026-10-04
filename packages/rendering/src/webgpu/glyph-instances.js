import {DrawOp, DrawingError} from '../drawing/commands.js';
import {normalizeBrush} from '../brushes/brushes.js';
import {glyphInstanceFloats} from './glyph-shader.js';

function prepareGlyphs(run, command, resources, options) {
  if (!Array.isArray(run.glyphs) || run.glyphs.length > 100000) throw new DrawingError('SFRENDER133', 'Numeric glyph run exceeds its budget');
  const prepared = [];
  for (const glyph of run.glyphs) {
    if (![glyph.x, glyph.y, ...command.origin].every(value => Number.isFinite(value) && Math.abs(value) <= 1000000)) {
      throw new DrawingError('SFRENDER133', 'Numeric glyph run has invalid positioned origins');
    }
    const brush = normalizeBrush(glyph.foreground ?? glyph.color ?? command.brush, resources, options.resolve);
    if (brush && brush.kind !== 'solid') return null;
    if (brush && brush.color[3] * brush.opacity) prepared.push({glyph, brush,
      x: command.origin[0] + glyph.x, y: command.origin[1] + glyph.y});
  }
  return prepared;
}

function writeInstance(data, offset, item, transform) {
  const {entry, brush, x, y} = item;
  const bounds = entry.metrics.bounds;
  data.set([x + bounds.x, y + bounds.y, bounds.width, bounds.height], offset);
  data.set(entry.uv, offset + 4);
  data.set([brush.color[0], brush.color[1], brush.color[2], brush.color[3] * brush.opacity], offset + 8);
  data.set(transform.slice(0, 4), offset + 12);
  data.set([transform[4], transform[5], Number(entry.metrics.colorGlyph), 0], offset + 16);
}

function glyphBatches(builder, items, transform) {
  const output = [];
  for (let start = 0; start < items.length;) {
    const page = items[start].entry.page;
    let end = start + 1;
    while (end < items.length && items[end].entry.page === page) end++;
    const data = new Float32Array((end - start) * glyphInstanceFloats);
    for (let index = start; index < end; index++) writeInstance(data, (index - start) * glyphInstanceFloats, items[index], transform);
    output.push({kind: 'glyph', data, count: end - start, texture: builder.atlasTexture(page)});
    start = end;
  }
  return output;
}

function decorate(builder, {run, command, transform, resources, options}, output) {
  if (run.decorations != null && (!Array.isArray(run.decorations) || run.decorations.length > 100000)) {
    throw new DrawingError('SFRENDER133', 'Invalid text decoration count');
  }
  for (const decoration of run.decorations ?? []) {
    const rect = decoration.rect;
    if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] < 0 || rect[3] < 0) {
      throw new DrawingError('SFRENDER133', 'Invalid text decoration bounds');
    }
    const placed = [rect[0] + command.origin[0], rect[1] + command.origin[1], rect[2], rect[3]];
    output.push(...builder.build({op: DrawOp.Rectangle, rect: placed, brush: decoration.foreground ?? command.brush},
      transform, resources, options));
  }
}

/** Returns null for the intact-run fallback; numeric glyphs otherwise keep shaping order in adjacent atlas-page batches. */
export function buildGlyphInstances(builder, {run, command, transform, resources, options}) {
  const provider = builder.textService?.provider;
  if (!builder.atlas || !run.glyphs || typeof provider?.rasterizeGlyph !== 'function') return null;
  const prepared = prepareGlyphs(run, command, resources, options);
  if (!prepared) return null;
  if (prepared.some(item => provider.canInstanceGlyph?.(item.glyph) === false)) {
    builder.onFallback({operation: 'glyph-run', backend: 'canvas2d', reason: 'Color font foreground layers require intact painted run rasterization'});
    return null;
  }
  const temporaryPins = new Set(), items = [];
  const scale = Math.max(Math.hypot(transform[0], transform[1]), Math.hypot(transform[2], transform[3]));
  const dpr = Math.max(0.25, Math.min(8, options.dpr * scale));
  try {
    for (const item of prepared) {
      const worldX = (transform[0] * item.x + transform[2] * item.y + transform[4]) * options.dpr;
      const worldY = (transform[1] * item.x + transform[3] * item.y + transform[5]) * options.dpr;
      const entry = builder.atlas.getGlyph(item.glyph, {provider, dpr,
        subpixelX: worldX - Math.floor(worldX), subpixelY: worldY - Math.floor(worldY)});
      if (entry.empty) continue;
      if (options.plan) options.plan.pinAtlas(entry.page);
      else if (!temporaryPins.has(entry.page)) { temporaryPins.add(entry.page); entry.page.pins++; }
      items.push({...item, entry});
    }
    const output = glyphBatches(builder, items, transform);
    decorate(builder, {run, command, transform, resources, options}, output);
    return output;
  } finally {
    for (const page of temporaryPins) page.pins--;
  }
}
