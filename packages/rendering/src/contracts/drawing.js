import {Colors} from '../media/colors.js';
export {registerDrawingPropertyIdentifiers} from './drawing-identifiers.js';

/** A17 drawing additions use the caller's reserved block; released IDs and signatures remain unchanged. */
export function registerDrawingContracts(registry) {
  const {define, prop, member, ctor, en, event, delegate, types} = registry;
  const X = 'Microsoft.UI.Xaml.', M = X + 'Media.', S = X + 'Shapes.', C = X + 'Controls.', F = 'Windows.Foundation.';
  // Released brush members predate the property store; their owner now exposes its real DependencyObject ancestry.
  const brush = types.get(M + 'Brush');
  if (brush?.base === 'object') brush.base = X + 'DependencyObject';
  const type = (name, base = X + 'DependencyObject', kind = 'rendering', metadata = {}) => {
    if (!types.has(name)) define(name, {base, kind, ...metadata});
    return name;
  };
  const property = (owner, name, valueType, value = null, readOnly = false, isStatic = false) => {
    if (!types.get(owner)?.properties[name]) prop(owner, name, valueType, value, readOnly, isStatic);
  };
  const method = (owner, name, args, result = 'void', isStatic = false) => {
    if (!(registry.memberIndex.get(owner + '::' + name) ?? []).some(item => item.parameters.join('|') === args.join('|'))) {
      member(owner, name, args, result, {isStatic});
    }
  };
  const construct = (owner, args = []) => {
    if (!(registry.memberIndex.get(owner + '::.ctor') ?? []).some(item => item.parameters.join('|') === args.join('|'))) ctor(owner, args);
  };
  const enumeration = (name, values) => { if (!types.has(name)) en(name, values); };
  const properties = (owner, items) => { for (const [name, valueType, value, readOnly] of items) property(owner, name, valueType, value ?? null, readOnly); };
  const collection = (name, element) => {
    type(name, 'object', 'rendering', {xamlCollection: true, elementType: element});
    construct(name); property(name, 'Count', 'int', 0, true);
    for (const [methodName, args, result] of [['Add', [element], 'void'], ['Insert', ['int', element], 'void'],
      ['Remove', [element], 'bool'], ['RemoveAt', ['int'], 'void'], ['Clear', [], 'void'], ['Contains', [element], 'bool'],
      ['IndexOf', [element], 'int'], ['get_Item', ['int'], element], ['set_Item', ['int', element], 'void']]) method(name, methodName, args, result);
  };
  for (const [name, fields] of [['Point', ['X', 'Y']], ['Size', ['Width', 'Height']], ['Rect', ['X', 'Y', 'Width', 'Height']]]) {
    const owner = type(F + name, 'System.ValueType', 'value'); construct(owner); construct(owner, fields.map(() => 'double'));
    for (const field of fields) property(owner, field, 'double', 0);
  }
  enumeration(M + 'Stretch', {None: 0, Fill: 1, Uniform: 2, UniformToFill: 3});
  enumeration(M + 'FillRule', {EvenOdd: 0, Nonzero: 1});
  enumeration(M + 'PenLineCap', {Flat: 0, Square: 1, Round: 2, Triangle: 3});
  enumeration(M + 'PenLineJoin', {Miter: 0, Bevel: 1, Round: 2});
  enumeration(M + 'SweepDirection', {Counterclockwise: 0, Clockwise: 1});
  enumeration(M + 'BrushMappingMode', {RelativeToBoundingBox: 0, Absolute: 1});
  enumeration(M + 'GradientSpreadMethod', {Pad: 0, Reflect: 1, Repeat: 2});
  enumeration(M + 'ColorInterpolationMode', {ScRgbLinearInterpolation: 0, SRgbLinearInterpolation: 1});
  enumeration(M + 'AlignmentX', {Left: 0, Center: 1, Right: 2});
  enumeration(M + 'AlignmentY', {Top: 0, Center: 1, Bottom: 2});
  collection(M + 'DoubleCollection', 'double'); collection(M + 'PointCollection', F + 'Point');
  collection(M + 'GeometryCollection', M + 'Geometry'); collection(M + 'TransformCollection', M + 'Transform');
  collection(M + 'PathFigureCollection', M + 'PathFigure'); collection(M + 'PathSegmentCollection', M + 'PathSegment');
  collection(M + 'GradientStopCollection', M + 'GradientStop');

  type(M + 'Geometry', X + 'DependencyObject', 'abstract');
  property(M + 'Geometry', 'Transform', M + 'Transform'); property(M + 'Geometry', 'Bounds', F + 'Rect', null, true);
  method(M + 'Geometry', 'FillContains', [F + 'Point'], 'bool');
  method(M + 'Geometry', 'StrokeContains', [F + 'Point', 'double'], 'bool');
  type(M + 'PathSegment', X + 'DependencyObject', 'abstract');
  const segmentFields = {
    LineSegment: [['Point', F + 'Point']], BezierSegment: [['Point1', F + 'Point'], ['Point2', F + 'Point'], ['Point3', F + 'Point']],
    QuadraticBezierSegment: [['Point1', F + 'Point'], ['Point2', F + 'Point']],
    ArcSegment: [['Point', F + 'Point'], ['Size', F + 'Size'], ['RotationAngle', 'double', 0], ['IsLargeArc', 'bool', false],
      ['SweepDirection', M + 'SweepDirection', 0]],
    PolyLineSegment: [['Points', M + 'PointCollection']], PolyBezierSegment: [['Points', M + 'PointCollection']],
    PolyQuadraticBezierSegment: [['Points', M + 'PointCollection']]
  };
  for (const [name, fields] of Object.entries(segmentFields)) { const owner = type(M + name, M + 'PathSegment'); construct(owner); properties(owner, fields); }
  for (const [name, fields] of Object.entries({
    PathFigure: [['StartPoint', F + 'Point'], ['IsClosed', 'bool', false], ['IsFilled', 'bool', true], ['Segments', M + 'PathSegmentCollection']],
    PathGeometry: [['Figures', M + 'PathFigureCollection'], ['FillRule', M + 'FillRule', 0]],
    RectangleGeometry: [['Rect', F + 'Rect'], ['RadiusX', 'double', 0], ['RadiusY', 'double', 0]],
    EllipseGeometry: [['Center', F + 'Point'], ['RadiusX', 'double', 0], ['RadiusY', 'double', 0]],
    LineGeometry: [['StartPoint', F + 'Point'], ['EndPoint', F + 'Point']], GeometryGroup: [['Children', M + 'GeometryCollection'], ['FillRule', M + 'FillRule', 0]]
  })) { const owner = type(M + name, name === 'PathFigure' ? X + 'DependencyObject' : M + 'Geometry'); construct(owner); properties(owner, fields); }
  const shape = S + 'Shape';
  properties(shape, [['Stretch', M + 'Stretch', 0], ['StrokeDashArray', M + 'DoubleCollection'], ['StrokeDashOffset', 'double', 0],
    ['StrokeDashCap', M + 'PenLineCap', 0], ['StrokeStartLineCap', M + 'PenLineCap', 0], ['StrokeEndLineCap', M + 'PenLineCap', 0],
    ['StrokeLineJoin', M + 'PenLineJoin', 0], ['StrokeMiterLimit', 'double', 10], ['GeometryTransform', M + 'Transform', null, true]]);
  for (const name of ['Polygon', 'Polyline']) { const owner = type(S + name, shape, 'shape'); construct(owner);
    property(owner, 'Points', M + 'PointCollection'); property(owner, 'FillRule', M + 'FillRule', 0); }
  type(S + 'Path', shape, 'shape'); construct(S + 'Path'); property(S + 'Path', 'Data', M + 'Geometry');
  const matrix = type(M + 'Matrix', 'System.ValueType', 'value'); construct(matrix); construct(matrix, Array(6).fill('double'));
  for (const name of ['M11', 'M12', 'M21', 'M22', 'OffsetX', 'OffsetY']) property(matrix, name, 'double', ['M11', 'M22'].includes(name) ? 1 : 0);
  method(matrix, 'Transform', [F + 'Point'], F + 'Point');
  property(matrix, 'IsIdentity', 'bool', true, true);
  type(M + 'MatrixTransform', M + 'Transform'); construct(M + 'MatrixTransform'); property(M + 'MatrixTransform', 'Matrix', matrix);
  type(M + 'TransformGroup', M + 'Transform'); construct(M + 'TransformGroup'); property(M + 'TransformGroup', 'Children', M + 'TransformCollection');
  property(M + 'Transform', 'Inverse', M + 'Transform', null, true);
  method(M + 'Transform', 'TransformPoint', [F + 'Point'], F + 'Point'); method(M + 'Transform', 'TransformBounds', [F + 'Rect'], F + 'Rect');
  if (!(registry.memberIndex.get(M + 'Transform::TryTransform') ?? []).length) {
    member(M + 'Transform', 'TryTransform', [F + 'Point', F + 'Point&'], 'bool', {parameterModes: ['value', 'out']});
  }
  property(X + 'UIElement', 'RenderTransformOrigin', F + 'Point'); method(X + 'UIElement', 'TransformToVisual', [X + 'UIElement'], M + 'Transform');
  property(M + 'Brush', 'Transform', M + 'Transform'); property(M + 'Brush', 'RelativeTransform', M + 'Transform');

  type(M + 'GradientStop'); construct(M + 'GradientStop'); properties(M + 'GradientStop', [['Color', 'Windows.UI.Color'], ['Offset', 'double', 0]]);
  type(M + 'GradientBrush', M + 'Brush', 'abstract'); properties(M + 'GradientBrush', [['GradientStops', M + 'GradientStopCollection'],
    ['MappingMode', M + 'BrushMappingMode', 0], ['SpreadMethod', M + 'GradientSpreadMethod', 0],
    ['ColorInterpolationMode', M + 'ColorInterpolationMode', 1]]);
  type(M + 'LinearGradientBrush', M + 'GradientBrush'); construct(M + 'LinearGradientBrush');
  properties(M + 'LinearGradientBrush', [['StartPoint', F + 'Point'], ['EndPoint', F + 'Point']]);
  type(M + 'RadialGradientBrush', M + 'GradientBrush'); construct(M + 'RadialGradientBrush');
  properties(M + 'RadialGradientBrush', [['Center', F + 'Point'], ['GradientOrigin', F + 'Point'], ['RadiusX', 'double', 0.5], ['RadiusY', 'double', 0.5]]);
  type(M + 'ImageBrush', M + 'Brush'); construct(M + 'ImageBrush'); properties(M + 'ImageBrush', [['ImageSource', M + 'ImageSource'],
    ['Stretch', M + 'Stretch', 2], ['AlignmentX', M + 'AlignmentX', 1], ['AlignmentY', M + 'AlignmentY', 1]]);
  type(M + 'AcrylicBrush', M + 'Brush'); construct(M + 'AcrylicBrush'); properties(M + 'AcrylicBrush', [['TintColor', 'Windows.UI.Color'],
    ['TintOpacity', 'double', 0.5], ['TintLuminosityOpacity', 'double', 0], ['FallbackColor', 'Windows.UI.Color'], ['AlwaysUseFallback', 'bool', false]]);
  type(M + 'XamlCompositionBrushBase', M + 'Brush', 'rendering'); construct(M + 'XamlCompositionBrushBase');
  property(M + 'XamlCompositionBrushBase', 'CompositionBrush', 'Microsoft.UI.Composition.CompositionBrush');
  for (const name of ['OnConnected', 'OnDisconnected']) {
    const owner = M + 'XamlCompositionBrushBase';
    if (!(registry.memberIndex.get(owner + '::' + name) ?? []).length) {
      member(owner, name, [], 'void', {isVirtual: true, accessibility: 'protected'});
    }
  }
  type(M + 'RevealBrush', M + 'Brush'); construct(M + 'RevealBrush'); property(M + 'RevealBrush', 'FallbackColor', 'Windows.UI.Color');
  type(M + 'SystemBackdrop', X + 'DependencyObject', 'abstract');
  for (const name of ['MicaBackdrop', 'DesktopAcrylicBackdrop']) { type(M + name, M + 'SystemBackdrop'); construct(M + name); }
  property(X + 'Window', 'SystemBackdrop', M + 'SystemBackdrop');
  type(M + 'Shadow', X + 'DependencyObject', 'abstract'); type(M + 'ThemeShadow', M + 'Shadow'); construct(M + 'ThemeShadow');
  property(X + 'UIElement', 'Shadow', M + 'Shadow');
  type('Microsoft.UI.ColorHelper', 'object', 'static');
  method('Microsoft.UI.ColorHelper', 'FromArgb', ['byte', 'byte', 'byte', 'byte'], 'Windows.UI.Color', true);
  method('Microsoft.UI.ColorHelper', 'ToDisplayName', ['Windows.UI.Color'], 'string', true);
  for (const name of Object.keys(Colors)) property('Microsoft.UI.Colors', name, 'Windows.UI.Color', null, true, true);
  for (const name of ['op_Equality', 'op_Inequality']) method('Windows.UI.Color', name, ['Windows.UI.Color', 'Windows.UI.Color'], 'bool', true);

  type(M + 'ImageSource', X + 'DependencyObject', 'abstract');
  const imaging = M + 'Imaging.';
  type(imaging + 'BitmapSource', M + 'ImageSource', 'abstract');
  for (const name of ['PixelWidth', 'PixelHeight']) property(imaging + 'BitmapSource', name, 'int', 0, true);
  type(imaging + 'BitmapImage', imaging + 'BitmapSource'); construct(imaging + 'BitmapImage'); property(imaging + 'BitmapImage', 'UriSource', 'string');
  type(imaging + 'WriteableBitmap', imaging + 'BitmapSource'); construct(imaging + 'WriteableBitmap', ['int', 'int']);
  property(imaging + 'WriteableBitmap', 'PixelBuffer', 'byte[]', null, true); method(imaging + 'WriteableBitmap', 'Invalidate', []);
  type(imaging + 'RenderTargetBitmap', imaging + 'BitmapSource'); construct(imaging + 'RenderTargetBitmap');
  method(imaging + 'RenderTargetBitmap', 'RenderAsync', [X + 'UIElement'], 'System.Threading.Tasks.Task');
  method(imaging + 'RenderTargetBitmap', 'RenderAsync', [X + 'UIElement', 'int', 'int'], 'System.Threading.Tasks.Task');
  const pixelTask = 'System.Threading.Tasks.Task`1<byte[]>';
  if (!types.has(pixelTask)) define(pixelTask, {kind: 'task', base: registry.TASK, result: 'byte[]'});
  method(imaging + 'RenderTargetBitmap', 'GetPixelsAsync', [], 'System.Threading.Tasks.Task`1<byte[]>');
  property(C + 'Image', 'NineGrid', X + 'Thickness');
  for (const [name, propertyType] of [['FocusVisualPrimaryBrush', M + 'Brush'], ['FocusVisualSecondaryBrush', M + 'Brush'],
    ['FocusVisualPrimaryThickness', X + 'Thickness'], ['FocusVisualSecondaryThickness', X + 'Thickness'], ['FocusVisualMargin', X + 'Thickness']]) {
    property(X + 'UIElement', name, propertyType);
  }
  type(C + 'SwapChainPanel', C + 'Grid', 'control'); construct(C + 'SwapChainPanel');
  const canvas = 'Microsoft.Graphics.Canvas.', controls = canvas + 'UI.Xaml.';
  type(canvas + 'CanvasDrawingSession', 'object', 'rendering');
  method(canvas + 'CanvasDrawingSession', 'Clear', ['Windows.UI.Color']);
  for (const name of ['FillRectangle', 'DrawRectangle', 'FillEllipse', 'DrawEllipse']) method(canvas + 'CanvasDrawingSession', name,
    ['float', 'float', 'float', 'float', 'Windows.UI.Color', ...(name.startsWith('Draw') ? ['float'] : [])]);
  method(canvas + 'CanvasDrawingSession', 'DrawLine', ['float', 'float', 'float', 'float', 'Windows.UI.Color', 'float']);
  method(canvas + 'CanvasDrawingSession', 'DrawText', ['string', 'float', 'float', 'Windows.UI.Color']);
  const drawArgs = type(controls + 'CanvasDrawEventArgs', 'object');
  property(drawArgs, 'DrawingSession', canvas + 'CanvasDrawingSession', null, true);
  const handler = controls + 'CanvasDrawEventHandler'; if (!types.has(handler)) delegate(handler, [controls + 'CanvasControl', drawArgs]);
  for (const name of ['CanvasControl', 'CanvasAnimatedControl']) {
    const owner = type(controls + name, X + 'FrameworkElement', 'control'); construct(owner);
    if (!types.get(owner).events.Draw) event(owner, 'Draw', handler);
    method(owner, 'Invalidate', []); property(owner, 'ClearColor', 'Windows.UI.Color');
  }
}
