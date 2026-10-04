import {CompositionObject, owned} from './composition-object.js';
import {finite, vector, color} from './values.js';

const brush = (value, owner) => owned(value, owner, object => object.kind.endsWith('Brush'));
const brushSchema = {Opacity: {default: 1, validate: value => finite(value, 'Opacity', 0, 1)}};

export class CompositionBrush extends CompositionObject {
  constructor(compositor, kind, schema) { super(compositor, kind, {...brushSchema, ...schema}); }
  descriptor() { return {kind: this.kind, ...this.baseValues, ...this.animatedValues}; }
}

export class CompositionColorBrush extends CompositionBrush {
  constructor(compositor, value = [0, 0, 0, 0]) {
    super(compositor, 'CompositionColorBrush', {Color: {default: color(value), validate: color}});
  }
}

export class CompositionColorGradientStop extends CompositionObject {
  constructor(compositor, offset = 0, value = [0, 0, 0, 0]) {
    super(compositor, 'CompositionColorGradientStop', {
      Offset: {default: finite(offset, 'Offset', 0, 1), validate: value => finite(value, 'Offset', 0, 1)},
      Color: {default: color(value), validate: color}
    });
  }
}

export class GradientStopCollection {
  constructor(owner) { this.owner = owner; this.kind = 'CompositionColorGradientStopCollection'; this.items = []; }
  get Count() { return this.items.length; }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
  retainedValues() { return [this.owner, ...this.items]; }
  snapshot() { return [...this.items]; }
  restore(snapshot) { this.items = [...snapshot]; }
  map(callback) { return this.items.map(callback); }
  Add(stop) {
    owned(stop, this.owner, value => value instanceof CompositionColorGradientStop);
    if (!stop || this.items.length >= 4096) throw new RangeError('Invalid gradient stop or stop count');
    this.items.push(stop);
    this.owner.Compositor.link(this.owner, null, stop);
    this.owner.changed('ColorStops');
  }
  Remove(stop) {
    const index = this.items.indexOf(stop);
    if (index < 0) return false;
    this.items.splice(index, 1);
    this.owner.Compositor.link(this.owner, stop, null);
    this.owner.changed('ColorStops');
    return true;
  }
  Clear() {
    for (const stop of this.items) this.owner.Compositor.link(this.owner, stop, null);
    this.items.length = 0;
    this.owner.changed('ColorStops');
  }
}

class CompositionGradientBrush extends CompositionBrush {
  constructor(compositor, kind, schema) {
    super(compositor, kind, {...schema,
      MappingMode: {default: 0, validate: value => finite(value, 'MappingMode', 0, 1)},
      ExtendMode: {default: 0, validate: value => finite(value, 'ExtendMode', 0, 2)},
      InterpolationSpace: {default: 0, validate: value => {
        if (![0, 2, 4].includes(value)) throw new TypeError('SF_RENDER_COLORSPACE_UNSUPPORTED: only Auto, Rgb and RgbLinear are supported');
        return value;
      }}});
    this.ColorStops = new GradientStopCollection(this);
  }
  descriptor() {
    return {...super.descriptor(), ColorStops: this.ColorStops.map(stop => ({Offset: stop.Offset, Color: stop.Color})),
      SpreadMethod: [0, 2, 1][this.ExtendMode], ColorInterpolationMode: this.InterpolationSpace === 4 ? 0 : 1};
  }
}

export class CompositionLinearGradientBrush extends CompositionGradientBrush {
  constructor(compositor) {
    super(compositor, 'CompositionLinearGradientBrush', {
      StartPoint: {default: Object.freeze([0, 0]), validate: value => vector(value, 2)},
      EndPoint: {default: Object.freeze([1, 1]), validate: value => vector(value, 2)}
    });
  }
}

export class CompositionRadialGradientBrush extends CompositionGradientBrush {
  constructor(compositor) {
    super(compositor, 'CompositionRadialGradientBrush', {
      EllipseCenter: {default: Object.freeze([0.5, 0.5]), validate: value => vector(value, 2)},
      EllipseRadius: {default: Object.freeze([0.5, 0.5]), validate: value => {
        const result = vector(value, 2);
        result.forEach(component => finite(component, 'EllipseRadius', 0));
        return result;
      }},
      GradientOriginOffset: {default: Object.freeze([0, 0]), validate: value => vector(value, 2)}
    });
  }
  descriptor() {
    return {...super.descriptor(), center: this.EllipseCenter, radius: this.EllipseRadius,
      origin: this.EllipseCenter.map((value, index) => value + this.GradientOriginOffset[index])};
  }
}

export class CompositionSurfaceBrush extends CompositionBrush {
  constructor(compositor, surface = null) {
    super(compositor, 'CompositionSurfaceBrush', {
      Surface: {default: surface, validate: value => value},
      Stretch: {default: 2, validate: value => finite(value, 'Stretch', 0, 3)},
      HorizontalAlignmentRatio: {default: 0.5, validate: value => finite(value, 'HorizontalAlignmentRatio', 0, 1)},
      VerticalAlignmentRatio: {default: 0.5, validate: value => finite(value, 'VerticalAlignmentRatio', 0, 1)}
    });
    this.surfaceListener = () => { if (!this.closed) this.changed('Surface'); };
    this.watchSurface(null, surface);
  }
  watchSurface(previous, next) {
    previous?.remove_LoadCompleted?.(this.surfaceListener);
    next?.add_LoadCompleted?.(this.surfaceListener);
  }
  set(name, value) {
    const previous = name === 'Surface' ? this.baseValues.Surface : null;
    super.set(name, value);
    if (name === 'Surface') this.watchSurface(previous, value);
  }
  descriptor() { return {...super.descriptor(), Surface: this.Surface?.image ?? this.Surface}; }
  restore(snapshot) {
    this.watchSurface(this.baseValues.Surface, null);
    super.restore(snapshot);
    this.watchSurface(null, this.baseValues.Surface);
  }
  dispose() {
    if (this.closed) return;
    this.watchSurface(this.baseValues.Surface, null);
    super.dispose();
  }
}

export class CompositionNineGridBrush extends CompositionBrush {
  constructor(compositor) {
    const insets = Object.fromEntries(['Left', 'Top', 'Right', 'Bottom'].map(side => [side + 'Inset', {
      default: 0, validate: value => finite(value, 'NineGrid inset', 0)
    }]));
    super(compositor, 'CompositionNineGridBrush', {...insets, Source: {default: null, validate: brush}});
  }
  descriptor() {
    return {kind: 'nine-grid', source: this.Source?.descriptor(),
      insets: [this.LeftInset, this.TopInset, this.RightInset, this.BottomInset], opacity: this.Opacity};
  }
}

export class CompositionBackdropBrush extends CompositionBrush {
  constructor(compositor) { super(compositor, 'CompositionBackdropBrush'); }
  descriptor() { return {kind: 'backdrop', opacity: this.Opacity}; }
}

export class CompositionMaskBrush extends CompositionBrush {
  constructor(compositor) {
    super(compositor, 'CompositionMaskBrush', {Source: {default: null, validate: brush}, Mask: {default: null, validate: brush}});
  }
  descriptor() { return {kind: 'mask', source: this.Source?.descriptor(), mask: this.Mask?.descriptor(), opacity: this.Opacity}; }
}

/** Loading is delegated to the application's URI permission/decode service. */
export class LoadedImageSurface {
  constructor(uri, {load, signal} = {}) {
    if (typeof load !== 'function') throw new TypeError('An authorized image loader is required');
    this.closed = false;
    this.kind = 'Microsoft.UI.Xaml.Media.LoadedImageSurface';
    this.uri = uri;
    this.image = null;
    this.controller = new AbortController();
    this.listeners = new Set();
    const abort = () => this.controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    this.ready = Promise.resolve().then(() => load(uri, {signal: this.controller.signal})).then(image => {
      if (this.closed || this.controller.signal.aborted) { image.close?.(); throw new Error('Image surface loading was cancelled'); }
      this.image = image;
      for (const listener of this.listeners) listener({Status: 'Success'});
      return this;
    }, error => {
      for (const listener of this.listeners) listener({Status: 'Error', error});
      throw error;
    }).finally(() => signal?.removeEventListener('abort', abort));
  }
  add_LoadCompleted(listener) { this.listeners.add(listener); }
  remove_LoadCompleted(listener) { this.listeners.delete(listener); }
  retainedValues() { return []; }
  snapshot() {
    if (!this.image || this.closed) throw new TypeError('SF_COMPOSITION_SNAPSHOT_UNAVAILABLE: image loading is pending or surface is disposed');
    return {image: this.image, uri: this.uri, listeners: [...this.listeners]};
  }
  restore(snapshot) { this.closed = false; this.image = snapshot.image; this.uri = snapshot.uri; this.listeners = new Set(snapshot.listeners); }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.image?.close?.();
    this.image = null;
    this.listeners.clear();
  }
}
