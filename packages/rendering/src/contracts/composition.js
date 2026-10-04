import {COMPOSITION as C, compositionTypeSpecs, compositionCollections, compositionPropertyTypes} from './composition-surface.js';
import {registerTimelineContracts} from './timelines.js';
import {registerTransitionContracts} from './transitions.js';

const enums = Object.freeze({
  CompositionGetValueStatus: {Succeeded: 0, TypeMismatch: 1, NotFound: 2},
  AnimationDirection: {Normal: 0, Reverse: 1, Alternate: 2, AlternateReverse: 3},
  AnimationStopBehavior: {LeaveCurrentValue: 0, SetToInitialValue: 1, SetToFinalValue: 2},
  AnimationIterationBehavior: {Count: 0, Forever: 1},
  AnimationDelayBehavior: {SetInitialValueBeforeDelay: 0, SetInitialValueAfterDelay: 1},
  CompositionBatchTypes: {None: 0, Animation: 1, Effect: 2, InfiniteAnimation: 4, AllAnimations: 5},
  CompositionStretch: {None: 0, Fill: 1, Uniform: 2, UniformToFill: 3},
  CompositionMappingMode: {Relative: 0, Absolute: 1},
  CompositionGradientExtendMode: {Clamp: 0, Wrap: 1, Mirror: 2},
  CompositionColorSpace: {Auto: 0, Hsl: 1, Rgb: 2, HslLinear: 3, RgbLinear: 4},
  CompositionStrokeCap: {Flat: 0, Square: 1, Round: 2, Triangle: 3},
  CompositionStrokeLineJoin: {Miter: 0, Bevel: 1, Round: 2}
});

export function ensureNumericsContracts(registry) {
  const {define, ctor, prop, types} = registry;
  const values = [['Windows.Foundation.Point', ['X', 'Y'], 'double'],
    ...['Vector2', 'Vector3', 'Vector4', 'Quaternion'].map(name => ['System.Numerics.' + name,
      ['X', 'Y', 'Z', 'W'].slice(0, name === 'Vector2' ? 2 : name === 'Vector3' ? 3 : 4), 'float']),
    ['System.Numerics.Matrix4x4', Array.from({length: 16}, (_, index) => `M${Math.floor(index / 4) + 1}${index % 4 + 1}`), 'float']];
  for (const [name, slots, type] of values) {
    if (types.has(name)) continue;
    define(name, {kind: 'value', slots, base: 'System.ValueType'});
    ctor(name);
    ctor(name, slots.map(() => type));
    for (const slot of slots) prop(name, slot, type, 0);
  }
}

/** Additive A17 registration; no released contract identifier is renumbered. */
export function registerCompositionContracts(registry) {
  const {define, ctor, prop, member, event, en} = registry;
  ensureNumericsContracts(registry);
  for (const [name, values] of Object.entries(enums)) en(C + name, values);
  const localNames = new Set([...compositionTypeSpecs.map(spec => spec.name), ...compositionCollections.map(row => row[0]), ...Object.keys(enums)]);
  const full = name => localNames.has(name) ? C + name : name;
  for (const spec of compositionTypeSpecs) define(C + spec.name, {kind: spec.abstract ? 'abstract' : 'composition', base: full(spec.base ?? 'object')});
  for (const [name, element] of compositionCollections) define(C + name, {kind: 'collection', element: C + element});
  for (const spec of compositionTypeSpecs) {
    const owner = C + spec.name;
    if (spec.constructor === true) ctor(owner);
    for (const property of spec.properties ?? []) prop(owner, property.name, full(property.type), property.value, property.readOnly);
    for (const method of spec.methods ?? []) member(owner, method.name, method.parameters.map(full), full(method.result));
    for (const name of spec.events ?? []) event(owner, name);
  }
  for (const [name, element, unary, binary, clear] of compositionCollections) {
    const owner = C + name;
    prop(owner, 'Count', 'int', 0, true);
    member(owner, 'get_Item', ['int'], C + element);
    for (const method of unary) member(owner, method, [C + element], method === 'Remove' && name !== 'VisualCollection' ? 'bool' : 'void');
    for (const method of binary) member(owner, method, [C + element, C + element], 'void');
    member(owner, clear, [], 'void');
  }
  for (const [kind, type] of Object.entries(compositionPropertyTypes)) {
    member(C + 'CompositionPropertySet', 'TryGet' + kind, ['string', type + '&'], C + 'CompositionGetValueStatus',
      {parameterModes: ['value', 'out']});
  }
  member(C + 'CompositionStrokeDashArray', 'IndexOf', ['float', 'uint&'], 'bool', {parameterModes: ['value', 'out']});
  const preview = 'Microsoft.UI.Xaml.Hosting.ElementCompositionPreview';
  define(preview, {kind: 'static'});
  const element = 'Microsoft.UI.Xaml.UIElement';
  member(preview, 'GetElementVisual', [element], C + 'Visual', {isStatic: true});
  member(preview, 'GetElementChildVisual', [element], C + 'Visual', {isStatic: true});
  member(preview, 'SetElementChildVisual', [element, C + 'Visual'], 'void', {isStatic: true});
  member(preview, 'SetIsTranslationEnabled', [element, 'bool'], 'void', {isStatic: true});
  const surface = 'Microsoft.UI.Xaml.Media.LoadedImageSurface';
  define(surface, {kind: 'composition'});
  member(surface, 'StartLoadFromUri', ['System.Uri'], surface, {isStatic: true});
  member(surface, 'Dispose', [], 'void');
  event(surface, 'LoadCompleted');
  registerTimelineContracts(registry);
  registerTransitionContracts(registry);
}
