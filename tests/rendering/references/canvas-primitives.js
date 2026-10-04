import {canvasPixels} from '../rgba.js';
import {geometryMatrix} from '../fixtures/geometry-matrix.js';

export function referenceCanvas(document, definition) {
  const canvas = document.createElement('canvas');
  const dpr = definition.dpr ?? 1;
  canvas.width = Math.ceil(definition.width * dpr);
  canvas.height = Math.ceil(definition.height * dpr);
  const painter = canvas.getContext('2d');
  if (!painter) throw new Error('Native Canvas2D reference is unavailable');
  painter.scale(dpr, dpr);
  return {canvas, painter};
}

export function canvasReferencePacket(canvas, details = {}) {
  return {kind: 'canvas2d-declared-scene', provider: 'browser-native-canvas', glyphAccess: 'not-applicable',
    input: 'fixture-declaration', sharedRendererCode: false, ...details, ...canvasPixels(canvas)};
}

export function roundedPath(painter, rect, radii) {
  const values = Array.isArray(radii) ? radii : [radii, radii, radii, radii];
  const corners = values.length === 8
    ? [0, 2, 4, 6].map(index => ({x: values[index], y: values[index + 1]})) : values;
  painter.beginPath();
  painter.roundRect(...rect, corners);
}

function ellipse(painter, rect) {
  painter.beginPath();
  painter.ellipse(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2, rect[2] / 2, rect[3] / 2, 0, 0, Math.PI * 2);
}

function horizontalGradient(painter, rect) {
  const brush = painter.createLinearGradient(rect[0], rect[1], rect[0] + rect[2], rect[1]);
  brush.addColorStop(0, '#ff0000');
  brush.addColorStop(1, '#0000ff');
  return brush;
}

export function imagePixels(document) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  const painter = canvas.getContext('2d');
  const image = painter.createImageData(2, 2);
  image.data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]);
  painter.putImageData(image, 0, 0);
  return canvas;
}

function paintMatrix(painter, definition) {
  for (const record of geometryMatrix(definition)) {
    painter.save();
    if (record.transform) painter.transform(...record.transform);
    if (record.kind === 'rounded') roundedPath(painter, record.rect, record.radii);
    if (record.kind === 'ellipse') ellipse(painter, record.rect);
    if (record.kind === 'line') {
      painter.beginPath();
      painter.moveTo(...record.start);
      painter.lineTo(...record.end);
    }
    if (record.brush) {
      painter.fillStyle = record.brush;
      painter.fill();
    }
    painter.lineWidth = record.strokeWidth;
    painter.lineCap = record.cap ?? 'butt';
    painter.strokeStyle = record.stroke;
    painter.stroke();
    painter.restore();
  }
}

const primitivePainters = {
    shapes(painter) {
      painter.fillStyle = '#ff4030';
      painter.fillRect(4, 4, 32, 24);
      painter.fillStyle = '#4090ff';
      roundedPath(painter, [44, 4, 32, 24], 6);
      painter.fill();
      painter.fillStyle = '#20c050';
      ellipse(painter, [84, 4, 32, 24]);
      painter.fill();
      painter.beginPath();
      painter.moveTo(10, 40);
      painter.lineTo(58, 40);
      painter.lineTo(30, 84);
      painter.closePath();
      painter.fillStyle = '#9040c0';
      painter.fill();
      painter.strokeStyle = '#202020';
      painter.lineWidth = 3;
      painter.lineJoin = 'round';
      painter.stroke();
    },
    strokes(painter) {
      painter.strokeStyle = '#202020';
      painter.lineWidth = 4;
      painter.lineCap = 'butt';
      painter.setLineDash([8, 4]);
      painter.beginPath();
      painter.moveTo(8, 12);
      painter.lineTo(112, 12);
      painter.stroke();
      painter.setLineDash([]);
      painter.lineWidth = 3;
      roundedPath(painter, [12, 28, 92, 48], [2, 6, 10, 14]);
      painter.stroke();
    },
    gradients(painter) {
      painter.fillStyle = horizontalGradient(painter, [4, 4, 120, 36]);
      painter.fillRect(4, 4, 120, 36);
      painter.save();
      painter.translate(28, 44);
      painter.scale(72, 44);
      const brush = painter.createRadialGradient(0.35, 0.5, 0, 0.5, 0.5, 0.5);
      brush.addColorStop(0, '#ffffff');
      brush.addColorStop(1, '#2080ff');
      painter.fillStyle = brush;
      ellipse(painter, [0, 0, 1, 1]);
      painter.fill();
      painter.restore();
    },
    images(painter, document) {
      const source = imagePixels(document);
      painter.imageSmoothingEnabled = false;
      painter.drawImage(source, 8, 8, 64, 64);
      painter.imageSmoothingEnabled = true;
      painter.globalAlpha = 0.5;
      painter.drawImage(source, 80, 8, 32, 64);
      source.width = source.height = 0;
    },
    clips(painter) {
      ellipse(painter, [8, 8, 104, 72]);
      painter.clip();
      painter.transform(1, 0.2, -0.1, 1, 8, 4);
      painter.fillStyle = horizontalGradient(painter, [0, 0, 128, 96]);
      painter.fillRect(0, 0, 128, 96);
    },
    opacity(painter, document, definition) {
      const layer = referenceCanvas(document, definition);
      layer.painter.fillStyle = '#ff0000';
      layer.painter.fillRect(8, 8, 64, 56);
      layer.painter.fillRect(48, 28, 64, 56);
      painter.save();
      painter.setTransform(1, 0, 0, 1, 0, 0);
      painter.globalAlpha = 0.5;
      painter.drawImage(layer.canvas, 0, 0);
      painter.restore();
      layer.canvas.width = layer.canvas.height = 0;
    },
    'control-chrome'(painter, _document, definition) {
      const width = definition.width;
      const height = definition.height;
      painter.fillStyle = '#f8f8f8';
      roundedPath(painter, [1, 1, width - 2, height - 2], 3);
      painter.fill();
      const border = new Path2D();
      border.roundRect(0, 0, width, height, 4);
      border.roundRect(1, 1, width - 2, height - 2, 3);
      painter.fillStyle = '#808080';
      painter.fill(border, 'evenodd');
    },
    'instances-10k'(painter) {
      for (let index = 0; index < 10000; index++) {
        painter.fillStyle = index % 2 ? '#3080d0' : '#80c030';
        painter.fillRect(index % 100 * 10, Math.floor(index / 100) * 10, 8, 8);
      }
    },
    'instances-100k'(painter) {
      painter.fillStyle = '#3080d0';
      for (let index = 0; index < 100000; index++) painter.fillRect(index % 400 * 2, Math.floor(index / 400) * 2, 1.5, 1.5);
    },
    'rounded-matrix': (painter, _document, definition) => paintMatrix(painter, definition),
    'ellipse-lines': (painter, _document, definition) => paintMatrix(painter, definition),
    'alpha-overlap'(painter, _document, definition) {
      for (const record of definition.overlaps) {
        painter.fillStyle = record.color;
        painter.globalAlpha = record.opacity;
        painter.fillRect(...record.rect);
      }
    }
};

/** Independently authored browser drawing instructions, never a replay of the implementation's display list. */
export function paintPrimitiveReference(document, definition) {
  const {canvas, painter} = referenceCanvas(document, definition);
  try {
    const build = primitivePainters[definition.scene];
    if (!build) return null;
    build(painter, document, definition);
    return canvasReferencePacket(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
