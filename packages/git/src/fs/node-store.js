import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { GitError, checkCancelled } from '../errors.js';
import { NodeDirectoryIO } from './node-io.js';
import { StoreMutex, sameBytes } from '../storage/store-contract.js';
import { createStoreOverlay } from '../storage/overlay.js';
import { installPack, readPack, removePack, listPacks } from '../storage/pack-store.js';
import { hasNodeNamespaceChanges, commitNodeNamespace, recoverNodeNamespace, isNodeJournalKey } from './node-namespace.js';

const processLock = '.sharpforge-transaction.lock';

async function createLock(path) {
  try { return await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o666); }
  catch (error) {
    if (error.code === 'EEXIST') throw new GitError('Conflict', 'Git lock already exists; another writer may be active', { path });
    throw error;
  }
}

async function removeOwnedLock(path) {
  await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

/** Node Git store with native Git lockfiles and compare-and-swap against its transaction read set. */
export class NodeFileStore {
  #mutex = new StoreMutex();
  #closed = false;

  constructor(options = {}) {
    this.io = new NodeDirectoryIO(options);
    this.directory = this.io.directory;
    this.capabilities = Object.freeze({ backend: 'node-filesystem', persistent: true, atomicTransactions: true, nativeGitLocks: true });
  }

  async #locked(callback, { signal } = {}) {
    if (this.#closed) throw new GitError('Disposed', 'Repository store has been closed');
    return this.#mutex.run(async () => {
      const path = await this.io.path(processLock);
      const handle = await createLock(path);
      try {
        await recoverNodeNamespace(this.io);
        return await callback();
      }
      catch (error) {
        if (error instanceof GitError) throw error;
        if (error.code === 'ENOSPC' || error.code === 'EDQUOT') throw new GitError('Quota', 'Repository filesystem quota exceeded');
        if (error.code === 'EACCES' || error.code === 'EPERM') throw new GitError('Unsafe', 'Repository filesystem permission denied');
        throw GitError.from(error);
      } finally {
        await handle.close();
        await removeOwnedLock(path);
      }
    }, { signal });
  }

  #key(key) {
    if (key === processLock || isNodeJournalKey(key)) throw new GitError('Unsafe', 'Repository transaction metadata is reserved');
    return key;
  }

  get(key, options = {}) { return this.#locked(() => this.io.get(this.#key(key), options), options); }
  list(prefix = '', options = {}) {
    return this.#locked(async () => (await this.io.list(prefix, options)).filter(key => key !== processLock && !isNodeJournalKey(key)), options);
  }
  set(key, value, options) { return this.transaction(tx => tx.set(this.#key(key), value), options); }
  delete(key, options) { return this.transaction(tx => tx.delete(this.#key(key)), options); }

  async #commit(overlay, options = {}) {
    const { signal } = options;
    for (const key of new Set([...overlay.reads.keys(), ...overlay.changes.keys()])) this.#key(key);
    if (hasNodeNamespaceChanges(overlay.changes)) return commitNodeNamespace(this.io, overlay, options);
    const locks = new Map();
    const previous = new Map();
    const committed = [];
    try {
      const keys = new Set([...overlay.reads.keys(), ...overlay.changes.keys()]);
      for (const key of [...keys].sort()) {
        this.#key(key);
        const path = await this.io.path(key, { create: true });
        const lockPath = `${path}.lock`;
        locks.set(key, { path, lockPath, handle: await createLock(lockPath) });
      }
      for (const [key, expected] of overlay.reads) {
        if (!sameBytes(await this.io.get(key, { signal }), expected)) throw new GitError('Conflict', 'Repository changed during transaction', { key });
      }
      const ownedLocks = new Set([...locks.keys()].map(key => `${key}.lock`));
      for (const [prefix, expected] of overlay.lists) {
        const actual = (await this.io.list(prefix, { signal })).filter(key => key !== processLock && !ownedLocks.has(key));
        if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
          throw new GitError('Conflict', 'Repository paths changed during transaction', { prefix });
        }
      }
      for (const [key, value] of overlay.changes) {
        previous.set(key, await this.io.get(key, { signal }));
        const lock = locks.get(key);
        if (value !== undefined) await lock.handle.writeFile(value);
        await lock.handle.sync();
      }
      checkCancelled(signal);
      for (const [key, value] of overlay.changes) {
        const lock = locks.get(key);
        await lock.handle.close();
        lock.handle = undefined;
        if (value === undefined) await this.io.delete(key);
        else { await rename(lock.lockPath, lock.path); lock.renamed = true; }
        committed.push(key);
      }
    } catch (error) {
      for (const key of committed.reverse()) {
        const old = previous.get(key);
        if (old === undefined) await this.io.delete(key);
        else {
          const lock = locks.get(key);
          const restore = lock.renamed ? await createLock(lock.lockPath)
            : await open(lock.lockPath, constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0));
          try { await restore.writeFile(old); await restore.sync(); } finally { await restore.close(); }
          await rename(lock.lockPath, lock.path);
        }
      }
      throw error;
    } finally {
      for (const lock of locks.values()) { await lock.handle?.close(); await removeOwnedLock(lock.lockPath); }
    }
  }

  async transaction(callback, options = {}) {
    return this.#locked(async () => {
      const raw = { get: (key, settings) => this.io.get(this.#key(key), settings),
        list: async (prefix, settings) => (await this.io.list(prefix, settings))
          .filter(key => key !== processLock && !isNodeJournalKey(key)) };
      const overlay = createStoreOverlay(raw, options);
      try {
        const result = await callback(overlay.tx);
        await this.#commit(overlay, options);
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
