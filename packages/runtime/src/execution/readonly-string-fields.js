import {frameworkType} from '@sharpforge/framework';
import {ManagedFault} from '../heap.js';
import {stringPool} from './strings.js';
import {initializeString, continueStringInitialization} from './string-initialization.js';

function publishReadonlyString() {
  const reference = this.pool.find(this.text) ?? this.pool.heap.string(this.text);
  if (!continueStringInitialization(this)) return null;
  if (this.values.has(this.key)) return this.values.get(this.key);
  const canonical = this.pool.intern(reference);
  this.values.set(this.key, canonical);
  return canonical;
}

/** Source constant caches and CIL static slots already supply strong GC roots and snapshot storage. */
export function initializeReadonlyString(vm, field, values, key) {
  const pool = stringPool(vm);
  const operation = {pool, text: field.value, values, key, failure: null};
  return initializeString(pool, 'fields', JSON.stringify([field.owner, field.name]), operation, publishReadonlyString);
}

/** Executable markers have already passed bytecode verification; resolve only their registered field value. */
export function sourceReadonlyString(vm, index, marker) {
  if (vm.constantValues.has(index)) return vm.constantValues.get(index);
  if (!marker || typeof marker.owner !== 'string' || typeof marker.name !== 'string') {
    throw new ManagedFault('InvalidProgramException', 'Invalid readonly string field load');
  }
  const {owner, name} = marker;
  const entry = frameworkType(owner);
  const descriptor = entry?.name === owner && entry.fields && Object.hasOwn(entry.fields, name) ? entry.fields[name] : null;
  if (descriptor?.type !== 'string') throw new ManagedFault('InvalidProgramException', 'Unknown readonly string field');
  return initializeReadonlyString(vm, {owner, name, value: descriptor.value}, vm.constantValues, index);
}
