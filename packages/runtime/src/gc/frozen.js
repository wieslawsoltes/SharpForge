import {isReference} from './reference.js';
import {ManagedFault} from './fault.js';

/** Reject outgoing collectible identities before a record becomes unconditionally live. */
export function validateFrozenRecord(heap, record) {
  if (record.kind === 'string') return;
  for (const value of record.data) {
    if (value !== null && !['undefined', 'number', 'bigint', 'boolean', 'string'].includes(typeof value)) {
      throw new ManagedFault('ArgumentException', 'Frozen data supports immutable scalar values only');
    }
  }
  heap.visitEdges(record, value => {
    if (isReference(value)) {
      throw new ManagedFault('ArgumentException', 'Frozen data cannot contain managed references');
    }
  });
}

/** Literal identity index lives outside collected roots and has no per-collection scan. */
export class FrozenHeap {
  constructor(heap) {
    this.heap = heap;
    this.literals = new Map();
    this.dataSources = new Map();
    this.sourceMetadata = new WeakMap();
  }

  find(value) {
    const reference = this.literals.get(String(value));
    return reference && this.heap.tryGet(reference)?.space === 'frozen' ? reference : null;
  }

  string(value) {
    const text = String(value);
    const previous = this.find(text);
    if (previous) return previous;
    const reference = this.heap.allocate('string', 'string', text, [], {frozen: true});
    this.literals.set(text, reference);
    return reference;
  }

  array(type, values) {
    if (!Array.isArray(values)) throw new TypeError('Frozen array requires an Array of values');
    const element = this.heap.methodTables.get(type);
    return this.heap.allocate('array', element.name + '[]', [...values], [], {frozen: true});
  }

  findSource(owner, key) {
    const reference = this.dataSources.get(owner)?.get(key);
    return reference && this.heap.tryGet(reference)?.space === 'frozen' ? reference : null;
  }

  /** Copy immutable PE initializer bytes into this heap's non-GC storage once. */
  source(owner, key, bytes) {
    const previous = this.findSource(owner, key);
    if (previous) return previous;
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Static data requires a byte view');
    const reference = this.heap.allocate('array', 'byte[]', bytes, [], {frozen: true});
    let entries = this.dataSources.get(owner);
    if (!entries) this.dataSources.set(owner, entries = new Map());
    entries.set(key, reference);
    return reference;
  }

  snapshot() {
    return {literals: [...this.literals], dataSources: [...this.dataSources].map(([owner, entries]) => [owner, [...entries]])};
  }

  restore(state) {
    this.literals = new Map((state?.literals ?? []).filter(([, reference]) => this.heap.tryGet(reference)?.space === 'frozen'));
    this.dataSources = new Map((state?.dataSources ?? []).map(([owner, entries]) => [owner,
      new Map(entries.filter(([, reference]) => this.heap.tryGet(reference)?.space === 'frozen'))]));
    this.sourceMetadata = new WeakMap();
  }
}
