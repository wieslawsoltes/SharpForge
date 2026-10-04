import {DrawOp, DrawingError} from '../drawing/commands.js';

const operations = ['vector', 'text', 'image', 'clip', 'opacity', 'effect', 'analytic'];

/** The probe observes the app's acquired device; it never creates an extra adapter/device for a surface. */
export function probeRenderingCapabilities({deviceService, canvas, disabledOperations = []} = {}) {
  const device = deviceService?.device;
  const limits = device?.limits ?? {};
  const disabled = new Set(disabledOperations);
  const supported = Object.fromEntries(operations.map(operation => [operation, Boolean(device) && !disabled.has(operation)]));
  if (device && (limits.maxVertexAttributes ?? 16) < 8) supported.analytic = false;
  if (device && (limits.maxTextureDimension2D ?? 8192) < 1) supported.image = supported.text = supported.effect = false;
  return Object.freeze({version: 1, webgpu: Boolean(device), canvas2d: Boolean(canvas?.ownerDocument || canvas?.getContext),
    svg: Boolean(canvas?.ownerDocument?.createElementNS), nativeText: Boolean(canvas?.ownerDocument?.createRange),
    state: deviceService?.state ?? 'unavailable', epoch: deviceService?.epoch ?? 0,
    features: Object.freeze(Array.from(device?.features ?? [])), limits: Object.freeze({
      maxTextureDimension2D: limits.maxTextureDimension2D ?? 0, maxBufferSize: limits.maxBufferSize ?? 0,
      maxVertexAttributes: limits.maxVertexAttributes ?? 0}), operations: Object.freeze(supported)});
}

export function drawingOperationClass(command) {
  if (command.op === DrawOp.GlyphRun) return 'text';
  if (command.op === DrawOp.Image) return 'image';
  if (command.op === DrawOp.PushClip) return 'clip';
  if (command.op === DrawOp.PushOpacity) return 'opacity';
  if (command.op === DrawOp.Layer) return 'effect';
  return 'vector';
}

export function selectOperationBackend(operation, capabilities, preferred = 'auto') {
  if (!operations.includes(operation)) throw new DrawingError('SFRENDER106', `Unknown operation class ${operation}`);
  if (!['auto', 'webgpu', 'canvas2d', 'dom'].includes(preferred)) throw new DrawingError('SFRENDER106', 'Unknown backend preference');
  if (['auto', 'webgpu'].includes(preferred) && capabilities.webgpu && capabilities.operations[operation]) return {backend: 'webgpu', reason: ''};
  if (preferred !== 'dom' && capabilities.canvas2d) return {backend: 'canvas2d', reason:
    preferred === 'canvas2d' ? 'Canvas2D was explicitly selected' : `${operation} is unavailable on the acquired WebGPU device`};
  if (capabilities.svg) return {backend: 'dom', reason: preferred === 'dom' ? 'DOM/SVG was explicitly selected' : 'Canvas2D is unavailable'};
  throw new DrawingError('SFRENDER106', `No backend supports ${operation}`);
}
