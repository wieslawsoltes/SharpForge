import {Style, Setter} from '../styles/style.js';
import {PropertyFault} from './values.js';

/** Translate legacy framework wrappers into the one shared typed style model. */
export function createJavaScriptStyleModels({objects, registry, canonicalType, classes, unwrapModel = value => value}) {
  const models = new WeakMap();
  const sealed = new WeakSet();

  function typeName(value) {
    if (typeof value === 'string') return canonicalType(value);
    if (typeof value === 'function') {
      for (const [name, constructor] of classes) if (constructor === value) return name;
    }
    return canonicalType(value?.fullName ?? value?.FullName ?? value?.name ?? value);
  }

  function compile(wrapper, definitions = new Map(), seen = new Set()) {
    if (wrapper === null || wrapper === undefined) return {style: null, definitions};
    const native = unwrapModel(wrapper);
    if (native instanceof Style) {
      if (native !== wrapper) definitions.set(wrapper, native);
      return {style: native, definitions};
    }
    if (models.has(wrapper)) return {style: models.get(wrapper), definitions};
    if (wrapper.$context !== objects || wrapper.$node?.type !== 'Microsoft.UI.Xaml.Style') {
      throw new PropertyFault('ArgumentException', 'Style belongs to another application or has an invalid type');
    }
    if (seen.has(wrapper) || seen.size >= 256) throw new PropertyFault('InvalidOperationException', 'Style BasedOn cycle or depth limit');
    seen.add(wrapper);
    const target = wrapper.$values.TargetType ?? wrapper.$values.TargetTypeName;
    if (!target) throw new PropertyFault('InvalidOperationException', 'Style.TargetType is required before application');
    const basedOn = compile(wrapper.$values.BasedOn, definitions, seen).style;
    const setters = [];
    for (const value of wrapper.Setters ?? []) {
      const property = unwrapModel(value.Property);
      if (property) registry.resolve(property);
      const setter = new Setter(property, value.Value, {target: value.Target ?? null});
      definitions.set(value, setter);
      setters.push(setter);
    }
    const legacyMutable = typeof target === 'string' && !wrapper.$values.TargetType;
    const style = new Style(typeName(target), {basedOn, setters, legacyMutable});
    definitions.set(wrapper, style);
    return {style, definitions};
  }

  function applied(result) {
    for (const [wrapper, model] of result.definitions) {
      if (model.isSealed) sealed.add(wrapper);
      if (model instanceof Style && model.isSealed) models.set(wrapper, model);
    }
  }

  function assertMutable(wrapper) {
    if (sealed.has(wrapper) || unwrapModel(wrapper)?.isSealed) {
      throw new PropertyFault('InvalidOperationException', 'Applied styles and setters are sealed');
    }
  }

  return {compile, applied, assertMutable, isSealed: wrapper => sealed.has(wrapper), typeName};
}
