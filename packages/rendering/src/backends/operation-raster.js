import {DrawOp, DrawingError} from '../drawing/commands.js';
import {Canvas2DBackend} from './canvas2d.js';
import {IDENTITY} from '../media/transforms.js';

/** Rasterize only the negotiated operation/group, then composite its transparent result in the original painter position. */
export function rasterOperation(backend, commands, transform, resources, options, reason) {
  const createCanvas = backend.meshes.createCanvas;
  if (!createCanvas) throw new DrawingError('SFRENDER107', 'Operation fallback requires an offscreen raster provider');
  const canvas = createCanvas(backend.pixelWidth, backend.pixelHeight), adapter = new Canvas2DBackend(canvas,
    {createCanvas, textService: backend.textService, onFallback: backend.onFallback});
  try {
    adapter.render({commands: [{op: DrawOp.PushTransform, transform}, ...commands, {op: DrawOp.Pop}]}, resources, options);
    backend.onFallback({operation: reason.operation, backend: 'canvas2d', reason: reason.reason});
    return backend.meshes.image({image: {source: canvas, width: canvas.width, height: canvas.height},
      destination: [0, 0, options.width, options.height], options: {}}, IDENTITY, null);
  } finally { adapter.dispose(); }
}
