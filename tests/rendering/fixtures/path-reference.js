import {DrawingContext, parsePath, pathToSvg, geometryBounds, flattenGeometry, fillContains} from '@sharpforge/rendering';
import {pathCorpus} from './path-corpus.js';
import {canvasPixels} from '../rgba.js';

function pathElement(document, source, parent) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', source); parent.append(path); return path;
}

function compareValues(actual, expected, epsilon, label) {
  if (actual.length !== expected.length || actual.some((value, index) => Math.abs(value - expected[index]) > epsilon)) {
    throw new Error('Native SVG geometry mismatch: ' + label);
  }
}

function verifyGeometry(document, entries) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  Object.assign(svg.style, {position: 'absolute', left: '-10000px', visibility: 'hidden'});
  document.body.append(svg);
  const context = document.createElement('canvas').getContext('2d');
  let samples = 0, normalizedFigures = 0;
  try {
    for (const entry of entries) {
      const native = pathElement(document, entry.svg, svg), canonical = pathElement(document, pathToSvg(entry.geometry), svg);
      const box = native.getBBox();
      compareValues(entry.bounds, [box.x, box.y, box.width, box.height], 0.0001, entry.id + ' bounds');
      compareValues([canonical.getTotalLength()], [native.getTotalLength()], 0.001, entry.id + ' length');
      if (typeof native.getPathData === 'function') {
        const expected = native.getPathData({normalize: true}), actual = canonical.getPathData({normalize: true});
        if (expected.length !== actual.length) throw new Error('SVG normalized figure count mismatch: ' + entry.id);
        expected.forEach((segment, index) => {
          if (segment.type !== actual[index].type) throw new Error('SVG normalized command mismatch: ' + entry.id);
          compareValues(actual[index].values, segment.values, 0.0001, entry.id + ' normalized figures');
        });
        normalizedFigures++;
      }
      const contours = flattenGeometry(entry.geometry, {tolerance: 0.000001});
      const nativePath = new Path2D(entry.svg);
      const [x, y, width, height] = entry.bounds;
      for (let row = 0; row < 7; row++) for (let column = 0; column < 7; column++) {
        const point = [x - 1 + (column + 0.371) / 7 * (width + 2), y - 1 + (row + 0.619) / 7 * (height + 2)];
        if (fillContains(contours, point, {fillRule: entry.fillRule}) !== context.isPointInPath(nativePath, ...point, entry.fillRule)) {
          throw new Error('Canvas isPointInPath mismatch: ' + entry.id + ' at ' + point.join(','));
        }
        samples++;
      }
      native.remove(); canonical.remove();
    }
    const complete = normalizedFigures === entries.length;
    return {passed: complete, status: complete ? 'passed' : 'incomplete-native-figures',
      reason: complete ? null : 'SVGPathElement.getPathData({normalize:true}) is unavailable; figure parity is not established',
      paths: entries.length, pointInPathSamples: samples, reference: 'Native browser SVG and Path2D parsers',
      normalizedFigures: normalizedFigures === entries.length ? 'compared' : 'unavailable-native-getPathData',
      normalizedFigureCount: normalizedFigures,
      boundsTolerance: 0.0001, lengthTolerance: 0.001, flattenTolerance: 0.000001};
  } finally { svg.remove(); }
}

/** Browser-native Path2D renders the original source; it does not reuse SharpForge parsing or tessellation. */
export function createPathReferenceFixture(definition, {document}) {
  const entries = pathCorpus().map(entry => {
    const geometry = parsePath(entry.source), bounds = geometryBounds(geometry);
    return {...entry, geometry, bounds};
  });
  const context = new DrawingContext({elementId: definition.id, version: 1}), width = 640, height = 640;
  entries.forEach((entry, index) => {
    const [x, y, w, h] = entry.bounds, scale = Math.min(56 / Math.max(1, w), 56 / Math.max(1, h));
    entry.transform = [scale, 0, 0, scale, index % 10 * 64 + 4 - x * scale, Math.floor(index / 10) * 64 + 4 - y * scale];
    context.PushTransform(entry.transform); context.DrawGeometry(entry.geometry, '#285880'); context.Pop();
  });
  return {list: context.finish([0, 0, width, height]), width, height,
    verify: () => verifyGeometry(document, entries),
    reference() {
      const canvas = document.createElement('canvas'), dpr = definition.dpr ?? 1;
      canvas.width = Math.ceil(width * dpr); canvas.height = Math.ceil(height * dpr);
      const painter = canvas.getContext('2d'); painter.fillStyle = '#285880';
      for (const entry of entries) {
        painter.setTransform(...entry.transform.map(value => value * dpr));
        painter.fill(new Path2D(entry.svg), entry.fillRule);
      }
      try { return {kind: 'canvas2d-native-path', provider: 'browser-native-svg', glyphAccess: 'not-applicable', ...canvasPixels(canvas)}; }
      finally { canvas.width = canvas.height = 0; }
    }, dispose() { entries.length = 0; }};
}
