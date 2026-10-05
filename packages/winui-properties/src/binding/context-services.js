import {readPathStep, writePathStep, observePathStep} from './accessors.js';
import {convertBindingValue} from './type-converters.js';

/** Supply host member/event access explicitly; plain JavaScript models use the same parsed steps. */
export function createBindingServices(context, options = {}) {
  const injected = context.bindingServices ?? context.services?.binding ?? {};
  const registry = options.registry ?? context.propertyRegistry;
  const storeFor = options.storeFor ?? (object => context.storeFor(object));
  const typeDefinition = options.typeDefinition ?? context.services?.typeDefinition;
  const nativeModel = object => context.unwrapModel?.(object) ?? object;
  const ownerScope = owner => {
    const reference = owner?.$values?.$nameScope;
    return context.services?.namescopeFor?.(owner) ?? (reference ? context.unwrapModel(reference) : owner?.$namescope);
  };
  const vectorSource = (object, step) => context.vectorFor && object?.$node
    && (typeDefinition ?? registry?.services?.typeDefinition)?.(object.$node.type)?.kind === 'collection'
    && (step.kind === 'index' || ['Item', 'Count', 'Length', 'Size'].includes(step.name)) ? context.vectorFor(object) : null;

  function property(object, step) {
    if (!object?.$node || step.kind === 'index') return null;
    if (!registry.isAssignable('Microsoft.UI.Xaml.DependencyObject', object.$node.type)) return null;
    return registry.lookup(step.owner ?? object.$node.type, step.name);
  }

  function read(object, step) {
    const native = nativeModel(object);
    if (native !== object) return readPathStep(native, step, {});
    const vector = vectorSource(object, step);
    if (vector) return step.kind === 'index' ? readPathStep(vector, step, {}) : vector.Count;
    const token = property(object, step);
    return token ? storeFor(object).getValue(token) : readPathStep(object, step, {});
  }

  function write(object, step, value) {
    const native = nativeModel(object);
    if (native !== object) return writePathStep(native, step, value, {});
    const vector = vectorSource(object, step);
    if (vector) {
      if (step.kind !== 'index') throw new TypeError('Vector size is read-only');
      return vector.set_Item(step.key, value);
    }
    const token = property(object, step);
    return token ? storeFor(object).setValue(token, value) : writePathStep(object, step, value, {});
  }

  function subscribe(object, step, changed) {
    const native = nativeModel(object);
    if (native !== object) return observePathStep(native, step, changed, {});
    const vector = vectorSource(object, step);
    if (vector) return observePathStep(vector, {...step, name: ['Length', 'Size'].includes(step.name) ? 'Count' : step.name}, changed, {});
    const token = property(object, step);
    return token ? storeFor(object).subscribe(token, changed) : observePathStep(object, step, changed, {});
  }

  return {
    storeFor, read, write, subscribe,
    typeOf: object => context.typeOf?.(object),
    findName: (owner, name) => context.findName?.(owner, name) ?? ownerScope(owner)?.findName(name) ?? null,
    subscribeNameScope: (owner, changed, name) => ownerScope(owner)?.subscribe(name, changed),
    templatedParent: owner => owner?.$values?.$templateOwner ?? owner?.$templateOwner ?? null,
    diagnostics: diagnostic => context.services?.bindingDiagnostics?.(diagnostic),
    stateChanged: owner => { if (!context.isAlive || context.isAlive(owner)) context.syncOwner?.(owner); },
    convert: (value, type) => convertBindingValue(value, type, {typeDefinition, ...context.services?.conversion}),
    sourcePropertyType: (object, step) => property(object, step)?.propertyType ?? 'object',
    ...injected
  };
}
