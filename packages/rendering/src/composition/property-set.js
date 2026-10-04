import {finite, vector, color, matrix} from './values.js';
import {copyCompositionData} from './snapshot.js';
import {CompositionTarget} from './composition-target.js';

const validators = Object.freeze({Scalar: finite, Boolean: value => {
  if (typeof value !== 'boolean') throw new TypeError('Boolean value required');
  return value;
}, Vector2: value => vector(value, 2), Vector3: value => vector(value, 3), Vector4: value => vector(value, 4),
Color: color, Quaternion: value => vector(value, 4), Matrix4x4: matrix});

export function validatePropertyValue(name, kind, value) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new TypeError('Invalid property name');
  if (!validators[kind]) throw new TypeError('Unsupported composition property kind');
  return validators[kind](value);
}

/** Typed property storage used by expression parameters and per-visual Properties. */
export class CompositionPropertySet extends CompositionTarget {
  constructor(compositor, {maxProperties = 256} = {}) {
    super(compositor, 'CompositionPropertySet', Object.create(null));
    this.Properties = this;
    this.maxProperties = maxProperties;
    this.values = new Map();
    this.version = 0;
    this.closed = false;
  }

  insert(name, kind, value) {
    if (this.closed) throw new Error('CompositionPropertySet is disposed');
    if (!this.values.has(name) && this.values.size >= this.maxProperties) throw new RangeError('Composition property limit exceeded');
    const prior = this.values.get(name);
    if (prior && prior.kind !== kind) throw new TypeError('A composition property cannot change its type');
    const validated = validatePropertyValue(name, kind, value);
    this.schema[name] = {validate: validators[kind]};
    if (!prior) this.baseValues[name] = validated;
    this.values.set(name, {kind, value: validated});
    this.set(name, validated);
  }

  remove(name) {
    if (!this.values.has(name)) return;
    this.StopAnimation(name);
    this.values.delete(name);
    delete this.schema[name];
    delete this.baseValues[name];
    delete this.animatedValues[name];
    this.changed(name);
  }

  tryGet(name, kind) {
    const entry = this.values.get(name);
    if (!entry) return {status: 'NotFound', value: null};
    return entry.kind === kind ? {status: 'Succeeded', value: this.get(name)} : {status: 'TypeMismatch', value: null};
  }

  InsertScalar(name, value) { this.insert(name, 'Scalar', value); }
  InsertBoolean(name, value) { this.insert(name, 'Boolean', value); }
  InsertVector2(name, value) { this.insert(name, 'Vector2', value); }
  InsertVector3(name, value) { this.insert(name, 'Vector3', value); }
  InsertVector4(name, value) { this.insert(name, 'Vector4', value); }
  InsertColor(name, value) { this.insert(name, 'Color', value); }
  InsertQuaternion(name, value) { this.insert(name, 'Quaternion', value); }
  InsertMatrix4x4(name, value) { this.insert(name, 'Matrix4x4', value); }
  TryGetBoolean(name) { return this.tryGet(name, 'Boolean'); }
  TryGetQuaternion(name) { return this.tryGet(name, 'Quaternion'); }
  TryGetMatrix4x4(name) { return this.tryGet(name, 'Matrix4x4'); }
  TryGetScalar(name) { return this.tryGet(name, 'Scalar'); }
  TryGetVector2(name) { return this.tryGet(name, 'Vector2'); }
  TryGetVector3(name) { return this.tryGet(name, 'Vector3'); }
  TryGetVector4(name) { return this.tryGet(name, 'Vector4'); }
  TryGetColor(name) { return this.tryGet(name, 'Color'); }
  retainedValues() { return [this.Compositor, this.ImplicitAnimations]; }
  snapshot() {
    return {values: copyCompositionData(this.values), baseValues: copyCompositionData(this.baseValues),
      animatedValues: copyCompositionData(this.animatedValues), implicit: this.ImplicitAnimations, version: this.version};
  }
  restore(snapshot) {
    this.closed = false;
    this.values = copyCompositionData(snapshot.values);
    this.baseValues = copyCompositionData(snapshot.baseValues);
    this.animatedValues = copyCompositionData(snapshot.animatedValues);
    this.ImplicitAnimations = snapshot.implicit;
    this.schema = Object.create(null);
    for (const [name, entry] of this.values) this.schema[name] = {validate: validators[entry.kind]};
    this.version = snapshot.version;
  }
  dispose() {
    if (this.closed) return;
    super.dispose();
    this.values.clear();
  }
}
