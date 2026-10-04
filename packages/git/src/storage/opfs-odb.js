import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { ObjectDatabase } from '../odb.js';
import { StoreMutex } from './store-contract.js';
import { createStoreOverlay } from './overlay.js';
import { IndexedDBStore } from './idb-odb.js';
import { installPack, readPack, removePack, listPacks } from './pack-store.js';

/** Worker-backed OPFS store. Main-thread code never opens a synchronous access handle. */
export class OPFSStore {
  #worker;
  #pending = new Map();
  #sequence = 0;
  #closed = false;
  #failure;
  #mutex = new StoreMutex();

  constructor({ repositoryId, workerFactory = url => new Worker(url, { type: 'module' }), signal,
    workerUrl = new URL('./opfs-worker.js', import.meta.url), requestTimeoutMs = 120000 } = {}) {
    checkCancelled(signal);
    if (typeof repositoryId !== 'string' || !repositoryId || repositoryId.length > 1024) throw new GitError('Unsafe', 'Invalid repository id');
    checkLimit(requestTimeoutMs, 2147483647, 'OPFS request deadline');
    if (!requestTimeoutMs) throw new TypeError('OPFS request deadline must be positive');
    this.requestTimeoutMs = requestTimeoutMs;
    this.repositoryId = repositoryId;
    this.capabilities = Object.freeze({ backend: 'opfs-sync-worker', persistent: true, worker: true, atomicTransactions: true });
    try { this.#worker = workerFactory(workerUrl); } catch {
      throw new GitError('Unsupported', 'Module workers required for OPFS are unavailable');
    }
    this.#worker.addEventListener('message', event => {
      const pending = this.#pending.get(event.data?.id);
      if (!pending) return;
      this.#pending.delete(event.data.id);
      pending.cleanup();
      try {
        if (event.data.error) {
          const { code, message, details } = event.data.error;
          pending.reject(new GitError(code, message, details));
        } else pending.resolve(event.data.result);
      } catch { pending.reject(new GitError('Corrupt', 'Malformed OPFS worker response')); }
    });
    const failed = () => this.#fail(new GitError('Unsupported', 'OPFS worker could not be loaded or terminated unexpectedly'));
    this.#worker.addEventListener('error', failed);
    this.#worker.addEventListener('messageerror', failed);
    this.ready = this.#request('initialize', { repositoryId }, { signal }).then(capabilities => {
      this.capabilities = Object.freeze({ ...capabilities, worker: true });
      return this;
    });
    this.ready.catch(() => {});
  }

  #fail(error) {
    this.#failure ??= error;
    this.#worker.terminate();
    for (const pending of this.#pending.values()) { pending.cleanup(); pending.reject(this.#failure); }
    this.#pending.clear();
  }

  #request(operation, args, { signal } = {}) {
    checkCancelled(signal);
    if (this.#closed) return Promise.reject(new GitError('Disposed', 'Repository store has been closed'));
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#sequence;
    return new Promise((resolve, reject) => {
      const abort = () => {
        if (operation === 'initialize') return this.#fail(new GitError('Cancelled', 'OPFS initialization cancelled'));
        try { this.#worker.postMessage({ id, operation: 'cancel' }); }
        catch (error) { this.#fail(GitError.from(error)); }
      };
      const timer = setTimeout(() => this.#fail(new GitError('Network', 'OPFS worker request deadline exceeded')), this.requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      } });
      signal?.addEventListener('abort', abort, { once: true });
      try { this.#worker.postMessage({ id, operation, args }); }
      catch (error) { this.#fail(GitError.from(error)); }
    });
  }

  async get(key, options) { await this.ready; return this.#request('get', { key }, options); }
  async list(prefix = '', options) { await this.ready; return this.#request('list', { prefix }, options); }
  set(key, value, options) { return this.transaction(tx => tx.set(key, value), options); }
  delete(key, options) { return this.transaction(tx => tx.delete(key), options); }

  async transaction(callback, options = {}) {
    await this.ready;
    return this.#mutex.run(async () => {
      const overlay = createStoreOverlay(this, options);
      try {
        const result = await callback(overlay.tx);
        await this.#request('commit', { changes: [...overlay.changes], reads: [...overlay.reads], lists: [...overlay.lists] }, options);
        return result;
      } finally { overlay.finish(); }
    }, options);
  }

  installPack(value, options) { return installPack(this, value, options); }
  readPack(id, options) { return readPack(this, id, options); }
  removePack(id, options) { return removePack(this, id, options); }
  listPacks(options) { return listPacks(this, options); }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#worker.terminate();
    for (const pending of this.#pending.values()) {
      pending.cleanup();
      pending.reject(new GitError('Disposed', 'Repository store has been closed'));
    }
    this.#pending.clear();
  }
}

export class OPFSObjectDatabase extends ObjectDatabase {
  constructor(options = {}) { super({ ...options, store: options.store ?? new OPFSStore(options) }); }
  async ready() { await this.store.ready; return this; }
}

/** Select OPFS when its worker capability succeeds, otherwise report an IndexedDB fallback. */
export async function createBrowserObjectDatabase({ backend = 'opfs', onCapability, signal, ...options } = {}) {
  checkCancelled(signal);
  let store;
  let fallbackReason;
  if (backend === 'opfs') {
    try {
      store = new OPFSStore({ ...options, signal });
      await store.ready;
    } catch (error) {
      await store?.close();
      if (!(error instanceof GitError) || !['Unsupported', 'Unsafe'].includes(error.code)) throw error;
      fallbackReason = error.message;
      store = undefined;
    }
  } else if (backend !== 'indexeddb') throw new GitError('Unsupported', 'Unknown browser repository backend', { backend });
  store ??= new IndexedDBStore(options);
  if (signal?.aborted) { await store.close(); checkCancelled(signal); }
  const odb = new ObjectDatabase({ ...options, store });
  odb.capabilities = Object.freeze({ ...store.capabilities, ...(fallbackReason ? { fallbackFrom: 'opfs', fallbackReason } : {}) });
  onCapability?.(odb.capabilities);
  return { odb, store, backend: store.capabilities.backend, capabilities: odb.capabilities };
}
