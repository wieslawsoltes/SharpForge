import { GitError, checkCancelled, checkLimit } from './errors.js';
import { validateWireOid } from './protocol/advertisement.js';

/** Only the filters whose missing-object semantics the local repository understands are accepted. */
export function validateFilter(filter) {
  if (filter === 'blob:none' || filter === 'tree:0') return filter;
  const match = /^blob:limit=(\d+)([kmg]?)$/i.exec(filter);
  if (!match) throw new GitError('Unsupported', 'Unsupported partial clone filter', { filter });
  const multiplier = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase()];
  return `blob:limit=${checkLimit(Number(match[1]) * multiplier, Number.MAX_SAFE_INTEGER, 'Blob filter limit')}`;
}

function waitFor(promise, signal) {
  checkCancelled(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new GitError('Cancelled', 'Promisor read cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Missing reads in the same microtask share one fetch; concurrent reads for an OID share its promise. */
export class PromisorDatabase {
  constructor({ odb, fetchObjects, algorithm = 'sha1', maxBatch = 512, filter = 'blob:none' }) {
    if (typeof fetchObjects !== 'function') throw new TypeError('PromisorDatabase requires fetchObjects');
    this.odb = odb;
    this.store = odb.store;
    this.fetchObjects = fetchObjects;
    this.algorithm = algorithm;
    this.maxBatch = checkLimit(maxBatch, 100_000, 'Promisor batch');
    if (!this.maxBatch) throw new GitError('Limit', 'Promisor batch must be positive');
    this.filter = validateFilter(filter);
    this.pending = new Map();
    this.scheduled = false;
    this.controller = new AbortController();
  }

  async read(oid, options = {}) {
    checkCancelled(options.signal);
    validateWireOid(oid, this.algorithm);
    if (await this.odb.has(oid, options)) return this.odb.read(oid, options);
    await this.prefetch([oid], options);
    return this.odb.read(oid, options);
  }

  async prefetch(oids, { signal } = {}) {
    checkCancelled(signal);
    checkCancelled(this.controller.signal);
    const promises = [];
    for (const oid of new Set(oids)) {
      validateWireOid(oid, this.algorithm);
      if (await this.odb.has(oid, { signal })) continue;
      if (!this.pending.has(oid)) {
        let resolve;
        let reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        this.pending.set(oid, { promise, resolve, reject, active: false });
      }
      promises.push(this.pending.get(oid).promise);
    }
    if (!this.scheduled && promises.length) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
    return waitFor(Promise.all(promises), signal);
  }

  async flush() {
    try {
      while (true) {
        const batch = [...this.pending].filter(([, value]) => !value.active).slice(0, this.maxBatch);
        if (!batch.length) break;
        for (const [, value] of batch) value.active = true;
        try {
          await this.fetchObjects(batch.map(([oid]) => oid), { signal: this.controller.signal });
          for (const [oid, value] of batch) {
            if (!await this.odb.has(oid)) throw new GitError('NotFound', 'Promisor remote did not return a requested object', { oid });
            value.resolve();
          }
        } catch (error) {
          for (const [, value] of batch) value.reject(GitError.from(error));
        } finally {
          for (const [oid] of batch) this.pending.delete(oid);
        }
      }
    } finally { this.scheduled = false; }
  }

  has(oid, options) { return this.odb.has(oid, options); }
  get localDatabase() { return this.odb; }
  readLocal(oid, options) { return this.odb.read(oid, options); }
  readLocalHeader(oid, options) { return this.odb.readHeader(oid, options); }
  async readHeader(oid, options) {
    const { type, data, size } = await this.read(oid, options);
    return { oid, type, size: size ?? data.byteLength };
  }
  write(type, data, options) { return this.odb.write(type, data, options); }
  writeMany(objects, options) { return this.odb.writeMany(objects, options); }
  addPackReader(reader) { return this.odb.addPackReader(reader); }
  replacePackReaders(readers) { return this.odb.replacePackReaders(readers); }
  list(options) { return this.odb.list(options); }
  remove(oid, options) { return this.odb.remove(oid, options); }
  dispose() { this.controller.abort(); }
  async close() { this.dispose(); return this.odb.close(); }
}
