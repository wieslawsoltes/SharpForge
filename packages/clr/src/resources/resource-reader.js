import { Reader } from '@sharpforge/cil';
import { checkCancellation, loadError, LoadErrorCode } from '../load-errors.js';
import { ResourceStringCodec, resourceLimits, resourceLimit, resourceOperation, ownedResourceBytes } from './resource-codec.js';
import { readResourceIndex } from './resource-index.js';
import { readResourceValue } from './resource-values.js';

export { ResourceTypeCode } from './resource-values.js';

/** Owned, bounded .resources v2 inspection with lazy values, explicit lifetimes and no serialized-object execution. */
export class ManagedResourceReader {
  #bytes;
  #index;
  #codec;
  #limits;
  #values = new Map();
  #descriptors = new Map();
  constructor(input, options = {}) {
    checkCancellation(options.signal);
    this.#limits = resourceLimits(options);
    this.#bytes = resourceOperation(() => ownedResourceBytes(input, this.#limits.maxBytes));
    this.#codec = new ResourceStringCodec();
    this.#index = resourceOperation(() => readResourceIndex(this.#bytes, this.#codec, this.#limits, options.signal));
    Object.freeze(this);
  }

  get isDisposed() { return this.#bytes === null; }
  get header() { this.#ensureUsable(); return this.#index.header; }
  get count() { this.#ensureUsable(); return this.#index.names.length; }
  /** Frozen file hash-table order, matching ResourceReader enumeration; keys use ordinal case-sensitive equality. */
  get names() { this.#ensureUsable(); return this.#index.names; }

  #ensureUsable(signal) {
    if (this.isDisposed) throw loadError(LoadErrorCode.Disposed, 'Resource reader is disposed');
    checkCancellation(signal);
  }

  #value(name, signal) {
    this.#ensureUsable(signal);
    if (typeof name !== 'string') throw loadError(LoadErrorCode.InvalidConfiguration, 'Resource name must be a string');
    if (name.length > this.#limits.maxNameBytes / 2) throw resourceLimit('Resource lookup name length exceeded');
    const offset = this.#index.records.get(name);
    if (offset === undefined) return null;
    if (!this.#values.has(offset)) {
      const end = this.#index.ends.get(offset);
      const value = resourceOperation(() => readResourceValue(new Reader(this.#bytes, offset, end - offset),
        this.#index.types, this.#codec, this.#limits));
      checkCancellation(signal);
      this.#values.set(offset, value);
    }
    return this.#values.get(offset);
  }

  /** Return null when absent. Scalars are canonical frozen records; byte/stream/serialized values are fresh owned copies. */
  get(name, { signal } = {}) {
    const value = this.#value(name, signal);
    if (value === null) return null;
    if (!(value.value instanceof Uint8Array) && this.#descriptors.has(value)) return this.#descriptors.get(value);
    const descriptor = Object.freeze({ typeCode: value.typeCode, typeName: value.typeName,
      value: value.value instanceof Uint8Array ? new Uint8Array(value.value) : value.value, diagnostic: value.diagnostic });
    if (!(value.value instanceof Uint8Array)) this.#descriptors.set(value, descriptor);
    return descriptor;
  }

  /** Native GetResourceData-style bytes exclude the type code and retain any trailing record data; returned buffers are owned copies. */
  getRawData(name, { signal } = {}) {
    const value = this.#value(name, signal);
    if (value === null) return null;
    return Object.freeze({ typeName: value.typeName,
      data: this.#bytes.slice(value.rawStart, value.rawStart + value.rawLength) });
  }

  /** Lazy [name, descriptor] pairs; cancellation and disposal are checked on every step. */
  *entries({ signal } = {}) {
    this.#ensureUsable(signal);
    const names = this.#index.names;
    for (const name of names) yield Object.freeze([name, this.get(name, { signal })]);
  }

  /** Idempotently releases input bytes, indices and caches; previously returned values retain their independent ownership. */
  dispose() {
    this.#bytes = null;
    this.#index = null;
    this.#codec = null;
    this.#values.clear();
    this.#descriptors.clear();
  }
}
