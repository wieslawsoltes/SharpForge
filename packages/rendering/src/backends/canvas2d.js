import {DrawOp, DrawingError, resolveResource} from '../drawing/commands.js';
import {IDENTITY, multiply} from '../media/transforms.js';
import {cssColor} from '../media/colors.js';
import {geometryBounds, flattenGeometry} from '../geometry/geometry-math.js';
import {LineGeometry, normalizeGeometry} from '../geometry/path-geometry.js';
import {normalizePen, strokeContours} from '../geometry/stroke.js';
import {imageRectangle, nineGridPatches} from '../media/images.js';
import {traceGeometry, traceContours} from './paths.js';
import {CanvasPaints} from './canvas-paint.js';
import {CanvasLayerRasters} from './canvas-layers.js';
import {LinearCanvasCompositor} from './linear-canvas.js';
import {blendColorSpace} from '../media/working-color.js';
import {renderViewport} from './viewport.js';
import {paintTextLayout} from '../text/rich-text.js';
import {colorGlyphOpacity} from '../text/portable-paint.js';

export function commandGeometry(command, resources, resolve) {
  if (command.op === DrawOp.Rectangle) return {kind: 'rectangle', rect: command.rect};
  if (command.op === DrawOp.RoundedRectangle) return {kind: 'rectangle', rect: command.rect, radii: command.radii};
  if (command.op === DrawOp.Ellipse) return {kind: 'ellipse', rect: command.rect};
  if (command.op === DrawOp.Line) return new LineGeometry(command.start, command.end);
  return normalizeGeometry(resolveResource(resources, command.geometry, 'geometry'), resolve);
}

/** Complete retained Canvas2D adapter. Opacity uses isolated layers, so overlapping children blend once. */
export class Canvas2DBackend {
  constructor(canvas, {createCanvas, textService, onFallback = () => {}, layerRasters} = {}) {
    this.canvas = canvas; this.context = canvas.getContext('2d');
    if (!this.context) throw new DrawingError('SFRENDER090', 'Canvas2D context is unavailable');
    this.createCanvas = createCanvas ?? ((width, height) => {
      const child = canvas.ownerDocument.createElement('canvas'); child.width = width; child.height = height; return child;
    });
    this.textService = textService; this.onFallback = onFallback; this.paints = new CanvasPaints(this.createCanvas);
    this.backend = 'canvas2d'; this.closed = false;
    this.ownsLayerRasters = !layerRasters;
    this.layerRasters = layerRasters ?? new CanvasLayerRasters({createCanvas: this.createCanvas,
      createRenderer: (canvas, cache) => new Canvas2DBackend(canvas,
        {createCanvas: this.createCanvas, textService: this.textService, onFallback: this.onFallback, layerRasters: cache})});
  }

  render(list, resources, options = {}) {
    if (this.closed) throw new DrawingError('SFRENDER091', 'Canvas2D backend is disposed');
    if ((options.layerDepth ?? 0) > 64) throw new DrawingError('SFRENDER130', 'Canvas layer nesting budget exceeded');
    options = {...options, textVersion: options.textVersion ?? this.textService?.provider?.fontVersion ?? 0};
    const {width, height, dpr, pixelWidth, pixelHeight} = renderViewport(options, {width: this.canvas.width, height: this.canvas.height});
    if (blendColorSpace(options.blendColorSpace) === 'linear') {
      this.linear ??= new LinearCanvasCompositor({createCanvas: this.createCanvas,
        createRenderer: canvas => new Canvas2DBackend(canvas, {createCanvas: this.createCanvas,
          textService: this.textService, onFallback: this.onFallback})});
      return this.linear.render(this.canvas, list, resources, {...options, width, height, dpr});
    }
    const resized = this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight;
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    let context = this.context, transform = IDENTITY;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    context.save();
    if (!resized && options.clear === false && options.damage) {
      context.beginPath(); context.rect(...options.damage); context.clip(); context.clearRect(...options.damage);
    } else if (resized || options.clear !== false) context.clearRect(0, 0, width, height);
    const stack = [], drawOptions = {...options, width, height, dpr, onFallback: this.onFallback};
    try {
    for (const command of list.commands) {
      if (command.op === DrawOp.PushTransform) {
        stack.push({kind: 'state', transform}); context.save(); context.transform(...command.transform);
        transform = multiply(transform, command.transform); continue;
      }
      if (command.op === DrawOp.PushClip) {
        stack.push({kind: 'state', transform}); context.save();
        const path = traceGeometry(context, normalizeGeometry(resolveResource(resources, command.geometry, 'geometry'), options.resolve), {filledOnly: true});
        context.clip(path.fillRule ?? 'evenodd'); continue;
      }
      if (command.op === DrawOp.PushOpacity) {
        const layer = this.createCanvas(pixelWidth, pixelHeight), child = layer.getContext('2d');
        child.setTransform(dpr * transform[0], dpr * transform[1], dpr * transform[2], dpr * transform[3], dpr * transform[4], dpr * transform[5]);
        stack.push({kind: 'opacity', context, transform, layer, opacity: command.opacity}); context = child; continue;
      }
      if (command.op === DrawOp.Pop) {
        const state = stack.pop();
        if (!state) throw new DrawingError('SFRENDER010', 'Drawing stack underflow');
        if (state.kind === 'opacity') {
          context = state.context; context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
          context.globalAlpha *= state.opacity; context.drawImage(state.layer, 0, 0); context.restore();
        } else context.restore();
        transform = state.transform; continue;
      }
      this.draw(context, command, resources, drawOptions);
    }
    if (stack.length) throw new DrawingError('SFRENDER011', 'Unbalanced drawing stack');
    return {backend: 'canvas2d', commands: list.commands.length, pixelWidth, pixelHeight, sampleCount: 1};
    } finally {
      while (stack.length) {
        const state = stack.pop();
        if (state.kind === 'opacity') context = state.context;
        else context.restore();
      }
      this.context.restore();
    }
  }

  draw(context, command, resources, options) {
    if (command.op === DrawOp.Clear) {
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      context.fillStyle = cssColor(command.color); context.fillRect(0, 0, this.canvas.width, this.canvas.height); context.restore(); return;
    }
    if (command.op === DrawOp.Image) return this.drawImage(context, resolveResource(resources, command.image, 'image'), command.destination, command.options);
    if (command.op === DrawOp.GlyphRun) return this.drawText(context, command, resources, options);
    if (command.op === DrawOp.Layer) {
      const layer = resolveResource(resources, command.layer, 'layer');
      if (layer?.displayList) {
        const raster = this.layerRasters.acquire({...layer, effect: command.options?.effect ?? layer.effect,
          shadow: command.options?.shadow ?? layer.shadow}, resources,
        {...options, blendColorSpace: options.layerBlendColorSpace ?? options.blendColorSpace, layerDepth: (options.layerDepth ?? 0) + 1});
        if (!raster) return;
        context.save();
        context.globalAlpha *= command.options?.opacity ?? layer.opacity ?? 1;
        if (command.options?.transform ?? layer.transform) context.transform(...(command.options?.transform ?? layer.transform));
        context.drawImage(raster.canvas, ...raster.bounds);
        context.restore();
        if (raster.transient) raster.canvas.width = raster.canvas.height = 0;
      } else if (layer?.source) this.drawImage(context, layer, command.options?.destination ?? [0, 0, layer.width, layer.height], command.options);
      else throw new DrawingError('SFRENDER093', 'Layer resource requires a display list or raster image');
      return;
    }
    const geometry = commandGeometry(command, resources, options.resolve), bounds = geometryBounds(geometry);
    const brush = this.paints.get(context, command.brush, bounds, resources, options);
    if (brush) { const path = traceGeometry(context, geometry, {filledOnly: true}); context.fillStyle = brush; context.fill(path.fillRule ?? 'evenodd'); }
    const pen = normalizePen(resolveResource(resources, command.pen, 'pen'));
    if (pen?.width) {
      const paint = this.paints.get(context, pen.brush, bounds, resources, options);
      const contours = strokeContours(flattenGeometry(geometry, {tolerance: 0.15 / options.dpr}), pen, {tolerance: 0.15 / options.dpr});
      traceContours(context, contours); context.fillStyle = paint; context.fill('nonzero');
    }
  }

  drawImage(context, image, destination, options = {}) {
    if (!image) throw new DrawingError('SFRENDER066', 'Image resource is missing');
    let source = image.source;
    if (!source && image.pixels) {
      source = this.createCanvas(image.width, image.height);
      const raster = source.getContext('2d'), data = raster.createImageData(image.width, image.height);
      data.data.set(image.pixels); raster.putImageData(data, 0, 0);
    }
    if (!source) throw new DrawingError('SFRENDER066', 'Image resource is not decoded');
    context.save(); context.imageSmoothingEnabled = options.sampling !== 'nearest';
    context.globalAlpha *= options.opacity ?? 1;
    context.beginPath(); context.rect(...destination); context.clip();
    const patches = options.nineGrid ? nineGridPatches(image, destination, options.nineGrid) : [imageRectangle(image, destination, options)];
    for (const patch of patches) if (patch.source[2] && patch.source[3] && patch.destination[2] && patch.destination[3]) {
      context.drawImage(source, ...patch.source, ...patch.destination);
    }
    context.restore();
  }

  drawText(context, command, resources, options) {
    const run = resolveResource(resources, command.run, 'glyphRun');
    if (!run?.lines) throw new DrawingError('SFRENDER085', 'DrawGlyphRun requires shaped layout data');
    context.save(); context.translate(...command.origin); context.font = run.font; context.textBaseline = 'alphabetic';
    const paint = brush => this.paints.get(context, brush ?? command.brush, [0, 0, run.width, run.height], resources, options);
    try {
      if (run.glyphAccess === 'numeric-glyphs') {
        if (typeof this.textService?.provider?.paint !== 'function') {
          throw new DrawingError('SFRENDER085', 'Numeric Canvas text requires the matching font provider');
        }
        this.textService.provider.paint(context, run, {dpr: options.dpr, paint,
          opacity: value => colorGlyphOpacity(value ?? command.brush, resources, options.resolve)});
      } else paintTextLayout(context, run, {dpr: options.dpr, paint});
    } finally { context.restore(); }
  }
  dispose() { this.closed = true; this.paints.dispose(); if (this.ownsLayerRasters) this.layerRasters.dispose(); }
}
