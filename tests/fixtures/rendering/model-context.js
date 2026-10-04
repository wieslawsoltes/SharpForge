import {DrawingModel} from '../../../packages/rendering/src/media/models.js';

/** Explicit adapter-contract recorder; cross-engine tests separately exercise the actual VM property store and heap. */
export function createModelContext() {
  const states = new WeakMap(), wrappers = new WeakMap(), values = new WeakMap(), defaults = new WeakMap();
  const media = 'Microsoft.UI.Xaml.Media.', foundation = 'Windows.Foundation.';
  const bases = new Map([['CustomBrush', media + 'XamlCompositionBrushBase'],
    [media + 'XamlCompositionBrushBase', media + 'Brush'], [media + 'Brush', 'Microsoft.UI.Xaml.DependencyObject'],
    [media + 'SolidColorBrush', media + 'Brush'], [media + 'LineSegment', 'Microsoft.UI.Xaml.DependencyObject']]);
  const properties = new Map([[media + 'LineSegment', {Point: {type: foundation + 'Point'}}],
    [media + 'Brush', {Opacity: {type: 'double'}}],
    [media + 'XamlCompositionBrushBase', {CompositionBrush: {type: 'Microsoft.UI.Composition.CompositionBrush'}}],
    [media + 'SolidColorBrush', {Color: {type: 'Windows.UI.Color'}}],
    ['Visual', {Background: {type: media + 'Brush'}}]]);
  const mapFor = (store, owner) => {
    let entries = store.get(owner);
    if (!entries) { entries = new Map(); store.set(owner, entries); }
    return entries;
  };
  const context = {
    calls: [], bases, properties, defaults, values, modelReferences: wrappers,
    services: {invalidateRendering() {}},
    typeOf: value => value.type,
    baseType: type => bases.get(type),
    frameworkRegistry: {frameworkType: type => type === 'CustomBrush' ? null : {base: bases.get(type)}},
    propertiesFor(type) { return {...(bases.has(type) ? context.propertiesFor(bases.get(type)) : {}), ...properties.get(type)}; },
    state(owner, key, factory) {
      const map = mapFor(states, owner);
      if (!map.has(key) && factory) map.set(key, factory());
      return map.get(key);
    },
    model(owner, {factory} = {}) { return context.state(owner, 'nativeModel', factory); },
    unwrapModel(owner) { return owner && typeof owner === 'object' ? context.state(owner, 'nativeModel') : undefined; },
    native(value) { return context.unwrapModel(value) ?? value?.data ?? value; },
    managed: value => value,
    allocate: (type, data) => ({type, data}),
    wrapModel(model, type) {
      if (wrappers.has(model)) return wrappers.get(model);
      const reference = {type}; wrappers.set(model, reference);
      context.state(reference, 'nativeModel', () => model); return reference;
    },
    read(owner, name) { return mapFor(values, owner).get(name) ?? mapFor(defaults, owner).get(name); },
    write(owner, name, value) {
      if (name === 'Opacity') value = Math.min(1, Math.max(0, value));
      mapFor(values, owner).set(name, value);
      const model = context.unwrapModel(owner);
      if (model instanceof DrawingModel) model.set(name, context.native(value));
    },
    seed(owner, name, value) { mapFor(defaults, owner).set(name, value); },
    writeReference(reference, value) { reference.value = value; },
    invokeVirtual(owner, name) { context.calls.push({owner, name}); },
    isVisual: owner => owner?.type === 'Visual',
    id: owner => owner.id,
    items: value => value.items ?? value,
    task: promise => promise
  };
  return context;
}
