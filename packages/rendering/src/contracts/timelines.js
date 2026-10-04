const X = 'Microsoft.UI.Xaml.';
const A = X + 'Media.Animation.';

function keyframeContracts(registry, kind, type) {
  const {define, ctor, prop, member} = registry;
  const frame = A + kind + 'KeyFrame';
  define(frame, {kind: 'abstract', base: X + 'DependencyObject'});
  prop(frame, 'KeyTime', A + 'KeyTime');
  prop(frame, 'Value', type);
  const collection = A + kind + 'KeyFrameCollection';
  define(collection, {kind: 'collection', element: frame});
  prop(collection, 'Count', 'int', 0, true);
  for (const [name, parameters, result] of [['Add', [frame], 'void'], ['Insert', ['int', frame], 'void'],
    ['get_Item', ['int'], frame], ['Remove', [frame], 'bool'], ['RemoveAt', ['int'], 'void'], ['Clear', [], 'void']]) {
    member(collection, name, parameters, result);
  }
  const modes = kind === 'Object' ? ['Discrete'] : ['Linear', 'Discrete', 'Easing', 'Spline'];
  for (const mode of modes) {
    const name = A + mode + kind + 'KeyFrame';
    define(name, {kind: 'animation', base: frame});
    ctor(name);
    if (mode === 'Easing') prop(name, 'EasingFunction', A + 'EasingFunctionBase');
    if (mode === 'Spline') prop(name, 'KeySpline', A + 'KeySpline');
  }
  const animation = A + kind + 'AnimationUsingKeyFrames';
  define(animation, {kind: 'animation', base: A + 'Timeline'});
  ctor(animation);
  prop(animation, 'KeyFrames', collection, null, true);
  prop(animation, 'EnableDependentAnimation', 'bool', false);
}

export function registerTimelineContracts(registry) {
  const {define, ctor, prop, member, types} = registry;
  define(A + 'KeyTime', {kind: 'value', slots: [], base: 'System.ValueType'});
  prop(A + 'KeyTime', 'TimeSpan', 'System.TimeSpan', null, true);
  member(A + 'KeyTime', 'FromTimeSpan', ['System.TimeSpan'], A + 'KeyTime', {isStatic: true});
  define(A + 'KeySpline', {kind: 'animation', base: X + 'DependencyObject'});
  ctor(A + 'KeySpline');
  ctor(A + 'KeySpline', ['double', 'double', 'double', 'double']);
  prop(A + 'KeySpline', 'ControlPoint1', 'Windows.Foundation.Point');
  prop(A + 'KeySpline', 'ControlPoint2', 'Windows.Foundation.Point');
  for (const [kind, fields] of [['BounceEase', {Bounces: ['int', 3], Bounciness: ['double', 2]}],
    ['ElasticEase', {Oscillations: ['int', 3], Springiness: ['double', 3]}], ['ExponentialEase', {Exponent: ['double', 2]}]]) {
    define(A + kind, {kind: 'easing', base: A + 'EasingFunctionBase'});
    ctor(A + kind);
    for (const [name, [type, value]] of Object.entries(fields)) prop(A + kind, name, type, value);
  }
  for (const [kind, type] of [['Color', 'Windows.UI.Color'], ['Point', 'Windows.Foundation.Point']]) {
    const name = A + kind + 'Animation';
    define(name, {kind: 'animation', base: A + 'Timeline'});
    ctor(name);
    for (const property of ['From', 'To', 'By']) prop(name, property, type);
    prop(name, 'EasingFunction', A + 'EasingFunctionBase');
    prop(name, 'EnableDependentAnimation', 'bool', false);
  }
  for (const [kind, type] of [['Double', 'double'], ['Color', 'Windows.UI.Color'], ['Point', 'Windows.Foundation.Point'], ['Object', 'object']]) {
    keyframeContracts(registry, kind, type);
  }
  for (const type of types.values()) {
    if (!type.name.startsWith(A)) continue;
    for (const [name, property] of Object.entries({...type.properties})) {
      if (!property.isStatic && !property.readOnly && !type.properties[name + 'Property']) {
        prop(type.name, name + 'Property', X + 'DependencyProperty', null, true, true);
      }
    }
  }
}
