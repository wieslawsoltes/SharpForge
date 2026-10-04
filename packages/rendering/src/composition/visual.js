import {CompositionObject, owned} from './composition-object.js';
import {finite, vector, matrix, identityMatrix, visualMatrix} from './values.js';

const visualSchema = Object.freeze({
  Offset: {default: Object.freeze([0, 0, 0]), validate: value => vector(value, 3)},
  Size: {default: Object.freeze([0, 0]), validate: value => {
    const result = vector(value, 2);
    result.forEach(component => finite(component, 'Size', 0));
    return result;
  }},
  Scale: {default: Object.freeze([1, 1, 1]), validate: value => vector(value, 3)},
  RotationAngle: {default: 0, validate: value => finite(value, 'RotationAngle')},
  CenterPoint: {default: Object.freeze([0, 0, 0]), validate: value => vector(value, 3)},
  AnchorPoint: {default: Object.freeze([0, 0]), validate: value => vector(value, 2)},
  Opacity: {default: 1, validate: value => finite(value, 'Opacity', 0, 1)},
  IsVisible: {default: true, validate: value => {
    if (typeof value !== 'boolean') throw new TypeError('IsVisible requires a boolean');
    return value;
  }},
  TransformMatrix: {default: Object.freeze(identityMatrix()), validate: matrix},
  Clip: {default: null, validate: (value, owner) => owned(value, owner, object => object.kind.endsWith('Clip'))}
});

export class VisualCollection {
  constructor(owner) { this.owner = owner; this.kind = 'VisualCollection'; this.items = []; }
  get Count() { return this.items.length; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  retainedValues() { return [this.owner, ...this.items]; }
  snapshot() { return [...this.items]; }
  restore(snapshot) { this.items = [...snapshot]; }

  insert(visual, index) {
    owned(visual, this.owner, object => object instanceof Visual);
    if (!visual) throw new TypeError('A visual is required');
    if (visual.parent) throw new TypeError('Visual already has a parent; remove it first');
    if (this.items.length >= this.owner.Compositor.maxVisuals) throw new RangeError('Visual collection limit exceeded');
    for (let ancestor = this.owner; ancestor; ancestor = ancestor.parent) {
      if (ancestor === visual) throw new TypeError('Composition visual cycle');
    }
    this.items.splice(index, 0, visual);
    visual.parent = this.owner;
    this.owner.changed('Children');
  }

  InsertAtTop(visual) { this.insert(visual, this.items.length); }
  InsertAtBottom(visual) { this.insert(visual, 0); }
  InsertAbove(visual, sibling) {
    const index = this.items.indexOf(sibling);
    if (index < 0) throw new TypeError('Sibling does not belong to this collection');
    this.insert(visual, index + 1);
  }
  InsertBelow(visual, sibling) {
    const index = this.items.indexOf(sibling);
    if (index < 0) throw new TypeError('Sibling does not belong to this collection');
    this.insert(visual, index);
  }
  Remove(visual) {
    const index = this.items.indexOf(visual);
    if (index < 0) throw new TypeError('Visual does not belong to this collection');
    this.items.splice(index, 1);
    visual.parent = null;
    this.owner.changed('Children');
  }
  RemoveAll() {
    for (const visual of this.items) visual.parent = null;
    this.items.length = 0;
    this.owner.changed('Children');
  }
}

export class Visual extends CompositionObject {
  constructor(compositor, kind = 'Visual', extra = {}) {
    super(compositor, kind, {...visualSchema, ...extra});
    this.parent = null;
    this.contentVersion = 1;
    this.content = null;
    this.encodedVersion = 0;
    this.matrixVersion = 0;
    this.cachedMatrix = null;
  }

  changed(name, animated = false) {
    if (!Object.hasOwn(visualSchema, name) || name === 'Size') this.contentVersion++;
    super.changed(name, animated);
  }

  matrix() {
    if (this.matrixVersion !== this.version) {
      this.cachedMatrix = visualMatrix(this);
      this.matrixVersion = this.version;
    }
    return this.cachedMatrix;
  }

  dispose() {
    if (this.closed) return;
    this.parent?.Children.Remove(this);
    this.Children?.RemoveAll();
    super.dispose();
  }
}

export class ContainerVisual extends Visual {
  constructor(compositor, kind = 'ContainerVisual', extra) {
    super(compositor, kind, extra);
    this.Children = new VisualCollection(this);
  }
}

export class SpriteVisual extends ContainerVisual {
  constructor(compositor) {
    super(compositor, 'SpriteVisual', {Shadow: {default: null, validate: (value, owner) =>
      owned(value, owner, object => object.kind === 'DropShadow')}, Brush: {default: null,
      validate: (value, owner) => owned(value, owner, object => object.kind.endsWith('Brush'))}});
  }
}

export class ShapeVisual extends ContainerVisual {
  constructor(compositor) {
    super(compositor, 'ShapeVisual');
    this.Shapes = new ShapeCollection(this);
  }
}

export class LayerVisual extends ContainerVisual {
  constructor(compositor) { super(compositor, 'LayerVisual'); }
}

export class ShapeCollection {
  constructor(owner) { this.owner = owner; this.kind = 'CompositionShapeCollection'; this.items = []; }
  get Count() { return this.items.length; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  retainedValues() { return [this.owner, ...this.items]; }
  snapshot() { return [...this.items]; }
  restore(snapshot) { this.items = [...snapshot]; }
  Add(value) {
    owned(value, this.owner, object => object.kind.endsWith('Shape'));
    if (!value) throw new TypeError('A composition shape is required');
    if (this.items.length >= 10000) throw new RangeError('Composition shape limit exceeded');
    this.items.push(value);
    this.owner.Compositor.link(this.owner, null, value);
    this.owner.changed('Shapes');
  }
  Remove(value) {
    const index = this.items.indexOf(value);
    if (index < 0) return false;
    this.items.splice(index, 1);
    this.owner.Compositor.link(this.owner, value, null);
    this.owner.changed('Shapes');
    return true;
  }
  Clear() {
    for (const item of this.items) this.owner.Compositor.link(this.owner, item, null);
    this.items.length = 0;
    this.owner.changed('Shapes');
  }
}
