import {DrawOp, DrawingError, resolveResource} from '../drawing/commands.js';
import {normalizeBrush, solidCss, brushMatrix} from '../brushes/brushes.js';
import {cssColor} from '../media/colors.js';
import {flattenGeometry, geometryBounds} from '../geometry/geometry-math.js';
import {normalizeGeometry} from '../geometry/path-geometry.js';
import {normalizePen, strokeContours} from '../geometry/stroke.js';
import {imageRectangle, nineGridPatches} from '../media/images.js';
import {commandGeometry} from './canvas2d.js';
import {rasterizeBrush, decodedImage} from '../brushes/rasterizer.js';
import {Canvas2DBackend} from './canvas2d.js';
import {multiply, scaling, translation} from '../media/transforms.js';
import {renderViewport} from './viewport.js';
import {drawSvgGlyphs} from './svg-text.js';

const namespace = 'http://www.w3.org/2000/svg';
function contourPath(contours) {
  const commands = [];
  for (const contour of contours) {
    const p = contour.points;
    if (!p.length) continue;
    commands.push(`M${p[0]} ${p[1]}`);
    for (let index = 2; index < p.length; index += 2) commands.push(`L${p[index]} ${p[index + 1]}`);
    if (contour.closed) commands.push('Z');
  }
  return commands.join(' ');
}
function hasScopedClear(commands) {
  const stack = [];
  let scopes = 0;
  for (const command of commands) {
    if ([DrawOp.PushTransform, DrawOp.PushClip, DrawOp.PushOpacity].includes(command.op)) {
      const scope = command.op !== DrawOp.PushTransform;
      stack.push(scope); scopes += scope ? 1 : 0;
    } else if (command.op === DrawOp.Pop) scopes -= stack.pop() ? 1 : 0;
    else if (command.op === DrawOp.Clear && scopes) return true;
  }
  return false;
}

/** SVG fallback implements the same retained command list, preserving native path/text accessibility overlays. */
export class SvgBackend {
  constructor(container, {createCanvas, textService, onFallback = () => {}, idPrefix = globalThis.crypto?.randomUUID?.()} = {}) {
    if (typeof idPrefix !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(idPrefix)) {
      throw new DrawingError('SFRENDER094', 'SVG backend requires a bounded unique instance identifier');
    }
    this.container = container; this.document = container.ownerDocument;
    this.createCanvas = createCanvas ?? ((width, height) => {
      const canvas = this.document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
    });
    this.onFallback = onFallback; this.textService = textService; this.svg = this.document.createElementNS(namespace, 'svg');
    this.svg.setAttribute('aria-hidden', 'true'); this.svg.classList.add('sf-winui-svg-drawing');
    this.svg.style.position = 'absolute'; this.svg.style.inset = '0'; this.svg.style.pointerEvents = 'none';
    container.prepend(this.svg); this.backend = 'dom'; this.serial = 0; this.instance = idPrefix; this.closed = false;
  }
  node(type, attributes = {}, parent = null) {
    const element = this.document.createElementNS(namespace, type);
    for (const [name, value] of Object.entries(attributes)) if (value != null) element.setAttribute(name, String(value));
    parent?.append(element); return element;
  }
  id(prefix) { return `sf-${this.instance}-${prefix}-${++this.serial}`; }

  render(list, resources, options = {}) {
    if (this.closed) throw new DrawingError('SFRENDER094', 'SVG backend is disposed');
    if ((options.layerDepth ?? 0) > 64) throw new DrawingError('SFRENDER130', 'SVG layer nesting budget exceeded');
    const {width, height, pixelWidth, pixelHeight} = renderViewport(options);
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`); this.svg.setAttribute('width', width); this.svg.setAttribute('height', height);
    this.svg.replaceChildren(); this.defs = this.node('defs', {}, this.svg);
    const rasterReason = options.blendColorSpace === 'linear' ? 'linear-blending' : hasScopedClear(list.commands) ? 'clipped-clear' : null;
    if (rasterReason) {
      const canvas = this.createCanvas(Math.ceil(width * (options.dpr ?? 1)), Math.ceil(height * (options.dpr ?? 1)));
      const renderer = new Canvas2DBackend(canvas, {createCanvas: this.createCanvas, textService: this.textService, onFallback: this.onFallback});
      try {
        const metrics = renderer.render(list, resources, {...options, width, height});
        this.drawImage(this.svg, {source: canvas, width: canvas.width, height: canvas.height}, [0, 0, width, height]);
        this.onFallback({operation: rasterReason, backend: 'canvas2d', reason: 'SVG uses the shared raster compositor for destructive scoped operations'});
        return {...metrics, backend: 'dom'};
      } finally { renderer.dispose(); canvas.width = canvas.height = 0; }
    }
    let parent = this.svg;
    const stack = [];
    for (const command of list.commands) {
      if (command.op === DrawOp.PushTransform || command.op === DrawOp.PushOpacity || command.op === DrawOp.PushClip) {
        stack.push(parent);
        if (command.op === DrawOp.PushTransform) parent = this.node('g', {transform: `matrix(${command.transform.join(' ')})`}, parent);
        else if (command.op === DrawOp.PushOpacity) parent = this.node('g', {opacity: command.opacity}, parent);
        else {
          const id = this.id('clip'), clip = this.node('clipPath', {id, clipPathUnits: 'userSpaceOnUse'}, this.defs);
          const geometry = normalizeGeometry(resolveResource(resources, command.geometry, 'geometry'), options.resolve);
          this.node('path', {d: contourPath(flattenGeometry(geometry)), 'clip-rule': geometry.fillRule ?? 'evenodd'}, clip);
          parent = this.node('g', {'clip-path': `url(#${id})`}, parent);
        }
      } else if (command.op === DrawOp.Pop) {
        parent = stack.pop(); if (!parent) throw new DrawingError('SFRENDER010', 'Drawing stack underflow');
      } else this.draw(parent, command, resources, options);
    }
    return {backend: 'dom', commands: list.commands.length, pixelWidth, pixelHeight, sampleCount: 1};
  }

  paint(input, bounds, resources, options) {
    const brush = normalizeBrush(input, resources, options.resolve);
    if (!brush) return 'none';
    if (brush.kind === 'solid') return solidCss(brush);
    const id = this.id('paint');
    if (['acrylic', 'backdrop', 'mask', 'nine-grid', 'effect'].includes(brush.kind)) {
      const image = rasterizeBrush(brush, bounds, resources, {...options, createCanvas: this.createCanvas,
        backend: 'dom', onFallback: this.onFallback});
      const pattern = this.node('pattern', {id, patternUnits: 'userSpaceOnUse', x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3]}, this.defs);
      this.node('image', {href: this.imageUrl(image), width: bounds[2], height: bounds[3], preserveAspectRatio: 'none'}, pattern);
      return `url(#${id})`;
    }
    if (brush.kind === 'image') {
      const image = resolveResource(resources, brush.image, 'image'), fit = imageRectangle(image, bounds, brush).destination;
      const pattern = this.node('pattern', {id, patternUnits: 'userSpaceOnUse', x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3],
        patternTransform: `matrix(${brushMatrix(brush, bounds).join(' ')})`}, this.defs);
      this.node('image', {href: this.imageUrl(image), x: fit[0] - bounds[0], y: fit[1] - bounds[1], width: fit[2], height: fit[3],
        preserveAspectRatio: 'none', opacity: brush.opacity}, pattern);
    } else {
      const mapping = brush.mapping === 'absolute' ? [1, 0, 0, 1, 0, 0] :
        multiply(translation(bounds[0], bounds[1]), scaling(bounds[2] || 1, bounds[3] || 1));
      const shared = {id, gradientUnits: 'userSpaceOnUse',
        spreadMethod: brush.spread === 'pad' ? 'pad' : brush.spread,
        gradientTransform: `matrix(${multiply(brushMatrix(brush, bounds), mapping).join(' ')})`,
        'color-interpolation': brush.interpolation === 'linear' ? 'linearRGB' : 'sRGB'};
      let gradient;
      if (brush.kind === 'linear') gradient = this.node('linearGradient', {...shared, x1: brush.start[0], y1: brush.start[1],
        x2: brush.end[0], y2: brush.end[1]}, this.defs);
      else {
        const ratio = brush.radius[0] ? brush.radius[1] / brush.radius[0] : 1;
        gradient = this.node('radialGradient', {...shared, cx: brush.center[0], cy: brush.center[1] / ratio,
          fx: brush.origin[0], fy: brush.origin[1] / ratio, r: brush.radius[0],
          gradientTransform: `${shared.gradientTransform} scale(1 ${ratio})`}, this.defs);
      }
      for (const stop of brush.stops) { const color = [...stop.color]; color[3] *= brush.opacity;
        this.node('stop', {offset: Math.max(0, Math.min(1, stop.offset)), 'stop-color': cssColor(color)}, gradient); }
    }
    return `url(#${id})`;
  }

  draw(parent, command, resources, options) {
    if (command.op === DrawOp.Clear) {
      const chain = new Set();
      for (let element = parent; element && element !== this.svg; element = element.parentNode) chain.add(element);
      const clear = element => { for (const child of [...element.children]) {
        if (child === this.defs) continue;
        if (chain.has(child)) clear(child); else child.remove();
      } };
      clear(this.svg);
      const background = this.node('rect', {x: 0, y: 0, width: options.width, height: options.height, fill: cssColor(command.color)});
      this.svg.insertBefore(background, this.defs.nextSibling); return;
    }
    if (command.op === DrawOp.Image) return this.drawImage(parent, resolveResource(resources, command.image, 'image'), command.destination, command.options);
    if (command.op === DrawOp.GlyphRun) {
      const run = resolveResource(resources, command.run, 'glyphRun');
      if (run.glyphAccess === 'numeric-glyphs') return drawSvgGlyphs(this, parent, command, run, resources, options);
      const group = this.node('g',
        {transform: `translate(${command.origin.join(' ')})`, fill: this.paint(command.brush, [0, 0, run.width, run.height], resources, options)}, parent);
      for (const line of run.lines) {
        const fontRuns = line.fontRuns?.length ? line.fontRuns : [{...line, font: run.font,
          paints: [{style: run.options ?? {}, rects: null}]}];
        for (const fontRun of fontRuns) for (const paint of fontRun.paints) {
          let parent = group;
          if (paint.rects) {
            const id = this.id('text-clip'), clip = this.node('clipPath', {id, clipPathUnits: 'userSpaceOnUse'}, this.defs);
            for (const rect of paint.rects) this.node('rect', {x: rect[0], y: rect[1] - run.fontSize,
              width: rect[2], height: rect[3] + run.fontSize * 2}, clip);
            parent = this.node('g', {'clip-path': `url(#${id})`}, group);
          }
          const element = this.node('text', {x: fontRun.direction === 'rtl' ? fontRun.left + fontRun.width : fontRun.left,
            y: fontRun.baseline, direction: fontRun.direction, 'text-anchor': 'start',
            fill: paint.style.foreground ? this.paint(paint.style.foreground, [0, 0, run.width, run.height], resources, options) : null,
            style: `font:${fontRun.font};white-space:pre`, 'letter-spacing': run.options?.letterSpacing ?? 0,
            'word-spacing': fontRun.wordSpacing ?? 0, 'text-decoration':
              [paint.style.underline ? 'underline' : '', paint.style.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')}, parent);
          element.textContent = fontRun.text;
        }
      }
      return;
    }
    if (command.op === DrawOp.Layer) {
      const layer = resolveResource(resources, command.layer, 'layer');
      const effect = command.options?.effect ?? layer.effect;
      if (effect || layer.shadow || command.options?.shadow) {
        const canvas = this.createCanvas(Math.ceil(options.width * (options.dpr ?? 1)), Math.ceil(options.height * (options.dpr ?? 1)));
        const backend = new Canvas2DBackend(canvas, {createCanvas: this.createCanvas, textService: this.textService, onFallback: this.onFallback});
        try { backend.render({commands: [command]}, resources, options);
          this.drawImage(parent, {source: canvas, width: canvas.width, height: canvas.height}, [0, 0, options.width, options.height]);
          this.onFallback({operation: 'effect', backend: 'canvas2d', reason: 'SVG effect rendered through the shared premultiplied evaluator'});
        } finally { backend.dispose(); }
        return;
      }
      const group = this.node('g', {opacity: command.options?.opacity ?? layer.opacity ?? 1,
        transform: command.options?.transform ?? layer.transform ? `matrix(${(command.options?.transform ?? layer.transform).join(' ')})` : null}, parent);
      if (!layer.displayList) throw new DrawingError('SFRENDER093', 'SVG layer requires a retained display list');
      this.drawLayerCommands(group, layer.displayList, resources, options); return;
    }
    const geometry = commandGeometry(command, resources, options.resolve), bounds = geometryBounds(geometry);
    const contours = flattenGeometry(geometry, {tolerance: 0.1 / (options.dpr ?? 1)});
    if (command.brush) this.node('path', {d: contourPath(contours.filter(contour => contour.filled)),
      fill: this.paint(command.brush, bounds, resources, options), 'fill-rule': geometry.fillRule ?? 'evenodd'}, parent);
    const pen = normalizePen(resolveResource(resources, command.pen, 'pen'));
    if (pen?.width) this.node('path', {d: contourPath(strokeContours(contours, pen)),
      fill: this.paint(pen.brush, bounds, resources, options), 'fill-rule': 'nonzero'}, parent);
  }
  drawLayerCommands(parent, list, resources, options) {
    const holder = this.document.createElement('div'), child = new SvgBackend(holder,
      {createCanvas: this.createCanvas, textService: this.textService, onFallback: this.onFallback});
    child.serial = this.serial;
    child.render(list, resources, {...options, layerDepth: (options.layerDepth ?? 0) + 1});
    while (child.defs.firstChild) this.defs.append(child.defs.firstChild);
    for (const node of [...child.svg.children]) if (node !== child.defs) parent.append(node);
    this.serial = child.serial; child.dispose();
  }
  imageUrl(image) {
    if (!image.source && image.pixels) image = decodedImage(image, this.createCanvas);
    if (image.url && /^(data:image\/(?:png|jpeg|webp);base64,|blob:)/.test(image.url)) return image.url;
    if (image.source?.toDataURL) return image.source.toDataURL();
    if (!this.createCanvas || !image.source) throw new DrawingError('SFRENDER066', 'SVG image needs a decoded raster provider');
    const canvas = this.createCanvas(image.width, image.height); canvas.getContext('2d').drawImage(image.source, 0, 0);
    return canvas.toDataURL();
  }
  drawImage(parent, image, destination, options = {}) {
    const clipId = this.id('image-clip'), clip = this.node('clipPath', {id: clipId}, this.defs);
    this.node('rect', {x: destination[0], y: destination[1], width: destination[2], height: destination[3]}, clip);
    const group = this.node('g', {'clip-path': `url(#${clipId})`, opacity: options.opacity ?? 1}, parent);
    const patches = options.nineGrid ? nineGridPatches(image, destination, options.nineGrid) : [imageRectangle(image, destination, options)];
    for (const patch of patches) {
      const [sx, sy, sw, sh] = patch.source, [x, y, width, height] = patch.destination;
      if (!sw || !sh || !width || !height) continue;
      const viewport = this.node('svg', {x, y, width, height, viewBox: `${sx} ${sy} ${sw} ${sh}`, preserveAspectRatio: 'none', overflow: 'hidden'}, group);
      this.node('image', {href: this.imageUrl(image), x: 0, y: 0, width: image.width, height: image.height,
        style: options.sampling === 'nearest' ? 'image-rendering:pixelated' : null}, viewport);
    }
  }
  dispose() { this.closed = true; this.svg.remove(); }
}

export {contourPath};
