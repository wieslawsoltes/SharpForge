import { GitError, checkCancelled } from '../errors.js';
import { copyBytes, StoreMutex, validateStorageKey } from './store-contract.js';
import { installPack, readPack, removePack, listPacks } from './pack-store.js';

/** Byte-key store with isolated reads and serializable copy-on-write transactions. */
export class MemoryStore {
  #entries = new Map();
  #mutex = new StoreMutex();
  #closed = false;
  #byteLength = 0;

  constructor({ entries, maxBytes = Infinity } = {}) {
    this.maxBytes = maxBytes;
    this.capabilities = Object.freeze({ backend: 'memory', persistent: false, atomicTransactions: true });
    for (const [key, value] of entries ?? []) {
      validateStorageKey(key);
      this.#byteLength -= this.#entries.get(key)?.byteLength ?? 0;
      this.#entries.set(key, copyBytes(value));
      this.#byteLength += value.byteLength;
    }
  }

  #check(signal) {
    checkCancelled(signal);
    if (this.#closed) throw new GitError('Disposed', 'Repository store has been closed');
  }

  async get(key, { signal } = {}) {
    this.#check(signal);
    return this.#entries.get(validateStorageKey(key))?.slice();
  }

  async list(prefix = '', { signal } = {}) {
    this.#check(signal);
    validateStorageKey(prefix, { prefix: true });
    return [...this.#entries.keys()].filter(key => key.startsWith(prefix)).sort();
  }

  async set(key, value, options = {}) {
    return this.transaction(tx => tx.set(key, value), options);
  }

  async delete(key, options = {}) {
    return this.transaction(tx => tx.delete(key), options);
  }

  async transaction(callback, { signal } = {}) {
    return this.#mutex.run(async () => {
      this.#check(signal);
      const changes = new Map();
      let active = true;
      const check = key => {
        if (!active) throw new GitError('Disposed', 'Storage transaction has completed');
        this.#check(signal);
        return validateStorageKey(key);
      };
      const tx = {
        get: async key => {
          check(key);
          const value = changes.has(key) ? changes.get(key) : this.#entries.get(key);
          return value?.slice();
        },
        set: async (key, value) => { changes.set(check(key), copyBytes(value)); },
        delete: async key => { changes.set(check(key), undefined); },
        list: async (prefix = '') => {
          if (!active) throw new GitError('Disposed', 'Storage transaction has completed');
          validateStorageKey(prefix, { prefix: true });
          const keys = new Set(this.#entries.keys());
          for (const [key, value] of changes) value === undefined ? keys.delete(key) : keys.add(key);
          return [...keys].filter(key => key.startsWith(prefix)).sort();
        }
      };
      try {
        const result = await callback(tx);
        this.#check(signal);
        let bytes = this.#byteLength;
        for (const [key, value] of changes) bytes += (value?.byteLength ?? 0) - (this.#entries.get(key)?.byteLength ?? 0);
        if (bytes > this.maxBytes) throw new GitError('Quota', 'Repository storage quota exceeded', { bytes, maximum: this.maxBytes });
        for (const [key, value] of changes) value === undefined ? this.#entries.delete(key) : this.#entries.set(key, value);
        this.#byteLength = bytes;
        return result;
      } finally {
        active = false;
      }
    }, { signal });
  }

  installPack(value, options) { return installPack(this, value, options); }
  readPack(id, options) { return readPack(this, id, options); }
  removePack(id, options) { return removePack(this, id, options); }
  listPacks(options) { return listPacks(this, options); }
  async close() { this.#closed = true; }
}
