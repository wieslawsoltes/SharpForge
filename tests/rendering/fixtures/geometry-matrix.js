import {DrawingContext} from '@sharpforge/rendering';

export const radiusFractions = Object.freeze([0, 0.01, 0.05, 0.1, 0.25, 0.5]);
export const strokeWidths = Object.freeze([0.5, 1, 2, 5, 10, 20]);

/** The two renderers share input numbers only; the oracle uses native Canvas paths and strokes. */
export function geometryMatrix(definition) {
  const records = [];
  if (definition.scene === 'rounded-matrix') {
    for (const [row, strokeWidth] of strokeWidths.entries()) {
      for (const [column, radius] of radiusFractions.entries()) {
        const x = column * 112 + 24;
        const y = row * 88 + 24;
        const angle = [0, 17, -33][(row + column) % 3] * Math.PI / 180;
        records.push({kind: 'rounded', rect: [-32, -20, 64, 40],
          radii: [64 * radius, 40 * radius, 32 * radius, 20 * radius,
            64 * radius, 40 * radius, 16 * radius, 40 * radius],
          transform: [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), x + 32, y + 20],
          brush: '#4080c0', stroke: '#202020', strokeWidth, radiusFraction: radius});
      }
    }
  } else if (definition.scene === 'ellipse-lines') {
    for (const [index, strokeWidth] of strokeWidths.entries()) {
      records.push({kind: 'ellipse', rect: [24 + index * 104, 24, 64, 48],
        brush: null, stroke: '#204060', strokeWidth});
    }
    for (const [row, cap] of ['butt', 'round', 'square'].entries()) {
      for (const [column, strokeWidth] of strokeWidths.entries()) {
        records.push({kind: 'line', start: [24 + column * 104, 112 + row * 48],
          end: [80 + column * 104, 112 + row * 48], stroke: '#204060', strokeWidth, cap});
      }
    }
  } else {
    throw new TypeError('Unknown geometry matrix: ' + definition.scene);
  }
  return records;
}

export function createGeometryMatrix(definition) {
  const records = geometryMatrix(definition);
  const drawing = new DrawingContext({elementId: definition.id, version: 1});
  for (const record of records) {
    if (record.transform) drawing.PushTransform(record.transform);
    const pen = {brush: record.stroke, thickness: record.strokeWidth,
      startCap: record.cap ?? 'butt', endCap: record.cap ?? 'butt'};
    if (record.kind === 'rounded') drawing.DrawRoundedRectangle(record.rect, record.radii, record.brush, pen);
    if (record.kind === 'ellipse') drawing.DrawEllipse(record.rect, null, pen);
    if (record.kind === 'line') drawing.DrawLine(record.start, record.end, pen);
    if (record.transform) drawing.Pop();
  }
  return {list: drawing.finish([0, 0, definition.width, definition.height]), width: definition.width,
    height: definition.height, verify(surface) {
      const sampleCount = surface.backend === 'webgpu' ? surface.renderer.sampleCount : 1;
      if (![1, 4].includes(sampleCount)) throw new Error('The actual antialiasing sample count is unavailable');
      return {passed: true, cases: records.length, radiusFractions, strokeWidths,
        dpr: definition.dpr, sampleCount, reference: 'CanvasRenderingContext2D native paths and strokes'};
    }, dispose() {}};
}
