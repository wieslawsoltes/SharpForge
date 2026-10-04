import {ResourceFault} from '../resources/errors.js';
import {StyleDefinitionChanges} from './definition-changes.js';

/** A typed setter becomes immutable on application; debugger restore changes backing state without callbacks. */
export class Setter {
  #property;
  #value;
  #target;
  #sealed = false;
  #changes = new StyleDefinitionChanges();

  constructor(property, value, {target = null} = {}) {
    this.#property = property;
    this.#value = value;
    this.#target = target;
  }

  get property() { return this.#property; }
  set property(value) {
    this.assertMutable();
    const previous = this.#property;
    this.#changes.mutate(() => { this.#property = value; }, () => { this.#property = previous; });
  }
  get value() { return this.#value; }
  set value(value) {
    this.assertMutable();
    const previous = this.#value;
    this.#changes.mutate(() => { this.#value = value; }, () => { this.#value = previous; });
  }
  get target() { return this.#target; }
  set target(value) {
    this.assertMutable();
    const previous = this.#target;
    this.#changes.mutate(() => { this.#target = value; }, () => { this.#target = previous; });
  }
  get isSealed() { return this.#sealed; }

  assertMutable() {
    if (this.#sealed) throw new ResourceFault('SFSTYLE016', 'An applied Setter is sealed.');
  }

  seal() { this.#sealed = true; }
  subscribe(listener) { return this.#changes.subscribe(listener); }
  *retainedValues() { yield this.#property; yield this.#value; }
  snapshot() { return {property: this.#property, value: this.#value, target: this.#target, sealed: this.#sealed}; }
  restore(snapshot) {
    this.#property = snapshot.property;
    this.#value = snapshot.value;
    this.#target = snapshot.target;
    this.#sealed = snapshot.sealed;
  }
}

/** Typed styles seal on application; the explicit legacy string-constructor profile retains live definitions. */
export class Style {
  #targetType;
  #basedOn;
  #setters;
  #sealed = false;
  #compiled = null;
  #legacyMutable;
  #changes = new StyleDefinitionChanges();

  constructor(targetType, {basedOn = null, setters = [], legacyMutable = false} = {}) {
    if (!targetType) throw new ResourceFault('SFSTYLE001', 'Style.TargetType is required.');
    this.#targetType = targetType;
    this.#basedOn = basedOn;
    this.#setters = Array.from(setters);
    this.#legacyMutable = Boolean(legacyMutable);
  }

  get targetType() { return this.#targetType; }
  set targetType(value) {
    this.assertMutable();
    const previous = this.#targetType;
    this.#changes.mutate(() => { this.#targetType = value; }, () => { this.#targetType = previous; });
  }
  get basedOn() { return this.#basedOn; }
  set basedOn(value) {
    this.assertMutable();
    const previous = this.#basedOn;
    this.#changes.mutate(() => { this.#basedOn = value; }, () => { this.#basedOn = previous; });
  }
  get setters() { return this.#setters; }
  set setters(value) {
    this.assertMutable();
    const previous = this.#setters;
    this.#changes.mutate(() => { this.#setters = Array.from(value); }, () => { this.#setters = previous; });
  }
  get isSealed() { return this.#sealed; }
  get legacyMutable() { return this.#legacyMutable; }
  subscribe(listener) { return this.#changes.subscribe(listener); }

  assertMutable() {
    if (this.#sealed) throw new ResourceFault('SFSTYLE016', 'An applied Style is sealed.');
    this.#compiled = null;
  }

  /** Flatten BasedOn once. Target compatibility uses registry type identity/assignability. */
  compile(registry) {
    if (this.#compiled) return this.#compiled;
    const chain = [];
    const seen = new Set();
    for (let style = this; style; style = style.basedOn) {
      if (!(style instanceof Style)) throw new ResourceFault('SFSTYLE002', 'Style.BasedOn must be a Style.');
      if (seen.has(style) || seen.size >= 256) throw new ResourceFault('SFSTYLE003', 'Style.BasedOn cycle or depth limit.');
      if (!registry.isAssignable(style.targetType, this.targetType)) {
        throw new ResourceFault('SFSTYLE004', 'The BasedOn target type is incompatible with the derived style.');
      }
      seen.add(style);
      chain.push(style);
    }
    const setters = [];
    for (let index = chain.length - 1; index >= 0; index--) {
      for (const setter of chain[index].setters) {
        if (!(setter instanceof Setter)) throw new ResourceFault('SFSTYLE005', 'Style.Setters only accepts Setter values.');
        if (setter.property === undefined && !setter.target) throw new ResourceFault('SFSTYLE006', 'A setter property or target is required.');
        setters.push(setter);
      }
    }
    return {chain, setters};
  }

  seal(registry) {
    if (this.#sealed) return;
    const compiled = this.compile(registry);
    if (this.#legacyMutable) {
      for (const style of compiled.chain) if (!style.#legacyMutable) style.seal(registry);
      return;
    }
    this.#compiled = Object.freeze({setters: Object.freeze(compiled.setters)});
    for (const style of compiled.chain) {
      if (style.#sealed) continue;
      for (const setter of style.#setters) setter.seal();
      Object.freeze(style.#setters);
      style.#sealed = true;
    }
  }

  *retainedValues() {
    const seen = new Set();
    for (let style = this; style instanceof Style && !seen.has(style); style = style.basedOn) {
      if (seen.size >= 256) throw new ResourceFault('SFSTYLE003', 'Style.BasedOn depth limit.');
      seen.add(style);
      yield style.targetType;
      for (const setter of style.setters) yield* setter.retainedValues();
    }
  }

  snapshot() {
    const chain = [];
    const seen = new Set();
    for (let style = this; style && !seen.has(style); style = style.#basedOn) {
      seen.add(style);
      chain.push({style, targetType: style.#targetType, basedOn: style.#basedOn, legacyMutable: style.#legacyMutable,
        setters: style.#setters.map(setter => ({setter, state: setter.snapshot()})), sealed: style.#sealed, compiled: style.#compiled});
    }
    return {version: 1, chain};
  }

  restore(snapshot) {
    if (snapshot?.version !== 1) throw new TypeError('Invalid Style snapshot.');
    for (const entry of snapshot.chain) {
      const style = entry.style;
      style.#targetType = entry.targetType;
      style.#basedOn = entry.basedOn;
      style.#legacyMutable = entry.legacyMutable ?? false;
      style.#setters = entry.setters.map(value => { value.setter.restore(value.state); return value.setter; });
      style.#sealed = entry.sealed;
      style.#compiled = entry.compiled;
      if (entry.sealed) Object.freeze(style.#setters);
    }
  }
}

export class StyleSelector {
  constructor() { this.reconstructible = true; }
  selectStyle(item, container) { return this.selectStyleCore(item, container); }
  selectStyleCore() { return null; }
}
