import { GitError, checkCancelled } from '../errors.js';
import { DirectoryIO } from './directory-io.js';
import { commitDirectoryJournal, recoverDirectoryJournal, JOURNAL_DIRECTORY } from './journal.js';
import { StoreMutex, storageFailure } from '../storage/store-contract.js';
import { createStoreOverlay } from '../storage/overlay.js';
import { installPack, readPack, removePack, listPacks } from '../storage/pack-store.js';

/** Real .git file storage with recovery and cross-tab serialization through Web Locks. */
export class FileSystemStore {
  #mutex = new StoreMutex();
  #closed = false;

  constructor({ directory, lockName, locks = globalThis.navigator?.locks, sync = false, ...options } = {}) {
    this.io = new DirectoryIO({ directory, sync, ...options });
    this.directory = directory;
    this.lockName = lockName ?? `sharpforge-git-directory:${directory.name}`;
    this.locks = locks;
    this.capabilities = Object.freeze({ backend: sync ? 'opfs-sync-worker' : 'filesystem-access', persistent: true,
      atomicTransactions: true, recovery: 'journal', crossTabLocks: Boolean(locks), nativeGitLocks: false });
  }

  async #locked(callback, { signal } = {}) {
    if (this.#closed) throw new GitError('Disposed', 'Repository store has been closed');
    return this.#mutex.run(async () => {
      const run = async () => {
        checkCancelled(signal);
        await recoverDirectoryJournal(this.io);
        return callback();
      };
      try {
        return this.locks ? await this.locks.request(this.lockName, { mode: 'exclusive', signal }, run) : await run();
      } catch (error) { throw storageFailure(error, 'repository transaction'); }
    }, { signal });
  }

  #checkKey(key) {
    if (key === JOURNAL_DIRECTORY || key.startsWith(`${JOURNAL_DIRECTORY}/`)) {
      throw new GitError('Unsafe', 'Repository transaction metadata is reserved');
    }
    return key;
  }

  get(key, options = {}) { return this.#locked(() => this.io.get(this.#checkKey(key), options), options); }
  list(prefix = '', options = {}) {
    return this.#locked(async () => (await this.io.list(prefix, options)).filter(key => !key.startsWith(`${JOURNAL_DIRECTORY}/`)), options);
  }
  set(key, value, options) { return this.transaction(tx => tx.set(this.#checkKey(key), value), options); }
  delete(key, options) { return this.transaction(tx => tx.delete(this.#checkKey(key)), options); }

  async transaction(callback, options = {}) {
    return this.#locked(async () => {
      const overlay = createStoreOverlay(this.io, options);
      try {
        const result = await callback(overlay.tx);
        for (const key of overlay.changes.keys()) this.#checkKey(key);
        await commitDirectoryJournal(this.io, overlay.changes, options);
        return result;
      } finally { overlay.finish(); }
    }, options);
  }

  installPack(value, options) { return installPack(this, value, options); }
  readPack(id, options) { return readPack(this, id, options); }
  removePack(id, options) { return removePack(this, id, options); }
  listPacks(options) { return listPacks(this, options); }
  async close() { this.#closed = true; }
}
