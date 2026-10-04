import {DrawOp, DrawingError, resolveResource} from '../drawing/commands.js';
import {normalizeBrush, brushMatrix} from '../brushes/brushes.js';
import {IDENTITY, inverse, transformPoint} from '../media/transforms.js';
import {geometryBounds, flattenGeometry} from '../geometry/geometry-math.js';
import {tessellateFill} from '../geometry/tessellation.js';
import {tessellateStroke, normalizePen} from '../geometry/stroke.js';
import {commandGeometry} from '../backends/canvas2d.js';
import {imageRectangle, nineGridPatches} from '../media/images.js';
import {GlyphAtlas} from '../text/glyph-atlas.js';
import {CanvasPaints} from '../backends/canvas-paint.js';
import {rasterizeBrush} from '../brushes/rasterizer.js';
import {buildGlyphInstances} from './glyph-instances.js';
import {colorGlyphOpacity} from '../text/portable-paint.js';

export const quadTriangles = rect => {
  const [x, y, width, height] = rect;
  return [x, y, x + width, y, x, y + height, x, y + height, x + width, y, x + width, y + height];
};

/** Encode vertices once per retained command version, keeping texture/paint order intact. */
export class MeshBuilder {
  constructor(textures, {textService, createCanvas, onFallback = () => {}} = {}) {
    this.textures = textures; this.textService = textService; this.onFallback = onFallback;
    this.white = null; this.meshCache = new WeakMap(); this.textCache = new WeakMap();
    this.createCanvas = createCanvas; this.nextText = 0;
    this.atlas = createCanvas ? new GlyphAtlas({createCanvas}) : null;
    this.paints = createCanvas ? new CanvasPaints(createCanvas) : null;
  }
  whiteTexture() {
    return this.textures.get('white', {width: 1, height: 1, pixels: new Uint8Array([255, 255, 255, 255]), alphaMode: 'premultiplied'});
  }
  atlasTexture(page) {
    const texture = this.textures.get(page, {source: page.canvas, width: this.atlas.size, height: this.atlas.size,
      version: page.version, appendOnly: true, dirtyRects: page.dirtyBounds ? [page.dirtyBounds] : []});
    page.dirtyBounds = null;
    return texture;
  }
  geometry(command, resources, options) {
    const cached = this.meshCache.get(command);
    if (cached && cached.dpr === options.dpr && !command.geometry?.id && !command.pen?.id) return cached;
    const geometry = commandGeometry(command, resources, options.resolve), bounds = geometryBounds(geometry);
    const contours = flattenGeometry(geometry, {tolerance: 0.15 / options.dpr});
    const pen = normalizePen(resolveResource(resources, command.pen, 'pen'));
    const fill = command.brush ? command.op === DrawOp.Rectangle ? quadTriangles(command.rect) :
      tessellateFill(contours, geometry.fillRule ?? 'evenodd') : null;
    const stroke = pen?.width ? tessellateStroke(contours, pen, {tolerance: 0.15 / options.dpr}) : null;
    const entry = {bounds, fill, stroke, pen, dpr: options.dpr}; this.meshCache.set(command, entry); return entry;
  }

  paint(input, bounds, resources, options) {
    const brush = normalizeBrush(input, resources, options.resolve);
    if (!brush) return null;
    if (brush.kind === 'solid') return {texture: this.whiteTexture(), color: [...brush.color.slice(0, 3), brush.color[3] * brush.opacity],
      uv: () => [0.5, 0.5], paint: [0, 0, 0, 0]};
    if (['acrylic', 'backdrop', 'mask', 'nine-grid', 'effect'].includes(brush.kind)) {
      if (!this.createCanvas) throw new DrawingError('SFRENDER104', 'Complex brush requires a compositor or raster provider');
      const image = rasterizeBrush(brush, bounds, resources, {...options, createCanvas: this.createCanvas,
        backend: 'webgpu', onFallback: this.onFallback});
      this.onFallback({operation: brush.kind, backend: 'canvas2d', reason: 'Operation rasterized by the shared brush evaluator and uploaded to WebGPU'});
      const texture = this.textures.get(image, image);
      return {texture, color: [1, 1, 1, 1], paint: [0, 0, 0, 0],
        uv: point => [(point[0] - bounds[0]) / (bounds[2] || 1), (point[1] - bounds[1]) / (bounds[3] || 1)]};
    }
    const inverseTransform = inverse(brushMatrix(brush, bounds));
    if (!inverseTransform) return null;
    const local = point => {
      const result = transformPoint(inverseTransform, point);
      return brush.mapping === 'absolute' ? result : [(result[0] - bounds[0]) / (bounds[2] || 1), (result[1] - bounds[1]) / (bounds[3] || 1)];
    };
    if (brush.kind === 'image') {
      const image = resolveResource(resources, brush.image, 'image'), fit = imageRectangle(image, bounds, brush).destination;
      return {texture: this.textures.get(image, image, {sampling: brush.sampling}), color: [1, 1, 1, brush.opacity], paint: [2, 0, 0, 0],
        uv: point => { const value = transformPoint(inverseTransform, point); return [(value[0] - fit[0]) / fit[2], (value[1] - fit[1]) / fit[3]]; }};
    }
    const texture = this.textures.gradient(brush);
    if (brush.kind === 'linear') {
      const dx = brush.end[0] - brush.start[0], dy = brush.end[1] - brush.start[1], length = dx * dx + dy * dy;
      return {texture, color: [1, 1, 1, brush.opacity], paint: [0, 0, 0, 0], uv: point => {
        const value = local(point); return [length ? ((value[0] - brush.start[0]) * dx + (value[1] - brush.start[1]) * dy) / length : 1, 0.5]; }};
    }
    const [rx, ry] = brush.radius;
    return {texture, color: [1, 1, 1, brush.opacity], paint: [1, (brush.origin[0] - brush.center[0]) / (rx || 1),
      (brush.origin[1] - brush.center[1]) / (ry || 1), 0], uv: point => {
      const value = local(point); return [(value[0] - brush.center[0]) / (rx || 1e-9), (value[1] - brush.center[1]) / (ry || 1e-9)]; }};
  }

  vertices(triangles, paint, transform) {
    if (!triangles?.length || !paint) return null;
    const data = new Float32Array(triangles.length / 2 * 12);
    for (let index = 0; index < triangles.length; index += 2) {
      const point = [triangles[index], triangles[index + 1]], position = transformPoint(transform, point), uv = paint.uv(point);
      const offset = index / 2 * 12;
      data.set(position, offset); data.set(uv, offset + 2); data.set(paint.color, offset + 4); data.set(paint.paint, offset + 8);
    }
    return {data, count: data.length / 12, texture: paint.texture};
  }

  build(command, transform, resources, options) {
    if (command.op === DrawOp.Image) return this.image(command, transform, resources);
    if (command.op === DrawOp.GlyphRun) return this.text(command, transform, resources, options);
    const geometry = this.geometry(command, resources, options), output = [];
    if (geometry.fill) output.push(this.vertices(geometry.fill, this.paint(command.brush, geometry.bounds, resources, options), transform));
    if (geometry.stroke) output.push(this.vertices(geometry.stroke, this.paint(geometry.pen.brush, geometry.bounds, resources, options), transform));
    return output.filter(Boolean);
  }

  image(command, transform, resources) {
    const image = resolveResource(resources, command.image, 'image'), options = command.options ?? {};
    if (!image) throw new DrawingError('SFRENDER066', 'Image resource is missing');
    const texture = this.textures.get(image, image, {sampling: options.sampling ?? 'linear'});
    const patches = options.nineGrid ? nineGridPatches(image, command.destination, options.nineGrid) :
      [imageRectangle(image, command.destination, options)];
    return patches.filter(patch => patch.source[2] && patch.source[3] && patch.destination[2] && patch.destination[3]).map(patch => {
      const [sx, sy, sw, sh] = patch.source, [x, y, width, height] = patch.destination;
      const clip = command.destination, left = Math.max(x, clip[0]), top = Math.max(y, clip[1]);
      const right = Math.min(x + width, clip[0] + clip[2]), bottom = Math.min(y + height, clip[1] + clip[3]);
      const paint = {texture, color: [1, 1, 1, options.opacity ?? 1], paint: [0, 0, 0, 0],
        uv: point => [(sx + (point[0] - x) / width * sw) / image.width, (sy + (point[1] - y) / height * sh) / image.height]};
      return this.vertices(quadTriangles([left, top, Math.max(0, right - left), Math.max(0, bottom - top)]), paint, transform);
    });
  }
  text(command, transform, resources, options) {
    const run = resolveResource(resources, command.run, 'glyphRun');
    if (!this.textService) throw new DrawingError('SFRENDER085', 'GPU glyph rendering needs a native or outline text provider');
    const instances = buildGlyphInstances(this, {run, command, transform, resources, options});
    if (instances) return instances;
    const brush = normalizeBrush(command.brush, resources, options.resolve);
    if (!brush) return [];
    let cached = this.textCache.get(run);
    const key = JSON.stringify([brush, options.dpr, resources?.version, this.textService.provider?.fontVersion]);
    if (!cached || cached.key !== key) {
      let image;
      if ((this.textService.provider?.nativeRuns || this.textService.provider?.capabilities?.numericGlyphs) && this.paints) {
        image = this.textService.rasterize(run, {dpr: options.dpr,
          opacity: value => colorGlyphOpacity(value ?? command.brush, resources, options.resolve), paint: (value, context) =>
          this.paints.get(context, value ?? command.brush, [0, 0, run.width, run.height], resources, options)});
      } else {
        image = this.textService.rasterize(run, {dpr: options.dpr, color: '#ffffff', overrideColors: true});
        if (!this.paints) throw new DrawingError('SFRENDER096', 'Non-solid text requires an offscreen glyph-mask provider');
        const source = this.createCanvas(image.width, image.height), context = source.getContext('2d');
        context.setTransform(options.dpr, 0, 0, options.dpr, 0, 0);
        context.fillStyle = this.paints.get(context, brush, [0, 0, image.logicalWidth, image.logicalHeight], resources, options);
        context.fillRect(0, 0, image.logicalWidth, image.logicalHeight); context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalCompositeOperation = 'destination-in'; context.drawImage(image.source, 0, 0);
        image = {...image, source};
      }
      cached = {key, image, id: ++this.nextText}; this.textCache.set(run, cached);
    }
    const {image} = cached;
    const origin = [command.origin[0] + (image.origin?.[0] ?? 0), command.origin[1] + (image.origin?.[1] ?? 0)];
    if (!this.atlas) return this.image({image, destination: [...origin, image.logicalWidth, image.logicalHeight], options: {}}, transform, null);
    const output = [], extent = this.atlas.size - this.atlas.padding * 2;
    const color = [1, 1, 1, 1];
    for (let y = 0; y < image.height; y += extent) for (let x = 0; x < image.width; x += extent) {
      const width = Math.min(extent, image.width - x), height = Math.min(extent, image.height - y), tileKey = `${cached.id}:${x}:${y}`;
      let entry = this.atlas.get(tileKey);
      if (!entry) {
        const tile = this.createCanvas(width, height);
        tile.getContext('2d').drawImage(image.source, x, y, width, height, 0, 0, width, height);
        entry = this.atlas.add(tileKey, tile);
      }
      options.plan?.pinAtlas(entry.page);
      const texture = this.atlasTexture(entry.page);
      const left = origin[0] + x / options.dpr, top = origin[1] + y / options.dpr;
      const paint = {texture, color, paint: [0, 0, 0, 0], uv: point => [
        (entry.x + (point[0] - left) * options.dpr) / this.atlas.size,
        (entry.y + (point[1] - top) * options.dpr) / this.atlas.size]};
      output.push(this.vertices(quadTriangles([left, top, width / options.dpr, height / options.dpr]), paint, transform));
    }
    return output;
  }
  dispose() { this.atlas?.dispose(); this.paints?.dispose(); this.textCache = new WeakMap(); this.meshCache = new WeakMap(); }
}
