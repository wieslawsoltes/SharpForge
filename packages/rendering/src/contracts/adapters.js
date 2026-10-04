import {DrawingModel, DrawingCollection, renderingValueFields, serializeRenderingValue} from '../media/models.js';
import {Colors, colorFromArgb, colorDisplayName, colorEquals} from '../media/colors.js';
import {transformValue, transformPoint, transformBounds, inverse, transformToVisual} from '../media/transforms.js';
import {geometryBounds, fillContains} from '../geometry/geometry-math.js';
import {strokeContains} from '../geometry/stroke.js';
import {normalizeGeometry} from '../geometry/path-geometry.js';
import {parsePath} from '../geometry/path-markup.js';
import {CanvasDrawingSession} from '../controls/canvas-session.js';
import {WriteableBitmap} from '../media/images.js';

const M = 'Microsoft.UI.Xaml.Media.', F = 'Windows.Foundation.';
const collectionTypes = ['DoubleCollection', 'PointCollection', 'GeometryCollection', 'TransformCollection',
  'PathFigureCollection', 'PathSegmentCollection', 'GradientStopCollection'];
const fieldDefaults = {
  PathGeometry: {FillRule: 0, Figures: 'PathFigureCollection'}, PathFigure: {StartPoint: [0, 0], IsClosed: false, IsFilled: true, Segments: 'PathSegmentCollection'},
  LineSegment: {Point: [0, 0]}, BezierSegment: {Point1: [0, 0], Point2: [0, 0], Point3: [0, 0]},
  QuadraticBezierSegment: {Point1: [0, 0], Point2: [0, 0]}, ArcSegment: {Point: [0, 0], Size: {Width: 0, Height: 0},
    RotationAngle: 0, IsLargeArc: false, SweepDirection: 0},
  PolyLineSegment: {Points: 'PointCollection'}, PolyBezierSegment: {Points: 'PointCollection'}, PolyQuadraticBezierSegment: {Points: 'PointCollection'},
  RectangleGeometry: {Rect: {X: 0, Y: 0, Width: 0, Height: 0}, RadiusX: 0, RadiusY: 0},
  EllipseGeometry: {Center: [0, 0], RadiusX: 0, RadiusY: 0}, LineGeometry: {StartPoint: [0, 0], EndPoint: [0, 0]},
  GeometryGroup: {Children: 'GeometryCollection', FillRule: 0}, MatrixTransform: {Matrix: [1, 0, 0, 1, 0, 0]},
  Matrix: {M11: 1, M12: 0, M21: 0, M22: 1, OffsetX: 0, OffsetY: 0},
  TranslateTransform: {X: 0, Y: 0}, ScaleTransform: {ScaleX: 1, ScaleY: 1, CenterX: 0, CenterY: 0},
  RotateTransform: {Angle: 0, CenterX: 0, CenterY: 0}, SkewTransform: {AngleX: 0, AngleY: 0, CenterX: 0, CenterY: 0},
  CompositeTransform: {ScaleX: 1, ScaleY: 1, SkewX: 0, SkewY: 0, Rotation: 0, TranslateX: 0, TranslateY: 0, CenterX: 0, CenterY: 0},
  SolidColorBrush: {Color: Colors.Transparent, Opacity: 1},
  TransformGroup: {Children: 'TransformCollection'}, GradientStop: {Color: Colors.Transparent, Offset: 0},
  LinearGradientBrush: {GradientStops: 'GradientStopCollection', StartPoint: [0, 0], EndPoint: [1, 1], Opacity: 1,
    MappingMode: 0, SpreadMethod: 0, ColorInterpolationMode: 1},
  RadialGradientBrush: {GradientStops: 'GradientStopCollection', Center: [0.5, 0.5], GradientOrigin: [0.5, 0.5], RadiusX: 0.5, RadiusY: 0.5,
    Opacity: 1, MappingMode: 0, SpreadMethod: 0, ColorInterpolationMode: 1},
  ImageBrush: {ImageSource: null, Stretch: 2, AlignmentX: 1, AlignmentY: 1, Opacity: 1},
  AcrylicBrush: {TintColor: Colors.White, TintOpacity: 0.5, TintLuminosityOpacity: 0, FallbackColor: Colors.LightGray,
    Opacity: 1, AlwaysUseFallback: false},
  XamlCompositionBrushBase: {CompositionBrush: null}, RevealBrush: {FallbackColor: Colors.LightGray},
  MicaBackdrop: {}, DesktopAcrylicBackdrop: {}, ThemeShadow: {}, 'Imaging.BitmapImage': {UriSource: null}
};

function native(context, value) { return context.unwrapModel?.(value) ?? context.native(value); }
function descriptor(context, value) { return serializeRenderingValue(native(context, value)); }
function model(context, receiver, type) {
  return context.model(receiver, {factory: () => new DrawingModel(type, renderingValueFields[type]
    ? Object.fromEntries(renderingValueFields[type].map(field => [field, context.native(context.read(receiver, field))])) : defaults(type))});
}
export function renderingModelDefaults(type) {
  const name = type.slice(M.length), values = {...fieldDefaults[name]};
  for (const [key, value] of Object.entries(values)) {
    if (collectionTypes.includes(value)) values[key] = new DrawingCollection(M + value);
    else if (Array.isArray(value)) values[key] = [...value];
    else if (value && typeof value === 'object') values[key] = {...value};
  }
  return values;
}
const defaults = renderingModelDefaults;

/** A custom managed subclass runs its framework base constructor against the already allocated receiver. */
export function initializeRenderingBase(context, receiver, owner, args = []) {
  if (!owner.startsWith(M) || !Object.hasOwn(fieldDefaults, owner.slice(M.length))) return null;
  const values = defaults(owner);
  if (owner === M + 'SolidColorBrush' && args.length) values.Color = native(context, args[0]);
  else if (owner === M + 'Imaging.BitmapImage' && args.length) values.UriSource = context.native(args[0]);
  const current = context.state(receiver, 'nativeModel', () => new DrawingModel(owner, values));
  if (owner === M + 'SolidColorBrush' && args.length) context.write(receiver, 'Color', args[0]);
  else if (owner === M + 'Imaging.BitmapImage' && args.length) context.write(receiver, 'UriSource', args[0]);
  return current;
}
function usesPropertyStore(context, receiver, field) {
  let type = context.typeOf(receiver);
  if (!context.propertiesFor(type)?.[field]) return false;
  const visited = new Set();
  while (type && !visited.has(type)) {
    if (type === 'Microsoft.UI.Xaml.DependencyObject') return true;
    visited.add(type);
    type = context.baseType?.(type) ?? context.frameworkRegistry.frameworkType(type)?.base;
  }
  return false;
}

/** Property-store notifications call this after coercion, keeping geometry/brush getters and draw serialization in sync. */
export function syncRenderingModelProperty(context, receiver, name, value) {
  const current = context.unwrapModel(receiver);
  if (!(current instanceof DrawingModel)) return false;
  current.set(name, native(context, value));
  return true;
}

/** Initialize CLR struct fields for value copying; dependency-object defaults retain Default precedence and typed identity. */
export function materializeRenderingModelDefaults(context, receiver, seed) {
  const current = context.unwrapModel(receiver);
  if (!(current instanceof DrawingModel)) return;
  const fields = renderingValueFields[current.renderType];
  if (fields) {
    for (const field of fields) context.write(receiver, field, current.get(field));
    return;
  }
  const definitions = context.propertiesFor(context.typeOf(receiver));
  for (const [name, value] of Object.entries(current.data)) {
    const definition = definitions[name];
    if (!definition || definition.isStatic || !usesPropertyStore(context, receiver, name)) continue;
    const managed = managedValue(context, value, definition.type);
    seed(name, managed);
    current.set(name, native(context, managed));
  }
}
const point = value => [value[0] ?? value.X ?? value.x, value[1] ?? value.Y ?? value.y];
const rect = value => [value[0] ?? value.X ?? value.x, value[1] ?? value.Y ?? value.y,
  value[2] ?? value.Width ?? value.width, value[3] ?? value.Height ?? value.height];
function wrapPoint(context, value) { return context.wrapModel(new DrawingModel(F + 'Point', {X: value[0], Y: value[1]}), F + 'Point'); }
function wrapRect(context, value) { return context.wrapModel(new DrawingModel(F + 'Rect',
  {X: value[0], Y: value[1], Width: value[2], Height: value[3]}), F + 'Rect'); }
function managedValue(context, value, type) {
  if (value == null) return context.managed(value, type);
  if (value.renderType || value instanceof DrawingCollection) return context.wrapModel(value, value.renderType);
  if (renderingValueFields[type]) return context.wrapModel(new DrawingModel(type,
    Object.fromEntries(renderingValueFields[type].map((field, index) => [field, value[field] ?? value[index]]))), type);
  if (type === 'Windows.UI.Color') return context.allocate(type, value);
  return context.managed(value, type);
}

/** Bind native rendering models through the A00 extension registry, without central runtime branches. */
export function registerRenderingAdapters(registry) {
  const register = (owner, name, handler, kind = 'method') => registry.register({owner, name, kind, arity: '*'}, handler);
  for (const [name, definitions] of Object.entries(fieldDefaults)) {
    const owner = M + name;
    register(owner, '.ctor', ({context, args}) => {
      const values = defaults(owner);
      if (name === 'Matrix' && args.length === 6) {
        Object.keys(values).forEach((key, index) => { values[key] = context.native(args[index]); });
      } else if (name === 'SolidColorBrush' && args.length === 1) values.Color = native(context, args[0]);
      else if (name === 'Imaging.BitmapImage' && args.length === 1) values.UriSource = context.native(args[0]);
      const reference = context.wrapModel(new DrawingModel(owner, values), owner);
      if (name === 'SolidColorBrush' && args.length === 1) context.write(reference, 'Color', args[0]);
      else if (name === 'Imaging.BitmapImage' && args.length === 1) context.write(reference, 'UriSource', args[0]);
      return reference;
    }, 'constructor');
    for (const field of new Set([...Object.keys(definitions), 'Transform', 'RelativeTransform'])) {
      register(owner, 'get_' + field, ({context, receiver, descriptor: contract}) => {
        const value = model(context, receiver, owner).get(field);
        return managedValue(context, value, contract.result);
      }, 'get');
      register(owner, 'set_' + field, ({context, receiver, args}) => {
        const current = model(context, receiver, owner);
        if (renderingValueFields[owner] || usesPropertyStore(context, receiver, field)) {
          context.write(receiver, field, args[0]);
          current.set(field, native(context, context.read(receiver, field)));
        } else current.set(field, native(context, args[0]));
        context.services?.invalidateRendering?.(receiver);
      }, 'set');
    }
  }
  for (const name of collectionTypes) {
    const owner = M + name;
    register(owner, '.ctor', ({context}) => context.wrapModel(new DrawingCollection(owner), owner), 'constructor');
    register(owner, 'get_Count', ({context, receiver}) => context.model(receiver).Count, 'get');
    for (const name of ['Add', 'Insert', 'Remove', 'RemoveAt', 'Clear', 'Contains', 'IndexOf', 'get_Item', 'set_Item']) {
      register(owner, name, ({context, receiver, args, descriptor: contract}) => {
        const collection = context.model(receiver), values = args.map(value => native(context, value));
        if (name === 'Add') collection.insert(collection.Count, values[0]);
        else if (name === 'Insert') collection.insert(values[0], values[1]);
        else if (name === 'RemoveAt') collection.removeAt(values[0]);
        else if (name === 'Clear') { collection.items.length = 0; collection.version++; }
        else if (name === 'set_Item') { collection.at(values[0]); collection.items[values[0]] = values[1]; collection.version++; }
        else if (name === 'get_Item') { const value = collection.at(values[0]);
          return managedValue(context, value, contract.result); }
        else {
          const index = collection.items.indexOf(values[0]);
          if (name === 'IndexOf') return index;
          if (name === 'Contains') return index >= 0;
          if (index >= 0) collection.removeAt(index);
          return index >= 0;
        }
        context.services?.invalidateRendering?.(receiver);
      });
    }
  }
  register(M + 'XamlCompositionBrushBase', 'OnConnected', () => null);
  register(M + 'XamlCompositionBrushBase', 'OnDisconnected', ({context, receiver}) => {
    context.write(receiver, 'CompositionBrush', null);
    model(context, receiver, M + 'XamlCompositionBrushBase').set('CompositionBrush', null);
  });
  for (const [name, fields] of [['Point', ['X', 'Y']], ['Size', ['Width', 'Height']], ['Rect', ['X', 'Y', 'Width', 'Height']]]) {
    const owner = F + name;
    register(owner, '.ctor', ({context, args}) => context.wrapModel(new DrawingModel(owner,
      Object.fromEntries(fields.map((field, index) => [field, context.native(args[index] ?? 0)]))), owner), 'constructor');
    for (const field of fields) {
      register(owner, 'get_' + field, ({context, receiver}) =>
        context.model(receiver)?.get(field) ?? context.native(context.read(receiver, field)), 'get');
      register(owner, 'set_' + field, ({context, receiver, args}) => {
        context.write(receiver, field, args[0]);
        context.model(receiver)?.set(field, context.native(args[0]));
      }, 'set');
    }
  }
  for (const name of Object.keys(Colors)) register('Microsoft.UI.Colors', 'get_' + name,
    ({context}) => context.allocate('Windows.UI.Color', Colors[name]), 'get');
  register('Microsoft.UI.ColorHelper', 'FromArgb', ({context, args}) => context.allocate('Windows.UI.Color', colorFromArgb(...args.map(context.native.bind(context)))));
  register('Microsoft.UI.ColorHelper', 'ToDisplayName', ({context, args}) => context.managed(colorDisplayName(descriptor(context, args[0])), 'string'));
  for (const name of ['op_Equality', 'op_Inequality']) register('Windows.UI.Color', name, ({context, args}) =>
    colorEquals(descriptor(context, args[0]), descriptor(context, args[1])) === (name === 'op_Equality'));
  const geometry = (context, receiver) => normalizeGeometry(serializeRenderingValue(context.model(receiver)));
  register(M + 'Geometry', 'get_Bounds', ({context, receiver}) => wrapRect(context, geometryBounds(geometry(context, receiver))), 'get');
  register(M + 'Geometry', 'FillContains', ({context, receiver, args}) => fillContains(geometry(context, receiver), point(descriptor(context, args[0]))));
  register(M + 'Geometry', 'StrokeContains', ({context, receiver, args}) => strokeContains(geometry(context, receiver),
    point(descriptor(context, args[0])), {width: context.native(args[1]), brush: '#000000'}));
  for (const name of ['TransformPoint', 'TransformBounds']) register(M + 'Transform', name, ({context, receiver, args}) => {
    const transform = transformValue(descriptor(context, receiver)), input = descriptor(context, args[0]);
    return name === 'TransformPoint' ? wrapPoint(context, transformPoint(transform, point(input))) : wrapRect(context, transformBounds(transform, rect(input)));
  });
  register(M + 'Matrix', 'Transform', ({context, receiver, args}) =>
    wrapPoint(context, transformPoint(transformValue(descriptor(context, receiver)), point(descriptor(context, args[0])))));
  register(M + 'Matrix', 'get_IsIdentity', ({context, receiver}) =>
    transformValue(descriptor(context, receiver)).every((value, index) => value === [1, 0, 0, 1, 0, 0][index]), 'get');
  register(M + 'Transform', 'TryTransform', ({context, receiver, args}) => {
    const value = transformPoint(transformValue(descriptor(context, receiver)), point(descriptor(context, args[0])));
    const succeeded = value.every(Number.isFinite);
    context.writeReference(args[1], wrapPoint(context, succeeded ? value : [0, 0])); return succeeded;
  });
  register(M + 'Transform', 'get_Inverse', ({context, receiver}) => {
    const result = inverse(transformValue(descriptor(context, receiver)));
    return result ? context.wrapModel(new DrawingModel(M + 'MatrixTransform', {Matrix: result}), M + 'MatrixTransform') : null;
  }, 'get');
  register('Microsoft.UI.Xaml.UIElement', 'TransformToVisual', ({context, receiver, args}) => {
    const source = context.services.layout.getLayout(receiver), target = args[0] && context.services.layout.getLayout(args[0]);
    return context.wrapModel(new DrawingModel(M + 'MatrixTransform', {Matrix: transformToVisual(source.worldTransform, target?.worldTransform)}), M + 'MatrixTransform');
  });
  registerBitmapAdapters(register);
  registerCanvasAdapters(register);
}

function registerBitmapAdapters(register) {
  const owner = M + 'Imaging.WriteableBitmap';
  register(owner, '.ctor', ({context, args}) => context.wrapModel(new WriteableBitmap(...args.map(context.native.bind(context))), owner), 'constructor');
  register(owner, 'get_PixelBuffer', ({context, receiver}) => context.state(receiver, 'pixelBuffer',
    () => context.managed(context.model(receiver).PixelBuffer, 'byte[]')), 'get');
  register(owner, 'Invalidate', ({context, receiver}) => {
    const bitmap = context.model(receiver), buffer = context.state(receiver, 'pixelBuffer');
    if (buffer && buffer !== bitmap.PixelBuffer) bitmap.pixels.set(context.items(buffer).map(value => context.native(value)));
    bitmap.Invalidate(); context.services.invalidateRendering?.(receiver);
  });
  const target = M + 'Imaging.RenderTargetBitmap';
  register(target, '.ctor', ({context}) => context.wrapModel(new DrawingModel(target), target), 'constructor');
  register(target, 'RenderAsync', ({context, receiver, args}) => context.task(context.services.renderToBitmap(args[0],
    args.length === 3 ? {width: context.native(args[1]), height: context.native(args[2])} : undefined).then(bitmap => {
    const model = context.model(receiver); model.set('pixels', bitmap.pixels); model.set('width', bitmap.width); model.set('height', bitmap.height);
    context.write(receiver, 'PixelWidth', bitmap.width); context.write(receiver, 'PixelHeight', bitmap.height);
    model.set('PixelWidth', bitmap.width); model.set('PixelHeight', bitmap.height); context.services.invalidateRendering?.(receiver);
  })));
  register(target, 'GetPixelsAsync', ({context, receiver}) => context.task(Promise.resolve(context.model(receiver).get('pixels')), {resultType: 'byte[]'}));
  for (const owner of [M + 'Imaging.BitmapSource', target, M + 'Imaging.WriteableBitmap']) for (const name of ['PixelWidth', 'PixelHeight']) {
    register(owner, 'get_' + name, ({context, receiver}) => {
      const model = context.model(receiver); return model[name] ?? model[name === 'PixelWidth' ? 'width' : 'height'] ?? model.get?.(name) ?? 0;
    }, 'get');
  }
}
function registerCanvasAdapters(register) {
  const owner = 'Microsoft.Graphics.Canvas.CanvasDrawingSession';
  register('Microsoft.Graphics.Canvas.UI.Xaml.CanvasDrawEventArgs', 'get_DrawingSession',
    ({context, receiver}) => context.wrapModel(context.model(receiver).get('DrawingSession'), owner), 'get');
  for (const name of ['Clear', 'FillRectangle', 'DrawRectangle', 'FillEllipse', 'DrawEllipse', 'DrawLine', 'DrawText']) {
    register(owner, name, ({context, receiver, args}) => {
      const drawing = context.model(receiver, {factory: () => new CanvasDrawingSession()}), values = args.map(value => descriptor(context, value));
      if (name === 'Clear') drawing.Clear(values[0]);
      else if (name === 'DrawLine') drawing.DrawLine(values.slice(0, 2), values.slice(2, 4), {brush: values[4], width: values[5]});
      else if (name === 'DrawText') {
        const run = context.services.text.layout(values[0], {fontSize: 14, wrapping: 'nowrap'});
        drawing.DrawGlyphRun(run, values.slice(1, 3), values[3]);
      } else {
        const rect = name.endsWith('Ellipse') ? [values[0] - values[2], values[1] - values[3], values[2] * 2, values[3] * 2] : values.slice(0, 4);
        const brush = name.startsWith('Fill') ? values[4] : null, pen = name.startsWith('Draw') ? {brush: values[4], width: values[5]} : null;
        if (name.endsWith('Ellipse')) drawing.DrawEllipse(rect, brush, pen); else drawing.DrawRectangle(rect, brush, pen);
      }
    });
  }
  for (const name of ['CanvasControl', 'CanvasAnimatedControl']) register('Microsoft.Graphics.Canvas.UI.Xaml.' + name,
    'Invalidate', ({context, receiver}) => context.services.invalidateCanvas?.(receiver));
}

/** Runtime event dispatch owns invocation; the drawing session is sealed after every completed Draw event. */
export function createCanvasDrawEvent(context, receiver) {
  const state = context.state(receiver, 'canvasDrawVersion', () => ({version: 0,
    snapshot() { return this.version; }, restore(version) { this.version = version; }}));
  const drawing = new CanvasDrawingSession({elementId: context.id(receiver), version: ++state.version});
  const argsType = 'Microsoft.Graphics.Canvas.UI.Xaml.CanvasDrawEventArgs';
  return {drawing, args: context.wrapModel(new DrawingModel(argsType, {DrawingSession: drawing}), argsType),
    complete: () => drawing.finish(), dispose: () => drawing.dispose()};
}

export function geometryFromMarkup(source) { return parsePath(source); }
