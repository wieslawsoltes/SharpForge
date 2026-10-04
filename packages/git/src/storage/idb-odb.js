import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { ObjectDatabase } from '../odb.js';
import { storageFailure } from './store-contract.js';
import { installPack, readPack, removePack, listPacks } from './pack-store.js';
import { createIdbTransaction, idbCompletion } from './idb-transaction.js';

/** IndexedDB byte store partitioned by repository; large values use atomic chunk records. */
export class IndexedDBStore {
  #database;
  #closed = false;

  constructor({ repositoryId, databaseName = 'sharpforge-git', indexedDB = globalThis.indexedDB,
    keyRange = globalThis.IDBKeyRange, chunkBytes = 1024 * 1024, maxValueBytes = 512 * 1024 * 1024 } = {}) {
    if (!indexedDB || !keyRange) throw new GitError('Unsupported', 'IndexedDB is unavailable');
    if (typeof repositoryId !== 'string' || !repositoryId || repositoryId.length > 1024) {
      throw new TypeError('A nonempty repositoryId of at most 1024 characters is required');
    }
    checkLimit(chunkBytes, 16 * 1024 * 1024, 'IndexedDB chunk size');
    if (!chunkBytes) throw new TypeError('IndexedDB chunk size must be positive');
    this.repositoryId = repositoryId;
    this.databaseName = databaseName;
    this.indexedDB = indexedDB;
    this.keyRange = keyRange;
    this.chunkBytes = chunkBytes;
    this.maxValueBytes = maxValueBytes;
    this.capabilities = Object.freeze({ backend: 'indexeddb', persistent: true, atomicTransactions: true, chunkBytes });
  }

  async #open() {
    if (this.#closed) throw new GitError('Disposed', 'Repository store has been closed');
    this.#database ??= new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries');
      request.onerror = () => reject(storageFailure(request.error, 'open'));
      request.onblocked = () => reject(new GitError('Conflict', 'Repository database upgrade is blocked by another tab'));
      request.onsuccess = () => {
        const database = request.result;
        if (this.#closed) {
          database.close();
          reject(new GitError('Disposed', 'Repository store has been closed'));
          return;
        }
        database.onversionchange = () => { database.close(); this.#closed = true; };
        resolve(database);
      };
    });
    return this.#database;
  }

  async #run(mode, callback, { signal } = {}) {
    checkCancelled(signal);
    const database = await this.#open();
    checkCancelled(signal);
    const transaction = database.transaction('entries', mode);
    const completion = idbCompletion(transaction);
    completion.catch(() => {});
    const objectStore = transaction.objectStore('entries');
    let active = true;
    const cancel = () => {
      try { transaction.abort(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    // IDB otherwise autocommits while an async callback is between awaited operations.
    const keepAlive = () => {
      if (!active) return;
      const request = objectStore.get([this.repositoryId, '', -1]);
      request.onsuccess = keepAlive;
      request.onerror = () => {};
    };
    keepAlive();
    try {
      const tx = createIdbTransaction({ objectStore, keyRange: this.keyRange, repositoryId: this.repositoryId,
        chunkBytes: this.chunkBytes, maxValueBytes: this.maxValueBytes, signal });
      const result = await callback(tx);
      checkCancelled(signal);
      active = false;
      await completion;
      return result;
    } catch (error) {
      active = false;
      cancel();
      await completion.catch(() => {});
      checkCancelled(signal);
      throw storageFailure(error, mode);
    } finally {
      active = false;
      signal?.removeEventListener('abort', cancel);
    }
  }

  get(key, options) { return this.#run('readonly', tx => tx.get(key), options); }
  list(prefix = '', options) { return this.#run('readonly', tx => tx.list(prefix), options); }
  set(key, value, options) { return this.transaction(tx => tx.set(key, value), options); }
  delete(key, options) { return this.transaction(tx => tx.delete(key), options); }
  transaction(callback, options) { return this.#run('readwrite', callback, options); }
  installPack(value, options) { return installPack(this, value, options); }
  readPack(id, options) { return readPack(this, id, options); }
  removePack(id, options) { return removePack(this, id, options); }
  listPacks(options) { return listPacks(this, options); }

  async close() {
    this.#closed = true;
    if (this.#database) {
      const database = await this.#database.catch(() => undefined);
      database?.close();
    }
  }
}

export class IndexedDBObjectDatabase extends ObjectDatabase {
  constructor(options = {}) { super({ ...options, store: options.store ?? new IndexedDBStore(options) }); }
}
