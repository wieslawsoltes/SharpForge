import {CompositionObject} from './composition-object.js';
import {validateAnimationValue} from '../animation/value-sampler.js';
import {copyCompositionData} from './snapshot.js';

/** Reusable composition animation definitions share bounded, typed parameter storage. */
export class CompositionAnimation extends CompositionObject {
  constructor(compositor, kind) {
    super(compositor, kind, {Target: {default: '', validate: value => {
      if (typeof value !== 'string' || value.length > 128) throw new TypeError('Invalid animation target property');
      return value;
    }}});
    this.parameters = Object.create(null);
  }
  setParameter(name, value, kind) {
    if (this.closed || typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
      || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new TypeError('Invalid animation parameter');
    if (Object.keys(this.parameters).length >= 256 && !Object.hasOwn(this.parameters, name)) {
      throw new RangeError('Composition animation parameter limit exceeded');
    }
    this.parameters[name] = kind ? validateAnimationValue(kind, value) : value;
  }
  SetScalarParameter(name, value) { this.setParameter(name, value, 'Scalar'); }
  SetVector2Parameter(name, value) { this.setParameter(name, value, 'Vector2'); }
  SetVector3Parameter(name, value) { this.setParameter(name, value, 'Vector3'); }
  SetVector4Parameter(name, value) { this.setParameter(name, value, 'Vector4'); }
  SetColorParameter(name, value) { this.setParameter(name, value, 'Color'); }
  SetReferenceParameter(name, value) {
    if (value?.Compositor !== this.Compositor || value.closed) throw new TypeError('Foreign expression reference');
    this.setParameter(name, value);
  }
  ClearParameter(name) { delete this.parameters[name]; }
  *retainedValues() { yield* super.retainedValues(); yield* Object.values(this.parameters); }
  snapshot() { return {object: super.snapshot(), parameters: copyCompositionData(this.parameters)}; }
  restore(snapshot) { super.restore(snapshot.object); this.parameters = copyCompositionData(snapshot.parameters); }
  dispose() {
    if (this.closed) return;
    super.dispose();
    this.parameters = Object.create(null);
  }
}
