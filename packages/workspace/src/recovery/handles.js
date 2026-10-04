import {throwIfWorkspaceAborted} from '../content-hash.js';
import {sanitizeRecoveryValue} from './sanitize.js';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** IndexedDB preserves browser directory handles as structured clones; trust and granted permissions are never persisted. */
export class RecentWorkspaceHandles {
  constructor({indexedDB = globalThis.indexedDB, name = 'sharpforge-workspace-handles', maxEntries = 20,
    maxIdentityEntries = 100000} = {}) {
    if (![maxEntries, maxIdentityEntries].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('SFW1326: Recent workspace and identity capacities must be positive safe integers');
    }
    Object.assign(this, {indexedDB, name, maxEntries, maxIdentityEntries});
    this.database = null;
    this.opening = null;
    this.disposed = false;
    this.abort = new AbortController();
  }

  check(signal) {
    if (this.disposed) throw new Error('SFW1320: Recent workspaces are disposed');
    throwIfWorkspaceAborted(signal);
  }

  async open() {
    this.check();
    if (this.database) return this.database;
    if (this.opening) return this.opening;
    this.opening = this.openDatabase();
    try { return await this.opening; }
    finally { this.opening = null; }
  }

  async openDatabase() {
    if (!this.indexedDB) throw new Error('SFW1321: IndexedDB directory handle persistence is unavailable');
    const request = this.indexedDB.open(this.name, 2);
    request.onupgradeneeded = () => {
      for (const store of ['workspaces', 'identities']) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, {keyPath: 'identity'});
      }
    };
    const database = await requestResult(request);
    if (this.disposed) database.close();
    this.check();
    database.onversionchange = () => this.dispose();
    this.database = database;
    return database;
  }

  async useStore(mode, action, storeName = 'workspaces') {
    const database = await this.open();
    this.check();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let result;
      let failed = false;
      transaction.oncomplete = () => { if (!failed) resolve(result); };
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      transaction.onerror = () => { failed = true; reject(transaction.error); };
      const request = action(transaction.objectStore(storeName));
      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => { failed = true; reject(request.error); };
      }
    });
  }

  async remember({identity, handle, name = handle?.name ?? 'Workspace', openDocuments = []}) {
    if (typeof identity !== 'string' || !identity || identity.length > 4096 || handle?.kind !== 'directory') {
      throw new Error('SFW1322: Workspace identity and directory handle are required');
    }
    const records = await this.list();
    const sequence = Math.max(0, ...records.map(record => record.sequence ?? 0)) + 1;
    await this.useStore('readwrite', store => store.put({identity, name, handle, sequence,
      openDocuments: sanitizeRecoveryValue(openDocuments)}));
    const stale = records.filter(record => record.identity !== identity).sort((left, right) => right.sequence - left.sequence)
      .slice(Math.max(0, this.maxEntries - 1));
    for (const record of stale) await this.forget(record.identity);
  }

  async list() {
    return (await this.useStore('readonly', store => store.getAll())).sort((left, right) => right.sequence - left.sequence);
  }

  /** Remove a recent-menu entry without rotating the physical identity another window may still hold. */
  async forget(identity) { await this.useStore('readwrite', store => store.delete(identity)); }

  async matchingIdentity(handle, records, signal) {
    for (const record of records) {
      this.check(signal);
      const same = await handle.isSameEntry(record.handle);
      this.check(signal);
      if (same) return record.identity;
    }
    return null;
  }

  /** Stable keys are never evicted with the bounded recent menu; capacity refusal preserves every existing lock identity. */
  async identify(handle, {locks = globalThis.navigator?.locks, signal, createId = () => crypto.randomUUID()} = {}) {
    this.check(signal);
    if (handle?.kind !== 'directory' || typeof handle.isSameEntry !== 'function') {
      throw new Error('SFW1325: Stable workspace identity requires a comparable directory handle');
    }
    if (!locks?.request) throw new Error('SFW1325: Web Locks are required to register a shared folder identity');
    const heldSignal = signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
    return locks.request('sharpforge:recent-folder-identities', {mode: 'exclusive', signal: heldSignal}, async () => {
      this.check(heldSignal);
      const records = await this.useStore('readonly', store => store.getAll(), 'identities');
      this.check(heldSignal);
      const existing = await this.matchingIdentity(handle, records, heldSignal);
      this.check(heldSignal);
      if (existing) return existing;
      if (records.length >= this.maxIdentityEntries) throw new Error('SFW1326: Stable folder identity capacity exceeded');
      const recent = await this.list();
      this.check(heldSignal);
      const previous = await this.matchingIdentity(handle, recent, heldSignal);
      this.check(heldSignal);
      const identity = previous ?? 'directory:' + createId();
      if (typeof identity !== 'string' || !identity || identity.length > 4096 || records.some(record => record.identity === identity)) {
        throw new Error('SFW1327: Stable folder identity must be unique and bounded');
      }
      await this.useStore('readwrite', store => store.put({identity, handle}), 'identities');
      this.check(heldSignal);
      await this.remember({identity, handle});
      this.check(heldSignal);
      return identity;
    });
  }

  /** Call from an explicit recent-folder action so requestPermission has user activation. Denial returns read-only recovery. */
  async reopen(identity, {mode = 'readwrite', recovery = null, signal} = {}) {
    throwIfWorkspaceAborted(signal);
    const record = await this.useStore('readonly', store => store.get(identity));
    if (!record) throw new Error('SFW1323: Recent workspace no longer exists');
    let permission = await record.handle.queryPermission?.({mode}) ?? 'prompt';
    throwIfWorkspaceAborted(signal);
    if (permission !== 'granted') permission = await record.handle.requestPermission?.({mode}) ?? 'denied';
    throwIfWorkspaceAborted(signal);
    if (permission !== 'granted') {
      return {identity, readOnly: true, permission, record: await recovery?.(), openDocuments: record.openDocuments,
        diagnostic: {code: 'SFW1324', message: 'Folder permission denied; recovered buffers are read-only'}};
    }
    return {identity, readOnly: mode !== 'readwrite', permission, handle: record.handle, openDocuments: record.openDocuments};
  }

  dispose() {
    this.disposed = true;
    this.abort.abort(new DOMException('Recent workspaces disposed', 'AbortError'));
    this.database?.close();
    this.database = null;
  }
}
