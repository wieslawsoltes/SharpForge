import {DrawingError} from '../drawing/commands.js';
import {CompositionTarget} from '../composition/composition-target.js';

/** Mutable managed-facing rendering model with explicit retained values and snapshot state. */
export class DrawingModel {
  constructor(type, values = {}) { this.renderType = type; this.data = {...values}; this.version = 0; }
  retainedValues() { return Object.values(this.data).flatMap(value => Array.isArray(value) ? value : [value]); }
  get(name) { return this.data[name] ?? null; }
  set(name, value) { this.data[name] = value; this.version++; }
  snapshot() { return {data: {...this.data}, version: this.version}; }
  restore(snapshot) { this.data = {...snapshot.data}; this.version = snapshot.version; }
  toDescriptor() { return serializeRenderingValue(this, this.renderType); }
}

export class DrawingCollection {
  constructor(type, items = []) { this.renderType = type; this.items = [...items]; this.version = 0; }
  retainedValues() { return this.items; }
  get Count() { return this.items.length; }
  at(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) throw new RangeError('Rendering collection index');
    return this.items[index];
  }
  insert(index, value) {
    if (!Number.isInteger(index) || index < 0 || index > this.items.length) throw new RangeError('Rendering collection index');
    if (this.items.length >= 1000000) throw new RangeError('Rendering collection budget exceeded');
    this.items.splice(index, 0, value); this.version++;
  }
  removeAt(index) { this.at(index); this.items.splice(index, 1); this.version++; }
  snapshot() { return {items: [...this.items], version: this.version}; }
  restore(snapshot) { this.items = [...snapshot.items]; this.version = snapshot.version; }
  toDescriptor() { return this.items.map(value => serializeRenderingValue(value)); }
}

const nativeNames = new Map([
  ['PathGeometry', 'Microsoft.UI.Xaml.Media.PathGeometry'], ['PathFigure', 'Microsoft.UI.Xaml.Media.PathFigure'],
  ['LineSegment', 'Microsoft.UI.Xaml.Media.LineSegment'], ['BezierSegment', 'Microsoft.UI.Xaml.Media.BezierSegment'],
  ['QuadraticBezierSegment', 'Microsoft.UI.Xaml.Media.QuadraticBezierSegment'], ['ArcSegment', 'Microsoft.UI.Xaml.Media.ArcSegment'],
  ['RectangleGeometry', 'Microsoft.UI.Xaml.Media.RectangleGeometry'], ['EllipseGeometry', 'Microsoft.UI.Xaml.Media.EllipseGeometry'],
  ['LineGeometry', 'Microsoft.UI.Xaml.Media.LineGeometry'], ['GeometryGroup', 'Microsoft.UI.Xaml.Media.GeometryGroup'],
  ['Matrix', 'Microsoft.UI.Xaml.Media.Matrix'], ['WriteableBitmap', 'Microsoft.UI.Xaml.Media.Imaging.WriteableBitmap'],
  ['RenderTargetBitmap', 'Microsoft.UI.Xaml.Media.Imaging.RenderTargetBitmap'],
  ['DrawingContext', 'Microsoft.Graphics.Canvas.CanvasDrawingSession']
]);
export const renderingValueFields = Object.freeze({
  'Windows.Foundation.Point': Object.freeze(['X', 'Y']), 'Windows.Foundation.Size': Object.freeze(['Width', 'Height']),
  'Windows.Foundation.Rect': Object.freeze(['X', 'Y', 'Width', 'Height']),
  'Microsoft.UI.Xaml.Media.Matrix': Object.freeze(['M11', 'M12', 'M21', 'M22', 'OffsetX', 'OffsetY'])
});
export function typeOfRenderingModel(model) { return model?.renderType ?? nativeNames.get(model?.constructor?.name) ?? model?.valueType ?? null; }

/** Structured scene values carry canonical typed descriptors; resource handles are left intact. */
export function serializeRenderingValue(model, type = typeOfRenderingModel(model), seen = new Set(), depth = 0) {
  if (model == null || typeof model !== 'object') return model;
  if (depth > 64 || seen.has(model)) throw new DrawingError('SFRENDER130', 'Rendering value cycle or depth limit');
  if (model.id !== undefined && model.generation !== undefined && model.session !== undefined) return model;
  if (model.nodeType || typeof model.getContext === 'function' || typeof model.close === 'function') {
    throw new DrawingError('SFRENDER131', 'Decoded images must cross the scene boundary as resource handles');
  }
  if (model instanceof CompositionTarget && model.kind.endsWith('Brush')) {
    return serializeRenderingValue(model.descriptor(), undefined, seen, depth + 1);
  }
  seen.add(model);
  let result;
  if (model instanceof DrawingCollection || Array.isArray(model) || ArrayBuffer.isView(model)) {
    result = Array.from(model.items ?? model, value => serializeRenderingValue(value, undefined, seen, depth + 1));
  } else {
    const source = model instanceof DrawingModel ? model.data : model;
    const data = {};
    for (const [key, value] of Object.entries(source)) {
      if (key === 'renderType' || key === 'listeners' || typeof value === 'function') continue;
      data[key] = serializeRenderingValue(value, undefined, seen, depth + 1);
    }
    result = model instanceof DrawingModel && !Object.hasOwn(renderingValueFields, type)
      ? {valueType: type, type, properties: data, ...data} : {...data, ...(type ? {valueType: type} : {})};
  }
  seen.delete(model); return result;
}
