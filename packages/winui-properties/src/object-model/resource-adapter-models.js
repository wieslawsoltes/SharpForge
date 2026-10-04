import {ResourceDictionary} from '../resources/resource-dictionary.js';
import {resourceTargetType} from './resource-target-type.js';
import {ResourceScope} from '../resources/resource-scope.js';
import {NameScope} from '../templates/name-scope.js';
import {Style, Setter} from '../styles/style.js';
import {ResourceFault} from '../resources/errors.js';

/** An adapter-backed collection preserves identity while delegating mutation to its owning model. */
export class ResourceModelCollection {
  constructor({owner, read, write, unwrap = value => value}) {
    this.owner = owner;
    this.read = read;
    this.write = write;
    this.unwrap = unwrap;
    this.reconstructible = true;
  }

  get count() { return this.read().length; }
  [Symbol.iterator]() { return this.read()[Symbol.iterator](); }
  get(index) { this.checkIndex(index); return this.read()[index]; }
  add(value) { this.insert(this.count, value); }
  insert(index, value) {
    this.checkIndex(index, true);
    const next = [...this.read()];
    next.splice(index, 0, this.unwrap(value));
    this.write(next);
  }
  remove(value) {
    const index = this.read().indexOf(this.unwrap(value));
    if (index < 0) return false;
    this.removeAt(index);
    return true;
  }
  removeAt(index) {
    this.checkIndex(index);
    const next = [...this.read()];
    next.splice(index, 1);
    this.write(next);
  }
  clear() { this.write([]); }
  checkIndex(index, insertion = false) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count + (insertion ? 1 : 0)) throw new RangeError('Invalid collection index.');
  }
  *retainedValues() {
    yield this.owner;
    for (const value of this.read()) {
      if (value?.retainedValues) yield* value.retainedValues();
      else yield value;
    }
  }
}

export function dictionaryModel(context, reference) {
  const value = context.unwrapModel(reference);
  if (value instanceof ResourceDictionary) return value;
  return context.state(reference, 'resourceDictionary', () => new ResourceDictionary());
}

export function nameScopeModel(context, reference) {
  const value = context.unwrapModel(reference);
  if (value instanceof NameScope) return value;
  return context.state(reference, 'nameScope', () => new NameScope({owner: reference}));
}

export function resourceScopeModel(context, reference) {
  if (context.resourceScopeFor) return context.resourceScopeFor(reference);
  return context.state(reference, 'resourceScope', () => {
    const resources = context.read(reference, 'Resources');
    return new ResourceScope({owner: reference, resources: resources ? dictionaryModel(context, resources) : new ResourceDictionary()});
  });
}

export function nativeResourceKey(context, value) {
  const type = context.typeOf(value);
  if (type === 'System.Type' || type === 'System.RuntimeType'
    || typeof value === 'function' && typeof value.$type === 'string') return context.typeName(value);
  const native = context.native(value);
  return native !== undefined && (native === null || typeof native !== 'object') ? native : context.id(value);
}

export function setterModel(context, reference) {
  const value = context.unwrapModel(reference);
  if (value instanceof Setter) return value;
  return context.state(reference, 'setter', () => {
    const property = context.read(reference, 'Property');
    const target = context.read(reference, 'Target');
    const token = property ? context.properties.resolve(property) : undefined;
    const value = context.read(reference, 'Value');
    return new Setter(token, token ? context.properties.toNative(value, token.propertyType) : context.native(value),
      {target: target ? context.native(context.read(target, 'Path')) : null});
  });
}

export function styleModel(context, reference) {
  if (reference === null) return null;
  const value = context.unwrapModel(reference);
  if (value instanceof Style) return value;
  return context.state(reference, 'style', () => {
    const style = new Style(resourceTargetType(context, reference, 'object'));
    const basedOn = context.read(reference, 'BasedOn');
    if (basedOn) style.basedOn = styleModel(context, basedOn);
    const setters = context.read(reference, 'Setters');
    if (setters) style.setters = (context.items?.(setters) ?? []).map(setter => setterModel(context, setter));
    return style;
  });
}

export function requireMutableStyle(model) {
  if (model.isSealed) throw new ResourceFault('SFSTYLE016', 'An applied Style and its Setters are sealed.');
}
