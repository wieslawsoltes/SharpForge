import { GitError, checkCancelled, checkLimit } from './errors.js';
import { hashObject, encodeLooseObject, decodeLooseObject } from './objects.js';
import { MemoryStore } from './storage/memory-store.js';
import { getObjectFormat, validateObjectId } from './object-format.js';

export { validateObjectId } from './object-format.js';

/** Provider-free Git ODB. Loose objects are validated against their content address on read. */
export class ObjectDatabase {
  constructor({ store = new MemoryStore(), algorithm = 'sha1', alternates = [], packs = [], maxObjectBytes = 64 * 1024 * 1024 } = {}) {
    getObjectFormat(algorithm);
    checkLimit(maxObjectBytes, Number.MAX_SAFE_INTEGER, 'Object size bound');
    this.store = store;
    this.algorithm = algorithm;
    this.maxObjectBytes = maxObjectBytes;
    this.alternates = [];
    this.packs = [];
    this.replacePackReaders(packs);
    for (const alternate of alternates) this.addAlternate(alternate);
  }

  #key(oid) {
    oid = validateObjectId(oid, this.algorithm);
    return `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
  }

  addAlternate(database) {
    if (database.algorithm !== this.algorithm) throw new GitError('Conflict', 'Alternate object formats must match');
    if (!this.alternates.includes(database)) this.alternates.push(database);
    return this;
  }

  addPackReader(reader) {
    if (!reader || typeof reader.read !== 'function') throw new TypeError('Pack reader must provide read(oid)');
    if (!this.packs.includes(reader)) this.packs.push(reader);
    return this;
  }

  /** Replace the visible pack set after a caller has durably published its new pack manifest. */
  replacePackReaders(readers) {
    const next = [...readers];
    for (const reader of next) {
      if (!reader || typeof reader.read !== 'function') throw new TypeError('Pack reader must provide read(oid)');
      if (reader.algorithm && reader.algorithm !== this.algorithm) throw new GitError('Conflict', 'Pack object formats must match');
    }
    this.packs = next;
    return this;
  }

  async #encode(type, data, { signal } = {}) {
    checkCancelled(signal);
    if (!(data instanceof Uint8Array)) throw new TypeError('Git object data must be Uint8Array');
    checkLimit(data.byteLength, this.maxObjectBytes, 'Git object');
    data = data.slice();
    const options = { algorithm: this.algorithm, maxObjectBytes: this.maxObjectBytes, signal };
    const oid = await hashObject(type, data, options);
    const compressed = await encodeLooseObject(type, data, options);
    checkCancelled(signal);
    return { oid, compressed };
  }

  async write(type, data, { signal } = {}) {
    const { oid, compressed } = await this.#encode(type, data, { signal });
    await this.store.set(this.#key(oid), compressed, { signal });
    return oid;
  }

  /** Atomically ingest a bounded object batch without one durable transaction per object. */
  async writeMany(objects, { signal, maxObjects = 100000, maxBatchBytes = 256 * 1024 * 1024 } = {}) {
    return this.store.transaction(async tx => {
      const ids = [];
      let bytes = 0;
      for await (const { type, data } of objects) {
        checkLimit(ids.length + 1, maxObjects, 'Object batch count');
        const { oid, compressed } = await this.#encode(type, data, { signal });
        bytes += compressed.length;
        checkLimit(bytes, maxBatchBytes, 'Object batch size');
        await tx.set(this.#key(oid), compressed);
        ids.push(oid);
      }
      return ids;
    }, { signal });
  }

  async read(oid, { signal, visited = new Set() } = {}) {
    checkCancelled(signal);
    oid = validateObjectId(oid, this.algorithm);
    const key = this.#key(oid);
    if (visited.has(this)) throw new GitError('NotFound', 'Object is absent from alternate cycle', { oid });
    if (visited.size >= 64) throw new GitError('Limit', 'Too many alternate object databases');
    visited.add(this);
    const compressed = await this.store.get(key, { signal });
    if (compressed !== undefined) {
      return decodeLooseObject(compressed, { oid, algorithm: this.algorithm, maxObjectBytes: this.maxObjectBytes, signal });
    }
    for (const database of [...this.packs, ...this.alternates]) {
      checkCancelled(signal);
      try {
        const object = await database.read(oid, { signal, visited });
        if (object) return object;
      } catch (error) {
        if (!(error instanceof GitError) || error.code !== 'NotFound') throw error;
      }
    }
    throw new GitError('NotFound', 'Git object not found', { oid });
  }

  async has(oid, options = {}) {
    try {
      await this.read(oid, options);
      return true;
    } catch (error) {
      if (error instanceof GitError && error.code === 'NotFound') return false;
      throw error;
    }
  }

  async readHeader(oid, options = {}) {
    const object = await this.read(oid, options);
    return { oid: object.oid, type: object.type, size: object.size };
  }

  async list({ signal, includeAlternates = false, visited = new Set() } = {}) {
    checkCancelled(signal);
    if (visited.has(this)) return [];
    visited.add(this);
    const length = this.algorithm === 'sha256' ? 64 : 40;
    const keys = await this.store.list('objects/', { signal });
    const result = new Set();
    for (const key of keys) {
      const match = /^objects\/([0-9a-f]{2})\/([0-9a-f]+)$/u.exec(key);
      if (match && match[1].length + match[2].length === length) result.add(match[1] + match[2]);
    }
    for (const reader of [...this.packs, ...(includeAlternates ? this.alternates : [])]) {
      if (reader.list) for (const oid of await reader.list({ signal, includeAlternates, visited })) result.add(oid);
    }
    return [...result].sort();
  }

  async remove(oid, options = {}) { return this.store.delete(this.#key(oid), options); }
  async delete(oid, options = {}) { return this.remove(oid, options); }
  async close() { return this.store.close?.(); }
}
