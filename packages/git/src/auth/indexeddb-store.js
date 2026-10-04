import { GitError } from '../errors.js';

/** IndexedDB ciphertext and non-extractable CryptoKey storage; never uses Web Storage. */
export class IndexedDbCredentialStore {
  #database;
  constructor({ indexedDB = globalThis.indexedDB, name = 'sharpforge-git-credentials-v1' } = {}) {
    if (!indexedDB) throw new GitError('Unsupported', 'IndexedDB is unavailable for credential persistence');
    this.#database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new GitError('Quota', 'Credential database could not be opened'));
      request.onblocked = () => reject(new GitError('Conflict', 'Credential database upgrade is blocked'));
    });
  }

  async #transaction(mode, action) {
    const database = await this.#database;
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('vault', mode);
      const store = transaction.objectStore('vault');
      let value;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = transaction.onerror = () => reject(new GitError('Quota', 'Credential storage transaction failed'));
      action(store, result => { value = result; });
    });
  }

  get(id) {
    return this.#transaction('readonly', (store, done) => {
      const request = store.get(`credential:${id}`);
      request.onsuccess = () => done(request.result ?? null);
    });
  }

  set(id, value) { return this.#transaction('readwrite', store => store.put(value, `credential:${id}`)); }
  delete(id) { return this.#transaction('readwrite', store => store.delete(`credential:${id}`)); }

  list() {
    return this.#transaction('readonly', (store, done) => {
      const request = store.getAllKeys();
      request.onsuccess = () => done(request.result.filter(key => String(key).startsWith('credential:'))
        .map(key => key.slice('credential:'.length)));
    });
  }

  clear() { return this.#transaction('readwrite', store => store.clear()); }

  getOrCreateKey(candidate) {
    return this.#transaction('readwrite', (store, done) => {
      const request = store.get('encryption-key');
      request.onsuccess = () => {
        if (!request.result) store.put(candidate, 'encryption-key');
        done(request.result ?? candidate);
      };
    });
  }

  async close() { (await this.#database).close(); }
}
