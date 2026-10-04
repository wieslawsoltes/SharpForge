import { GitError, checkLimit } from '../errors.js';
import {
  COLLAB_PROTOCOL_VERSION, collaborationLimits, validateIdentity, validateUpdate, sameDocument, sameIdentity
} from './validation.js';

function persistenceKey(identity) {
  return JSON.stringify([identity.workspaceId, identity.roomId, identity.documentId, identity.clientId]);
}

function emptyMetadata(identity, key) {
  return { key, version: COLLAB_PROTOCOL_VERSION, identity, count: 0, bytes: 0 };
}

function prepareEntries(identity, entries, limits) {
  checkLimit(entries.length, 1024, 'Collaboration persistence batch');
  return entries.map(entry => {
    const update = validateUpdate(entry.update, limits);
    if (!sameDocument(identity, update) || (entry.pending || entry.initialize) && update.actorId !== identity.clientId) {
      throw new GitError('Auth', 'Persisted collaboration operation belongs to another identity');
    }
    const bytes = new TextEncoder().encode(JSON.stringify(update)).byteLength;
    checkLimit(bytes, limits.maxUpdateBytes, 'Collaboration persisted operation bytes');
    return { update, pending: entry.pending === true, initialize: entry.initialize === true, bytes };
  });
}

function loadedState(identity, records, limits) {
  const updates = [];
  const pendingIds = [];
  let initializationId = null;
  let bytes = 0;
  for (const record of records) {
    const [entry] = prepareEntries(identity, [record], limits);
    updates.push(entry.update);
    bytes += entry.bytes;
    checkLimit(bytes, limits.maxHistoryBytes, 'Persisted collaboration history bytes');
    if (entry.pending) pendingIds.push(entry.update.id);
    if (entry.initialize) {
      if (initializationId && initializationId !== entry.update.id) throw new GitError('Corrupt', 'Journal has multiple room initializations');
      initializationId = entry.update.id;
    }
  }
  checkLimit(updates.length, limits.maxOperations, 'Persisted collaboration history');
  checkLimit(bytes, limits.maxHistoryBytes, 'Persisted collaboration history bytes');
  return {
    snapshot: { type: 'snapshot', version: COLLAB_PROTOCOL_VERSION, workspaceId: identity.workspaceId, documentId: identity.documentId, updates },
    pendingIds, initializationId
  };
}

/** Volatile provider for tests and explicitly ephemeral sessions. It never claims disk durability. */
export class MemoryCollaborationPersistence {
  #documents = new Map();
  #disposed = false;

  constructor({ limits } = {}) {
    this.limits = collaborationLimits(limits);
    this.capability = Object.freeze({ persistent: false, backend: 'memory' });
  }

  async load(input) {
    this.#assertOpen();
    const identity = validateIdentity(input);
    return loadedState(identity, this.#documents.get(persistenceKey(identity))?.records.values() ?? [], this.limits);
  }

  append(identity, update, { pending = false, initialize = false } = {}) {
    return this.appendMany(identity, [{ update, pending, initialize }]);
  }

  async appendMany(input, entries) {
    this.#assertOpen();
    const identity = validateIdentity(input);
    const prepared = prepareEntries(identity, entries, this.limits);
    const key = persistenceKey(identity);
    const previous = this.#documents.get(key);
    const document = previous ?? { records: new Map(), bytes: 0 };
    const staged = new Map();
    let bytes = document.bytes;
    let count = document.records.size;
    let initializationId = document.initializationId;
    for (const entry of prepared) {
      const existing = staged.get(entry.update.id) ?? document.records.get(entry.update.id);
      if (existing && JSON.stringify(existing.update) !== JSON.stringify(entry.update)) {
        throw new GitError('Conflict', 'Persisted operation ID was reused');
      }
      if (!existing) { bytes += entry.bytes; count++; }
      if (entry.initialize) {
        if (initializationId && initializationId !== entry.update.id) throw new GitError('Conflict', 'Journal already has a room initialization');
        initializationId = entry.update.id;
      }
      staged.set(entry.update.id, {
        update: entry.update, pending: entry.pending || existing?.pending === true,
        initialize: entry.initialize || existing?.initialize === true
      });
    }
    checkLimit(count, this.limits.maxOperations, 'Persisted operation count');
    checkLimit(bytes, this.limits.maxHistoryBytes, 'Persisted history bytes');
    for (const [id, entry] of staged) document.records.set(id, entry);
    document.bytes = bytes;
    document.initializationId = initializationId;
    this.#documents.set(key, document);
  }

  async acknowledge(input, id) {
    this.#assertOpen();
    const identity = validateIdentity(input);
    const record = this.#documents.get(persistenceKey(identity))?.records.get(id);
    if (record) record.pending = false;
  }

  async clear(input) {
    this.#assertOpen();
    this.#documents.delete(persistenceKey(validateIdentity(input)));
  }

  dispose() {
    this.#disposed = true;
    this.#documents.clear();
  }

  #assertOpen() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration persistence is disposed');
  }
}

/** IndexedDB journal commits each operation together with its pending-outbox flag in one transaction. */
export class IndexedDbCollaborationPersistence {
  #database = null;
  #opening = null;
  #disposed = false;

  constructor({ indexedDB = globalThis.indexedDB, databaseName = 'sharpforge-collaboration-v1', limits } = {}) {
    this.indexedDB = indexedDB;
    this.databaseName = databaseName;
    this.limits = collaborationLimits(limits);
    this.capability = Object.freeze({ persistent: true, backend: 'indexeddb' });
  }

  async #open() {
    if (this.#disposed) throw new GitError('Disposed', 'Collaboration persistence is disposed');
    if (this.#database) return this.#database;
    if (!this.indexedDB) throw new GitError('Unsupported', 'IndexedDB collaboration persistence is unavailable');
    if (!this.#opening) this.#opening = new Promise((resolve, reject) => {
      let abandoned = false;
      const request = this.indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore('documents', { keyPath: 'key' });
        const operations = database.createObjectStore('operations', { keyPath: ['key', 'id'] });
        operations.createIndex('by-document', 'key', { unique: false });
      };
      request.onerror = () => { abandoned = true; reject(storageError(request.error)); };
      request.onblocked = () => {
        abandoned = true;
        reject(new GitError('Conflict', 'Another tab is blocking the collaboration database upgrade'));
      };
      request.onsuccess = () => {
        if (this.#disposed || abandoned) {
          request.result.close();
          reject(new GitError('Disposed', 'Collaboration persistence closed while opening'));
          return;
        }
        this.#database = request.result;
        this.#database.onversionchange = () => {
          this.#database?.close();
          this.#database = null;
          this.#opening = null;
        };
        resolve(this.#database);
      };
    }).catch(error => {
      this.#opening = null;
      throw error;
    });
    return this.#opening;
  }

  async load(input) {
    const identity = validateIdentity(input);
    const key = persistenceKey(identity);
    const database = await this.#open();
    return transaction(database, 'readonly', async stores => {
      const metadata = await requestValue(stores.documents.get(key));
      if (metadata && (metadata.version !== COLLAB_PROTOCOL_VERSION || !sameIdentity(validateIdentity(metadata.identity), identity))) {
        throw new GitError('Corrupt', 'Collaboration journal identity or version mismatch');
      }
      const { records, bytes } = await readCursor(stores.operations.index('by-document').openCursor(key), identity, this.limits);
      const result = loadedState(identity, records, this.limits);
      if (metadata && (metadata.count !== records.length || metadata.bytes !== bytes) || !metadata && records.length) {
        throw new GitError('Corrupt', 'Collaboration journal metadata disagrees');
      }
      return result;
    });
  }

  append(identity, update, { pending = false, initialize = false } = {}) {
    return this.appendMany(identity, [{ update, pending, initialize }]);
  }

  async appendMany(input, entries) {
    const identity = validateIdentity(input);
    const prepared = prepareEntries(identity, entries, this.limits);
    const key = persistenceKey(identity);
    const database = await this.#open();
    return transaction(database, 'readwrite', async stores => {
      const metadata = await requestValue(stores.documents.get(key)) ?? emptyMetadata(identity, key);
      if (!sameIdentity(validateIdentity(metadata.identity), identity)) throw new GitError('Auth', 'Journal identity mismatch');
      if (metadata.version !== COLLAB_PROTOCOL_VERSION) throw new GitError('Corrupt', 'Journal format version mismatch');
      for (const entry of prepared) {
        const id = entry.update.id;
        const existing = await requestValue(stores.operations.get([key, id]));
        if (existing && JSON.stringify(existing.update) !== JSON.stringify(entry.update)) {
          throw new GitError('Conflict', 'Persisted operation ID was reused');
        }
        if (!existing) {
          metadata.count++;
          metadata.bytes += entry.bytes;
        }
        if (entry.initialize) {
          if (metadata.initializationId && metadata.initializationId !== id) throw new GitError('Conflict', 'Journal already has a room initialization');
          metadata.initializationId = id;
        }
        stores.operations.put({
          key, id, update: entry.update, pending: entry.pending || existing?.pending === true,
          initialize: entry.initialize || existing?.initialize === true
        });
      }
      checkLimit(metadata.count, this.limits.maxOperations, 'Persisted collaboration history');
      checkLimit(metadata.bytes, this.limits.maxHistoryBytes, 'Persisted collaboration history bytes');
      stores.documents.put(metadata);
    });
  }

  async acknowledge(input, id) {
    const key = persistenceKey(validateIdentity(input));
    const database = await this.#open();
    return transaction(database, 'readwrite', async stores => {
      const record = await requestValue(stores.operations.get([key, id]));
      if (record) stores.operations.put({ ...record, pending: false });
    });
  }

  async clear(input) {
    const key = persistenceKey(validateIdentity(input));
    const database = await this.#open();
    return transaction(database, 'readwrite', async stores => {
      await deleteCursor(stores.operations.index('by-document').openCursor(key));
      stores.documents.delete(key);
    });
  }

  dispose() {
    this.#disposed = true;
    this.#database?.close();
    this.#database = null;
  }
}

async function transaction(database, mode, action) {
  const current = database.transaction(['documents', 'operations'], mode);
  let finished = false;
  const completion = new Promise((resolve, reject) => {
    current.oncomplete = () => { finished = true; resolve(); };
    current.onabort = () => { finished = true; reject(storageError(current.error)); };
    current.onerror = () => { /* The abort event is the transaction's definitive outcome. */ };
  });
  void completion.catch(() => undefined);
  const stores = { documents: current.objectStore('documents'), operations: current.objectStore('operations') };
  try {
    const result = await action(stores);
    await completion;
    return result;
  } catch (error) {
    if (!finished) current.abort();
    await completion.catch(() => undefined);
    throw storageError(error);
  }
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

function readCursor(request, identity, limits) {
  return new Promise((resolve, reject) => {
    const records = [];
    let bytes = 0;
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve({ records, bytes }); return; }
      if (records.length >= limits.maxOperations) { reject(new GitError('Limit', 'Persisted operation count exceeds its limit')); return; }
      try {
        const [entry] = prepareEntries(identity, [cursor.value], limits);
        bytes += entry.bytes;
        checkLimit(bytes, limits.maxHistoryBytes, 'Persisted collaboration history bytes');
        records.push(entry);
      } catch (error) { reject(error); return; }
      cursor.continue();
    };
  });
}

function deleteCursor(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      cursor.continue();
    };
  });
}

function storageError(error) {
  if (error instanceof GitError) return error;
  if (error?.name === 'QuotaExceededError') return new GitError('Quota', 'Collaboration journal quota exceeded; edits remain unsaved');
  return new GitError('Network', 'Collaboration journal transaction failed');
}
