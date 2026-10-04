import { GitError, checkCancelled } from '../errors.js';
import { validateStorageKey } from '../storage/store-contract.js';
import { installPack, listPacks, readPack, removePack } from '../storage/pack-store.js';
import { validateCheckoutPath, validateSymlinkTarget } from '../path-safety.js';

function scopedTransaction(store, prefix, check) {
  const key = value => prefix + validateStorageKey(value);
  return {
    get(value, options) { check(options?.signal); return store.get(key(value), options); },
    set(value, bytes, options) { check(options?.signal); return store.set(key(value), bytes, options); },
    delete(value, options) { check(options?.signal); return store.delete(key(value), options); },
    async list(value = '', options) {
      check(options?.signal);
      return (await store.list(prefix + validateStorageKey(value, { prefix: true }), options)).map(path => path.slice(prefix.length));
    }
  };
}

/** A child Git store shares durable transactions while its keys and close operation stay inside its namespace. */
export class ScopedRepositoryStore {
  constructor(parent, prefix) {
    this.parent = parent;
    this.prefix = validateStorageKey(prefix.replace(/\/$/, '')) + '/';
    this.closed = false;
    this.capabilities = Object.freeze({ ...parent.capabilities, sharedParent: true });
    this.view = scopedTransaction(parent, this.prefix, signal => this.check(signal));
  }

  check(signal) {
    checkCancelled(signal);
    if (this.closed) throw new GitError('Disposed', 'Nested repository store is closed');
  }

  get(key, options) { return this.view.get(key, options); }
  set(key, value, options) { return this.view.set(key, value, options); }
  delete(key, options) { return this.view.delete(key, options); }
  list(prefix, options) { return this.view.list(prefix, options); }

  transaction(operation, options = {}) {
    this.check(options.signal);
    return this.parent.transaction(transaction => operation(scopedTransaction(transaction, this.prefix, signal => this.check(signal))), options);
  }

  installPack(value, options) { return installPack(this, value, options); }
  readPack(id, options) { return readPack(this, id, options); }
  removePack(id, options) { return removePack(this, id, options); }
  listPacks(options) { return listPacks(this, options); }
  async close() { this.closed = true; }
}

/** Worktree access remains beneath the gitlink, including the destination of symlink entries. */
export class ScopedWorktree {
  constructor(parent, path) {
    this.parent = parent;
    this.prefix = validateCheckoutPath(path) + '/';
    this.caseSensitive = parent.caseSensitive;
    this.supportedModes = parent.supportedModes;
  }

  path(value) { return this.prefix + validateCheckoutPath(value); }
  read(path, options) { return this.parent.read(this.path(path), options); }
  remove(path, options) { return this.parent.remove(this.path(path), options); }

  write(path, bytes, options = {}) {
    if (options.mode === 0o120000) validateSymlinkTarget(path, new TextDecoder().decode(bytes));
    return this.parent.write(this.path(path), bytes, options);
  }

  async list(options) {
    return (await this.parent.list(options)).filter(path => path.startsWith(this.prefix)).map(path => path.slice(this.prefix.length));
  }
}
