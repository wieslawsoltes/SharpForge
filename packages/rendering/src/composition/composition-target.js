import {snapshotCompositionObject, restoreCompositionObject} from './snapshot.js';

/** Native composition values stay local to the compositor; writes do not invoke managed layout. */
export class CompositionTarget {
  constructor(compositor, kind, schema = {}) {
    if (!compositor || compositor.closed) throw new TypeError('A live Compositor is required');
    this.Compositor = compositor;
    this.kind = kind;
    this.id = compositor.allocate(this);
    this.schema = schema;
    this.baseValues = Object.create(null);
    this.animatedValues = Object.create(null);
    this.Properties = null;
    this.ImplicitAnimations = null;
    this.version = 1;
    this.closed = false;
    for (const [name, specification] of Object.entries(schema)) {
      this.baseValues[name] = specification.default;
      Object.defineProperty(this, name, {enumerable: true, get: () => this.get(name), set: value => this.set(name, value)});
    }
  }

  get(name) {
    if (this.closed) throw new Error('Composition object is disposed');
    if (!Object.hasOwn(this.schema, name)) throw new TypeError(`Unknown ${this.kind} property: ${name}`);
    return Object.hasOwn(this.animatedValues, name) ? this.animatedValues[name] : this.baseValues[name];
  }

  validate(name, value) {
    const specification = Object.hasOwn(this.schema, name) ? this.schema[name] : null;
    if (!specification) throw new TypeError(`Unknown ${this.kind} property: ${name}`);
    return specification.validate ? specification.validate(value, this) : value;
  }

  set(name, value) {
    if (this.closed) throw new Error('Composition object is disposed');
    const validated = this.validate(name, value);
    const previous = this.get(name);
    this.Compositor.link(this, this.baseValues[name], validated);
    this.baseValues[name] = validated;
    const implicit = this.ImplicitAnimations?.get(name);
    if (implicit && this.Compositor.animations) this.Compositor.animations.start(this, name, implicit, {startingValue: previous, finalValue: validated});
    this.changed(name);
  }

  setAnimated(name, value) {
    this.animatedValues[name] = this.validate(name, value);
    this.changed(name, true);
  }

  clearAnimated(name) {
    if (!Object.hasOwn(this.animatedValues, name)) return;
    delete this.animatedValues[name];
    this.changed(name, true);
  }

  changed(name, animated = false) {
    this.version++;
    this.Compositor.invalidate(this, name, {animated});
  }

  StartAnimation(name, animation) { return this.Compositor.animations.start(this, name, animation); }
  StartAnimationGroup(group) { return this.Compositor.animations.start(this, '', group); }
  StopAnimationGroup(group) {
    if (group?.Compositor !== this.Compositor || !group.animations) throw new TypeError('Invalid animation group');
    for (const animation of group.animations) this.StopAnimation(animation.Target);
  }
  StopAnimation(name) { return this.Compositor.animations.stop(this, name); }
  TryGetAnimationController(name) { return this.Compositor.animations.controller(this, name); }

  *retainedValues() {
    yield this.Compositor;
    yield this.Properties;
    yield this.ImplicitAnimations;
    yield* Object.values(this.baseValues);
    yield* Object.values(this.animatedValues);
    // Managed collection mutations refresh the collection wrapper's roots, not its owner's cached item list.
    if (this.Children) yield this.Children;
    if (this.Shapes) yield this.Shapes;
    if (this.ColorStops) yield this.ColorStops;
  }
  snapshot() { return snapshotCompositionObject(this); }
  restore(snapshot) { restoreCompositionObject(this, snapshot); }

  dispose() {
    if (this.closed) return;
    this.Compositor.animations?.stopAll(this);
    if (this.Properties !== this) this.Properties?.dispose();
    this.Compositor.forget(this);
    for (const value of [...Object.values(this.baseValues), ...(this.Shapes ?? []), ...(this.ColorStops ?? []), ...(this.sources?.values() ?? [])]) {
      this.Compositor.link(this, value, null);
    }
    this.closed = true;
  }
}

export function owned(value, owner, predicate) {
  if (value === null) return null;
  if (value?.Compositor !== owner.Compositor || value.closed || (predicate && !predicate(value))) {
    throw new TypeError('A compatible object from the same Compositor is required');
  }
  const pending = [value];
  const visited = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (item === owner) throw new TypeError('Composition resource cycle');
    if (visited.has(item)) continue;
    visited.add(item);
    if (visited.size > 10000) throw new RangeError('Composition reference graph limit exceeded');
    for (const child of Object.values(item?.baseValues ?? {})) if (child?.Compositor) pending.push(child);
    for (const child of item?.Shapes ?? []) pending.push(child);
    for (const child of item?.sources?.values() ?? []) pending.push(child);
  }
  return value;
}
