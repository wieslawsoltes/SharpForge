import {ManagedFault} from './fault.js';
import {isReference} from './reference.js';
import {noteLifetimeMutation} from './lifetime-state.js';

function normalizePath(path) {
  const normalized = Number.isInteger(path) ? [path] : path;
  if (!Array.isArray(normalized) || normalized.length === 0 || normalized.length > 128 ||
      normalized.some(slot => !Number.isSafeInteger(slot) || slot < 0)) {
    throw new RangeError('An interior reference needs between 1 and 128 nonnegative slot indexes');
  }
  return Object.freeze([...normalized]);
}

/** Logical owner plus slot path: rooting the byref roots its owner without pinning storage. */
export class ManagedInteriorReference {
  constructor(heap, owner, path, {readOnly = false} = {}) {
    heap.get(owner);
    this.byref = true;
    this.kind = 'managed-interior';
    this.heapOwner = heap.handleOwner;
    this.owner = owner;
    this.path = normalizePath(path);
    this.readOnly = !!readOnly;
    Object.freeze(this);
    resolveInteriorReference(heap, this);
  }
}

export function createInteriorReference(heap, owner, path, options) {
  return new ManagedInteriorReference(heap, owner, path, options);
}

function storageOf(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return value;
  if (value?.struct && Array.isArray(value.fields)) return value.fields;
  if (value?.struct && Array.isArray(value.data)) return value.data;
  throw new ManagedFault('InvalidProgramException', 'The interior path does not name inline managed storage');
}

/** Resolve against current storage; stale owner generations never bind to recycled objects. */
export function resolveInteriorReference(heap, address, {write = false, value = undefined} = {}) {
  if (!address?.byref || address.kind !== 'managed-interior' || address.heapOwner !== heap.handleOwner) {
    throw new ManagedFault('InvalidProgramException', 'An interior reference from this heap is required');
  }
  if (write && address.readOnly) throw new ManagedFault('InvalidOperationException', 'The interior reference is readonly');
  const record = heap.get(address.owner);
  if (write && record.space === 'frozen') throw new ManagedFault('InvalidOperationException', 'Frozen objects cannot be mutated');
  if (record.kind === 'string') throw new ManagedFault('InvalidProgramException', 'Strings expose no writable managed slots');
  let storage = storageOf(record.data);
  const path = address.path;
  for (let depth = 0; depth < path.length - 1; depth++) {
    const slot = path[depth];
    if (slot >= storage.length) throw new ManagedFault('IndexOutOfRangeException', 'Interior slot is outside its owner');
    const next = storage[slot];
    if (isReference(next)) {
      throw new ManagedFault('InvalidProgramException', 'Interior paths cannot cross an object reference boundary');
    }
    storage = storageOf(next);
  }
  const index = path[path.length - 1];
  if (index >= storage.length) throw new ManagedFault('IndexOutOfRangeException', 'Interior slot is outside its owner');
  if (!write) return storage[index];
  if (path.length === 1 && heap.writeField) {
    if (record.kind === 'array' && heap.writeElement) heap.writeElement(address.owner, index, value);
    else heap.writeField(address.owner, index, value);
  } else {
    if (isReference(value)) heap.get(value);
    storage[index] = value;
    heap.collector?.writeBarrier(address.owner, value);
    noteLifetimeMutation(heap);
  }
  return value;
}
