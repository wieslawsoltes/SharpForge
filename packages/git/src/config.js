import { GitError } from './errors.js';
import { MemoryStore } from './storage/memory-store.js';
import { encodeStorageText, decodeStorageText, sameBytes } from './storage/store-contract.js';
import { ConfigDocument } from './config/document.js';

/** Explicit load/edit/save config persistence with compare-and-swap conflict protection. */
export class GitConfig {
  constructor({ store = new MemoryStore(), path = 'config', ...options } = {}) {
    this.store = store;
    this.path = path;
    this.options = options;
    this.document = new ConfigDocument('', options);
    this.loaded = false;
    this.original = undefined;
  }

  async load(options = {}) {
    const bytes = await this.store.get(this.path, options);
    this.document = new ConfigDocument(decodeStorageText(bytes) ?? '', this.options);
    this.original = bytes;
    this.loaded = true;
    return this;
  }

  get warnings() { return this.document.warnings; }
  get(key, fallback) { return this.document.get(key, fallback); }
  getAll(key) { return this.document.getAll(key); }
  getBoolean(key, fallback) { return this.document.getBoolean(key, fallback); }
  getInteger(key, fallback) { return this.document.getInteger(key, fallback); }
  has(key) { return this.document.has(key); }
  entries() { return this.document.entries(); }
  set(key, value, options) { this.document.set(key, value, options); return this; }
  unset(key, options) { this.document.unset(key, options); return this; }
  toString() { return this.document.toString(); }

  async save({ signal, force = false } = {}) {
    const bytes = encodeStorageText(this.toString());
    await this.store.transaction(async tx => {
      const current = await tx.get(this.path);
      if (!force && !sameBytes(current, this.original)) throw new GitError('Conflict', 'Repository config changed since it was loaded');
      await tx.set(this.path, bytes);
    }, { signal });
    this.original = bytes;
    this.loaded = true;
    return this;
  }
}

export { ConfigDocument, parseGitConfig, serializeGitConfig, encodeConfigValue } from './config/document.js';
export { splitConfigKey } from './config/parse.js';
