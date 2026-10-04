import { validateDropToken } from './drag-data.js';

const fail = message => Object.assign(new Error('SFUI1667: ' + message), { code: 'SFUI1667' });
function randomToken() {
  if (!globalThis.crypto?.getRandomValues) throw fail('A secure drop token generator is unavailable');
  const words = new Uint8Array(24);
  globalThis.crypto.getRandomValues(words);
  return Array.from(words, value => value.toString(16).padStart(2, '0')).join('');
}

export function validateStorageDescriptors(values) {
  if (!Array.isArray(values) || values.length > 256) throw fail('Invalid storage adapter response');
  return values.map(value => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || typeof value.id !== 'string'
      || !/^[a-zA-Z0-9:_-]{1,256}$/.test(value.id) || typeof value.name !== 'string' || value.name.length > 512
      || typeof value.contentType !== 'string' || value.contentType.length > 256
      || !Number.isSafeInteger(value.size) || value.size < 0 || !Number.isFinite(value.lastModified) || value.lastModified < 0) {
      throw fail('Invalid storage adapter item');
    }
    return Object.freeze({ id: value.id, name: value.name, contentType: value.contentType, size: value.size,
      lastModified: value.lastModified, isFile: true });
  });
}

/** Files remain private to one host. A drop grants no file-read permission on its own. */
export class DropFileBroker {
  constructor({ policy, readFiles, now = () => Date.now(), createToken = randomToken, lifetime = 60000,
    maximumFiles = 256, maximumBytes = 512 * 1024 * 1024, maximumPending = 16 } = {}) {
    if (![lifetime, maximumFiles, maximumBytes, maximumPending].every(Number.isSafeInteger)
      || lifetime < 1 || lifetime > 300000 || maximumFiles < 1 || maximumFiles > 256
      || maximumBytes < 0 || maximumPending < 1 || maximumPending > 64) throw fail('Invalid drop broker limits');
    Object.assign(this, { policy, readFiles, now, createToken, lifetime, maximumFiles, maximumBytes, maximumPending });
    this.entries = new Map();
    this.disposed = false;
  }
  prune() {
    for (const [token, entry] of this.entries) if (entry.expires <= this.now() && !entry.pending) this.entries.delete(token);
  }
  capture(source) {
    if (this.disposed) throw fail('Drop broker is disposed');
    const files = Array.from(source);
    if (files.length < 1 || files.length > this.maximumFiles) throw fail('Storage drop count limit exceeded');
    let bytes = 0;
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0) throw fail('Invalid dropped file');
      bytes += file.size;
      if (bytes > this.maximumBytes) throw fail('Storage drop byte limit exceeded');
    }
    this.prune();
    if (this.entries.size >= this.maximumPending) throw fail('Too many pending storage drops');
    const token = validateDropToken(this.createToken());
    if (this.entries.has(token)) throw fail('Drop token collision');
    this.entries.set(token, { files, bytes, expires: this.now() + this.lifetime, pending: null, controller: new AbortController() });
    return token;
  }
  async read(token, { signal } = {}) {
    validateDropToken(token);
    this.prune();
    const entry = this.entries.get(token);
    if (this.disposed || !entry) throw fail('Drop capability has expired or belongs to another host');
    signal?.throwIfAborted();
    if (entry.pending) return entry.pending;
    const abort = () => entry.controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    entry.pending = this.readEntry(entry).finally(() => {
      signal?.removeEventListener('abort', abort);
      entry.files.length = 0;
      this.entries.delete(token);
    });
    return entry.pending;
  }
  async readEntry(entry) {
    const signal = entry.controller.signal;
    if (!this.policy?.authorize || !this.readFiles) throw fail('Storage drops require explicit permission and a file adapter');
    if (!await this.policy.authorize('storage-items-drop', { count: entry.files.length, bytes: entry.bytes }, { signal })) {
      throw fail('Storage drop permission was denied');
    }
    signal.throwIfAborted();
    const values = await this.readFiles(Object.freeze([...entry.files]), { signal });
    signal.throwIfAborted();
    const result = validateStorageDescriptors(values);
    if (result.length !== entry.files.length) throw fail('Storage adapter returned a different item count');
    return result;
  }
  release(token) {
    const entry = this.entries.get(token);
    if (entry) entry.controller.abort(fail('Drop capability was released'));
    this.entries.delete(token);
  }
  dispose() {
    this.disposed = true;
    for (const token of this.entries.keys()) this.release(token);
  }
}
