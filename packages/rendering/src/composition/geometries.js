import {CompositionObject, owned} from './composition-object.js';
import {ShapeCollection} from './visual.js';
import {finite, vector} from './values.js';
import {CompositionStrokeDashArray} from './stroke-dash-array.js';

const trimSchema = Object.freeze({
  TrimStart: {default: 0, validate: value => finite(value, 'TrimStart', 0, 1)},
  TrimEnd: {default: 1, validate: value => finite(value, 'TrimEnd', 0, 1)},
  TrimOffset: {default: 0, validate: value => finite(value, 'TrimOffset')}
});
const point = {default: Object.freeze([0, 0]), validate: value => vector(value, 2)};
const size = {default: Object.freeze([0, 0]), validate: value => {
  const result = vector(value, 2);
  for (const component of result) finite(component, 'geometry extent', 0);
  return result;
}};

export class CompositionGeometry extends CompositionObject {
  constructor(compositor, kind, schema) { super(compositor, kind, {...trimSchema, ...schema}); }
  trim() { return {start: this.TrimStart, end: this.TrimEnd, offset: this.TrimOffset}; }
}
export class CompositionRectangleGeometry extends CompositionGeometry {
  constructor(compositor, kind = 'CompositionRectangleGeometry', extra = {}) {
    super(compositor, kind, {Offset: point, Size: size, ...extra});
  }
  descriptor() { return {kind: 'rectangle', rect: [...this.Offset, ...this.Size], trim: this.trim()}; }
}
export class CompositionRoundedRectangleGeometry extends CompositionRectangleGeometry {
  constructor(compositor) { super(compositor, 'CompositionRoundedRectangleGeometry', {CornerRadius: size}); }
  descriptor() { return {...super.descriptor(), radii: [...this.CornerRadius, ...this.CornerRadius, ...this.CornerRadius, ...this.CornerRadius]}; }
}
export class CompositionEllipseGeometry extends CompositionGeometry {
  constructor(compositor) { super(compositor, 'CompositionEllipseGeometry', {Center: point, Radius: size}); }
  descriptor() {
    return {kind: 'ellipse', rect: [this.Center[0] - this.Radius[0], this.Center[1] - this.Radius[1], this.Radius[0] * 2, this.Radius[1] * 2],
      trim: this.trim()};
  }
}
export class CompositionLineGeometry extends CompositionGeometry {
  constructor(compositor) { super(compositor, 'CompositionLineGeometry', {Start: point, End: point}); }
  descriptor() {
    return {kind: 'path', figures: [{start: this.Start, segments: [{kind: 'line', end: this.End}], closed: false, filled: false}], trim: this.trim()};
  }
}
export class CompositionPathGeometry extends CompositionGeometry {
  constructor(compositor, path = null) {
    super(compositor, 'CompositionPathGeometry', {Path: {default: path, validate: value => {
      if (value !== null && (typeof value !== 'object' || !Array.isArray(value.figures))) throw new TypeError('A retained path is required');
      return value;
    }}});
  }
  descriptor() { return {...(this.Path ?? {kind: 'path', figures: []}), trim: this.trim()}; }
}

export class CompositionSpriteShape extends CompositionObject {
  constructor(compositor, geometry = null) {
    const brush = (value, owner) => owned(value, owner, object => object.kind.endsWith('Brush'));
    super(compositor, 'CompositionSpriteShape', {
      Geometry: {default: null, validate: (value, owner) => owned(value, owner, object => object.kind.endsWith('Geometry'))},
      FillBrush: {default: null, validate: brush}, StrokeBrush: {default: null, validate: brush},
      StrokeThickness: {default: 1, validate: value => finite(value, 'StrokeThickness', 0)},
      StrokeDashOffset: {default: 0, validate: finite}, StrokeMiterLimit: {default: 10, validate: value => finite(value, 'StrokeMiterLimit', 1)},
      StrokeStartCap: {default: 0, validate: value => finite(value, 'StrokeStartCap', 0, 3)},
      StrokeEndCap: {default: 0, validate: value => finite(value, 'StrokeEndCap', 0, 3)},
      StrokeDashCap: {default: 0, validate: value => finite(value, 'StrokeDashCap', 0, 3)},
      StrokeLineJoin: {default: 0, validate: value => finite(value, 'StrokeLineJoin', 0, 2)},
      Offset: point, Scale: {default: Object.freeze([1, 1]), validate: value => vector(value, 2)},
      RotationAngle: {default: 0, validate: finite}
    });
    Object.defineProperty(this, 'StrokeDashArray', {enumerable: true, value: new CompositionStrokeDashArray(compositor, this)});
    if (geometry) this.Geometry = geometry;
  }
  *retainedValues() { yield* super.retainedValues(); yield this.StrokeDashArray; }
  dispose() { if (!this.closed) { this.StrokeDashArray.dispose(); super.dispose(); } }
}

export class CompositionContainerShape extends CompositionObject {
  constructor(compositor) {
    super(compositor, 'CompositionContainerShape', {Offset: point, Scale: {default: Object.freeze([1, 1]), validate: value => vector(value, 2)},
      RotationAngle: {default: 0, validate: finite}});
    this.Shapes = new ShapeCollection(this);
  }
}
