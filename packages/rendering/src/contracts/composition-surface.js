export const COMPOSITION = 'Microsoft.UI.Composition.';
const property = (name, type, value = null, readOnly = false) => ({name, type, value, readOnly});
const method = (name, parameters = [], result = 'void') => ({name, parameters, result});

export const compositionPropertyTypes = Object.freeze({Scalar: 'float', Boolean: 'bool', Color: 'Windows.UI.Color',
  Vector2: 'System.Numerics.Vector2', Vector3: 'System.Numerics.Vector3', Vector4: 'System.Numerics.Vector4',
  Quaternion: 'System.Numerics.Quaternion', Matrix4x4: 'System.Numerics.Matrix4x4'});

/** Versioned WinAppSDK-shaped inventory consumed by both contract and host-adapter registration. */
export const compositionTypeSpecs = [
  {name: 'CompositionObject', abstract: true, properties: [property('Compositor', 'Compositor', null, true),
    property('Properties', 'CompositionPropertySet', null, true), property('ImplicitAnimations', 'ImplicitAnimationCollection')],
  methods: [method('StartAnimation', ['string', 'CompositionAnimation']), method('StartAnimationGroup', ['CompositionAnimationGroup']),
    method('StopAnimationGroup', ['CompositionAnimationGroup']), method('StopAnimation', ['string']),
    method('TryGetAnimationController', ['string'], 'AnimationController')]},
  {name: 'Compositor', constructor: true, methods: [
    ...['ContainerVisual', 'SpriteVisual', 'ShapeVisual', 'LayerVisual', 'PropertySet', 'LinearGradientBrush', 'RadialGradientBrush',
      'NineGridBrush', 'BackdropBrush', 'MaskBrush', 'RectangleGeometry', 'RoundedRectangleGeometry', 'EllipseGeometry', 'LineGeometry',
      'ContainerShape', 'RectangleClip', 'AmbientLight', 'PointLight', 'SpotLight', 'DistantLight',
      'ScalarKeyFrameAnimation', 'Vector2KeyFrameAnimation', 'Vector3KeyFrameAnimation', 'Vector4KeyFrameAnimation',
      'ColorKeyFrameAnimation', 'QuaternionKeyFrameAnimation', 'ImplicitAnimationCollection', 'AnimationGroup']
      .map(name => method('Create' + name, [], ['ContainerVisual', 'SpriteVisual', 'ShapeVisual', 'LayerVisual', 'ImplicitAnimationCollection'].includes(name)
        || name.endsWith('KeyFrameAnimation') || name.endsWith('Clip') || name.endsWith('Light') ? name : 'Composition' + name)),
    method('CreateDropShadow', [], 'DropShadow'),
    method('CreateColorBrush', [], 'CompositionColorBrush'), method('CreateColorBrush', ['Windows.UI.Color'], 'CompositionColorBrush'),
    method('CreateColorGradientStop', [], 'CompositionColorGradientStop'),
    method('CreateColorGradientStop', ['float', 'Windows.UI.Color'], 'CompositionColorGradientStop'),
    method('CreateSurfaceBrush', [], 'CompositionSurfaceBrush'), method('CreateSurfaceBrush', ['object'], 'CompositionSurfaceBrush'),
    method('CreatePathGeometry', [], 'CompositionPathGeometry'), method('CreatePathGeometry', ['object'], 'CompositionPathGeometry'),
    method('CreateSpriteShape', [], 'CompositionSpriteShape'), method('CreateSpriteShape', ['CompositionGeometry'], 'CompositionSpriteShape'),
    method('CreateInsetClip', [], 'InsetClip'), method('CreateInsetClip', ['float', 'float', 'float', 'float'], 'InsetClip'),
    method('CreateGeometricClip', [], 'GeometricClip'), method('CreateGeometricClip', ['CompositionGeometry'], 'GeometricClip'),
    method('CreateEffectFactory', ['object'], 'CompositionEffectFactory'),
    method('CreateExpressionAnimation', [], 'ExpressionAnimation'), method('CreateExpressionAnimation', ['string'], 'ExpressionAnimation'),
    method('CreateLinearEasingFunction', [], 'CompositionEasingFunction'),
    method('CreateCubicBezierEasingFunction', ['System.Numerics.Vector2', 'System.Numerics.Vector2'], 'CompositionEasingFunction'),
    method('CreateStepEasingFunction', [], 'CompositionEasingFunction'), method('CreateStepEasingFunction', ['int'], 'CompositionEasingFunction'),
    method('CreateScopedBatch', ['CompositionBatchTypes'], 'CompositionScopedBatch')
  ]},
  {name: 'Visual', base: 'CompositionObject', abstract: true, properties: [
    property('Offset', 'System.Numerics.Vector3'), property('Size', 'System.Numerics.Vector2'), property('Scale', 'System.Numerics.Vector3'),
    property('RotationAngle', 'float', 0), property('CenterPoint', 'System.Numerics.Vector3'), property('AnchorPoint', 'System.Numerics.Vector2'),
    property('Opacity', 'float', 1), property('IsVisible', 'bool', true), property('TransformMatrix', 'System.Numerics.Matrix4x4'), property('Clip', 'CompositionClip')
  ]},
  {name: 'ContainerVisual', base: 'Visual', properties: [property('Children', 'VisualCollection', null, true)]},
  {name: 'SpriteVisual', base: 'ContainerVisual', properties: [property('Brush', 'CompositionBrush'), property('Shadow', 'CompositionShadow')]},
  {name: 'ShapeVisual', base: 'ContainerVisual', properties: [property('Shapes', 'CompositionShapeCollection', null, true)]},
  {name: 'LayerVisual', base: 'ContainerVisual'},
  {name: 'CompositionBrush', base: 'CompositionObject', abstract: true, properties: [property('Opacity', 'float', 1)]},
  {name: 'CompositionColorBrush', base: 'CompositionBrush', properties: [property('Color', 'Windows.UI.Color')]},
  {name: 'CompositionGradientBrush', base: 'CompositionBrush', abstract: true, properties: [
    property('ColorStops', 'CompositionColorGradientStopCollection', null, true), property('MappingMode', 'CompositionMappingMode', 0),
    property('ExtendMode', 'CompositionGradientExtendMode', 0), property('InterpolationSpace', 'CompositionColorSpace', 0)]},
  {name: 'CompositionLinearGradientBrush', base: 'CompositionGradientBrush', properties: [
    property('StartPoint', 'System.Numerics.Vector2'), property('EndPoint', 'System.Numerics.Vector2')]},
  {name: 'CompositionRadialGradientBrush', base: 'CompositionGradientBrush', properties: [
    property('EllipseCenter', 'System.Numerics.Vector2'), property('EllipseRadius', 'System.Numerics.Vector2'),
    property('GradientOriginOffset', 'System.Numerics.Vector2')]},
  {name: 'CompositionColorGradientStop', base: 'CompositionObject', properties: [property('Offset', 'float', 0), property('Color', 'Windows.UI.Color')]},
  {name: 'CompositionSurfaceBrush', base: 'CompositionBrush', properties: [property('Surface', 'object'), property('Stretch', 'CompositionStretch', 2),
    property('HorizontalAlignmentRatio', 'float', 0.5), property('VerticalAlignmentRatio', 'float', 0.5)]},
  {name: 'CompositionNineGridBrush', base: 'CompositionBrush', properties: [property('Source', 'CompositionBrush'),
    ...['Left', 'Top', 'Right', 'Bottom'].map(side => property(side + 'Inset', 'float', 0))]},
  {name: 'CompositionBackdropBrush', base: 'CompositionBrush'},
  {name: 'CompositionMaskBrush', base: 'CompositionBrush', properties: [property('Source', 'CompositionBrush'), property('Mask', 'CompositionBrush')]},
  {name: 'CompositionClip', base: 'CompositionObject', abstract: true},
  {name: 'InsetClip', base: 'CompositionClip', properties: ['Left', 'Top', 'Right', 'Bottom'].map(side => property(side + 'Inset', 'float', 0))},
  {name: 'RectangleClip', base: 'CompositionClip', properties: ['Left', 'Top', 'Right', 'Bottom'].map(side => property(side, 'float', 0))},
  {name: 'GeometricClip', base: 'CompositionClip', properties: [property('Geometry', 'CompositionGeometry')]},
  {name: 'CompositionGeometry', base: 'CompositionObject', abstract: true,
    properties: [property('TrimStart', 'float', 0), property('TrimEnd', 'float', 1), property('TrimOffset', 'float', 0)]},
  {name: 'CompositionRectangleGeometry', base: 'CompositionGeometry', properties: [property('Offset', 'System.Numerics.Vector2'),
    property('Size', 'System.Numerics.Vector2')]},
  {name: 'CompositionRoundedRectangleGeometry', base: 'CompositionRectangleGeometry', properties: [property('CornerRadius', 'System.Numerics.Vector2')]},
  {name: 'CompositionEllipseGeometry', base: 'CompositionGeometry', properties: [property('Center', 'System.Numerics.Vector2'),
    property('Radius', 'System.Numerics.Vector2')]},
  {name: 'CompositionLineGeometry', base: 'CompositionGeometry', properties: [property('Start', 'System.Numerics.Vector2'), property('End', 'System.Numerics.Vector2')]},
  {name: 'CompositionPathGeometry', base: 'CompositionGeometry', properties: [property('Path', 'object')]},
  {name: 'CompositionShape', base: 'CompositionObject', abstract: true, properties: [property('Offset', 'System.Numerics.Vector2'),
    property('Scale', 'System.Numerics.Vector2'), property('RotationAngle', 'float', 0)]},
  {name: 'CompositionContainerShape', base: 'CompositionShape', properties: [property('Shapes', 'CompositionShapeCollection', null, true)]},
  {name: 'CompositionSpriteShape', base: 'CompositionShape', properties: [property('Geometry', 'CompositionGeometry'),
    property('FillBrush', 'CompositionBrush'), property('StrokeBrush', 'CompositionBrush'), property('StrokeThickness', 'float', 1),
    property('StrokeDashArray', 'CompositionStrokeDashArray', null, true), property('StrokeDashCap', 'CompositionStrokeCap', 0),
    property('StrokeDashOffset', 'float', 0), property('StrokeMiterLimit', 'float', 10), property('StrokeStartCap', 'CompositionStrokeCap', 0),
    property('StrokeEndCap', 'CompositionStrokeCap', 0), property('StrokeLineJoin', 'CompositionStrokeLineJoin', 0)]},
  {name: 'CompositionStrokeDashArray', base: 'CompositionObject', properties: [property('Count', 'int', 0, true),
    property('Size', 'uint', 0, true), property('IsReadOnly', 'bool', false, true)], methods: [
    method('get_Item', ['int'], 'float'), method('set_Item', ['int', 'float']), method('GetAt', ['uint'], 'float'),
    method('SetAt', ['uint', 'float']), method('InsertAt', ['uint', 'float']), method('Insert', ['int', 'float']),
    method('Add', ['float']), method('Append', ['float']), method('RemoveAt', ['int']), method('RemoveAtEnd'), method('Clear'),
    method('ReplaceAll', ['float[]']), method('Contains', ['float'], 'bool'), method('IndexOf', ['float'], 'int'),
    method('Remove', ['float'], 'bool'), method('CopyTo', ['float[]', 'int']), method('GetMany', ['uint', 'float[]'], 'uint')]},
  {name: 'CompositionShadow', base: 'CompositionObject', abstract: true},
  {name: 'DropShadow', base: 'CompositionShadow', properties: [property('BlurRadius', 'float', 16),
    property('Offset', 'System.Numerics.Vector3'), property('Color', 'Windows.UI.Color'), property('Opacity', 'float', 1),
    property('Mask', 'CompositionBrush')]},
  {name: 'CompositionEffectFactory', methods: [method('CreateBrush', [], 'CompositionEffectBrush')]},
  {name: 'CompositionEffectBrush', base: 'CompositionBrush', methods: [method('SetSourceParameter', ['string', 'CompositionBrush']),
    method('GetSourceParameter', ['string'], 'CompositionBrush')]},
  ...['AmbientLight', 'PointLight', 'SpotLight', 'DistantLight'].map(name => ({name, base: 'CompositionObject'})),
  {name: 'CompositionAnimation', base: 'CompositionObject', abstract: true, properties: [property('Target', 'string', '')], methods: [
    ...['Scalar', 'Vector2', 'Vector3', 'Vector4', 'Color'].map(kind => method('Set' + kind + 'Parameter', ['string', kind === 'Scalar'
      ? 'float' : kind === 'Color' ? 'Windows.UI.Color' : 'System.Numerics.' + kind])),
    method('SetReferenceParameter', ['string', 'CompositionObject']), method('ClearParameter', ['string'])]},
  {name: 'KeyFrameAnimation', base: 'CompositionAnimation', abstract: true, properties: [
    property('Duration', 'System.TimeSpan'), property('DelayTime', 'System.TimeSpan'), property('DelayBehavior', 'AnimationDelayBehavior', 0),
    property('IterationBehavior', 'AnimationIterationBehavior', 0), property('IterationCount', 'int', 1),
    property('Direction', 'AnimationDirection', 0), property('StopBehavior', 'AnimationStopBehavior', 0), property('KeyFrameCount', 'int', 0, true)],
    methods: [method('InsertExpressionKeyFrame', ['float', 'string']),
      method('InsertExpressionKeyFrame', ['float', 'string', 'CompositionEasingFunction'])]},
  ...['Scalar', 'Vector2', 'Vector3', 'Vector4', 'Color', 'Quaternion'].map(kind => ({name: kind + 'KeyFrameAnimation', base: 'KeyFrameAnimation',
    methods: [method('InsertKeyFrame', ['float', kind === 'Scalar' ? 'float' : kind === 'Color' ? 'Windows.UI.Color' : 'System.Numerics.' + kind]),
      method('InsertKeyFrame', ['float', kind === 'Scalar' ? 'float' : kind === 'Color' ? 'Windows.UI.Color' : 'System.Numerics.' + kind, 'CompositionEasingFunction'])]})),
  {name: 'ExpressionAnimation', base: 'CompositionAnimation', properties: [property('Expression', 'string', '')]},
  {name: 'CompositionEasingFunction'},
  {name: 'AnimationController', properties: [property('Progress', 'float', 0), property('PlaybackRate', 'float', 1)],
    methods: [method('Pause'), method('Resume')]},
  {name: 'CompositionAnimationGroup', methods: [method('Add', ['CompositionAnimation']), method('Remove', ['CompositionAnimation']), method('RemoveAll')],
    properties: [property('Count', 'int', 0, true)]},
  {name: 'ImplicitAnimationCollection', properties: [property('Count', 'int', 0, true)], methods: [
    method('Insert', ['string', 'CompositionAnimation'], 'bool'), method('Lookup', ['string'], 'CompositionAnimation'),
    method('HasKey', ['string'], 'bool'), method('Remove', ['string']), method('Clear')]},
  {name: 'CompositionScopedBatch', methods: [method('End')], events: ['Completed']},
  {name: 'CompositionPropertySet', base: 'CompositionObject', methods: Object.entries(compositionPropertyTypes)
    .map(([kind, type]) => method('Insert' + kind, ['string', type]))}
];

export const compositionCollections = [
  ['VisualCollection', 'Visual', ['InsertAtTop', 'InsertAtBottom', 'Remove'], ['InsertAbove', 'InsertBelow'], 'RemoveAll'],
  ['CompositionShapeCollection', 'CompositionShape', ['Add', 'Remove'], [], 'Clear'],
  ['CompositionColorGradientStopCollection', 'CompositionColorGradientStop', ['Add', 'Remove'], [], 'Clear']
];
