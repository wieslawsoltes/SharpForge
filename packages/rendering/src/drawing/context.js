import {DrawOp, DrawingError, finite, rectangle, matrix, radii, resource} from './commands.js';
import {DisplayList} from './display-list.js';

/** App-local retained drawing recorder. Coordinate units are DIPs; brushes/pens may be resource handles. */
export class DrawingContext {
  constructor({maxCommands = 1000000, maxDepth = 256, elementId = '', version = 0} = {}) {
    this.maxCommands = finite(maxCommands, 'command limit', 1, 10000000);
    this.maxDepth = finite(maxDepth, 'stack limit', 1, 256);
    if (!Number.isInteger(maxCommands) || !Number.isInteger(maxDepth)) throw new DrawingError('SFRENDER008', 'Drawing budgets must be integers');
    this.elementId = String(elementId);
    this.version = version;
    this.commands = [];
    this.depth = 0;
    this.closed = false;
  }

  append(op, args) {
    if (this.closed) throw new DrawingError('SFRENDER007', 'DrawingContext has already been sealed');
    if (this.commands.length >= this.maxCommands) throw new DrawingError('SFRENDER008', 'Drawing command budget exceeded');
    this.commands.push({op, ...args});
    return this;
  }

  push(op, args) {
    if (this.depth >= this.maxDepth) throw new DrawingError('SFRENDER009', 'Drawing stack budget exceeded');
    this.append(op, args);
    this.depth++;
    return this;
  }

  PushTransform(transform) { return this.push(DrawOp.PushTransform, {transform: matrix(transform)}); }
  PushClip(geometry) { return this.push(DrawOp.PushClip, {geometry: resource(geometry, 'geometry')}); }
  PushOpacity(opacity, bounds = null) {
    return this.push(DrawOp.PushOpacity, {opacity: finite(opacity, 'opacity', 0, 1), bounds: bounds && rectangle(bounds)});
  }
  Pop() {
    if (!this.depth) throw new DrawingError('SFRENDER010', 'Drawing stack underflow');
    this.append(DrawOp.Pop, {});
    this.depth--;
    return this;
  }
  Clear(color = 'transparent') { return this.append(DrawOp.Clear, {color: resource(color, 'brush')}); }
  DrawRectangle(rect, brush = null, pen = null) {
    return this.append(DrawOp.Rectangle, {rect: rectangle(rect), brush: resource(brush, 'brush'), pen: resource(pen, 'pen')});
  }
  DrawRoundedRectangle(rect, radius, brush = null, pen = null) {
    const bounds = rectangle(rect);
    return this.append(DrawOp.RoundedRectangle, {rect: bounds, radii: radii(radius, bounds),
      brush: resource(brush, 'brush'), pen: resource(pen, 'pen')});
  }
  DrawEllipse(rect, brush = null, pen = null) {
    return this.append(DrawOp.Ellipse, {rect: rectangle(rect), brush: resource(brush, 'brush'), pen: resource(pen, 'pen')});
  }
  DrawLine(start, end, pen) {
    return this.append(DrawOp.Line, {start: [finite(start[0]), finite(start[1])], end: [finite(end[0]), finite(end[1])],
      pen: resource(pen, 'pen')});
  }
  DrawGeometry(geometry, brush = null, pen = null) {
    return this.append(DrawOp.Geometry, {geometry: resource(geometry, 'geometry'),
      brush: resource(brush, 'brush'), pen: resource(pen, 'pen')});
  }
  DrawGlyphRun(run, origin, brush) {
    return this.append(DrawOp.GlyphRun, {run: resource(run, 'glyphRun'), origin: [finite(origin[0]), finite(origin[1])],
      brush: resource(brush, 'brush')});
  }
  DrawImage(image, destination, options = {}) {
    return this.append(DrawOp.Image, {image: resource(image, 'image'), destination: rectangle(destination),
      options: {...options, source: options.source && rectangle(options.source)}});
  }
  DrawLayer(layer, options = {}) {
    return this.append(DrawOp.Layer, {layer: resource(layer, 'layer'), options: {...options}});
  }
  finish(bounds = null) {
    if (this.depth) throw new DrawingError('SFRENDER011', 'Every drawing push requires a matching Pop');
    if (this.closed) throw new DrawingError('SFRENDER007', 'DrawingContext has already been sealed');
    this.closed = true;
    return new DisplayList(this.commands, {elementId: this.elementId, version: this.version, bounds, maxCommands: this.maxCommands});
  }
  dispose() { this.commands.length = 0; this.depth = 0; this.closed = true; }
}
