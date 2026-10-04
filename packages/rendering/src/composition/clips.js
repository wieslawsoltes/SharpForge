import {CompositionObject, owned} from './composition-object.js';
import {finite} from './values.js';

const scalar = {default: 0, validate: value => finite(value, 'clip inset')};

export class InsetClip extends CompositionObject {
  constructor(compositor, left = 0, top = 0, right = 0, bottom = 0) {
    super(compositor, 'InsetClip', {LeftInset: scalar, TopInset: scalar, RightInset: scalar, BottomInset: scalar});
    Object.assign(this.baseValues, {LeftInset: finite(left), TopInset: finite(top), RightInset: finite(right), BottomInset: finite(bottom)});
  }
  descriptor(size) {
    return {kind: 'rectangle', rect: [this.LeftInset, this.TopInset,
      Math.max(0, size[0] - this.LeftInset - this.RightInset), Math.max(0, size[1] - this.TopInset - this.BottomInset)]};
  }
}

export class RectangleClip extends CompositionObject {
  constructor(compositor) { super(compositor, 'RectangleClip', {Left: scalar, Top: scalar, Right: scalar, Bottom: scalar}); }
  descriptor() { return {kind: 'rectangle', rect: [this.Left, this.Top, Math.max(0, this.Right - this.Left), Math.max(0, this.Bottom - this.Top)]}; }
}

export class GeometricClip extends CompositionObject {
  constructor(compositor, geometry = null) {
    super(compositor, 'GeometricClip', {Geometry: {default: null,
      validate: (value, owner) => owned(value, owner, object => object.kind.endsWith('Geometry'))}});
    if (geometry) this.Geometry = geometry;
  }
  descriptor() { return this.Geometry?.descriptor() ?? {kind: 'path', figures: []}; }
}
