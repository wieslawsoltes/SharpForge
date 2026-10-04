/** Small IndexedDB request/transaction fake for directory-handle registry tests. */
export function handleDatabase({version = 0, workspaces = [], identities = []} = {}) {
  const stores = new Map();
  if (version) stores.set('workspaces', new Map(workspaces.map(record => [record.identity, record])));
  if (version >= 2) stores.set('identities', new Map(identities.map(record => [record.identity, record])));
  const state = {version, stores, opens: 0, closes: 0};
  return {state, indexedDB: {open(_name, requestedVersion) {
    const request = {};
    queueMicrotask(() => {
      let closed = false;
      const database = {
        objectStoreNames: {contains: name => stores.has(name)},
        createObjectStore(name) { stores.set(name, new Map()); },
        close() { if (!closed) state.closes++; closed = true; },
        transaction(name, mode) {
          if (closed) throw new DOMException('Database is closed', 'InvalidStateError');
          const entries = stores.get(name);
          if (!entries) throw new DOMException('Store is missing', 'NotFoundError');
          const transaction = {};
          const operation = action => {
            const pending = {};
            queueMicrotask(() => {
              try { pending.result = action(); pending.onsuccess?.(); }
              catch (error) { pending.error = error; pending.onerror?.(); transaction.error = error; transaction.onerror?.(); }
              queueMicrotask(() => transaction.oncomplete?.());
            });
            return pending;
          };
          transaction.objectStore = () => ({
            getAll: () => operation(() => [...entries.values()]),
            get: key => operation(() => entries.get(key)),
            put: record => operation(() => {
              if (mode !== 'readwrite') throw new DOMException('Read-only store', 'ReadOnlyError');
              entries.set(record.identity, record);
              return record.identity;
            }),
            delete: key => operation(() => entries.delete(key))
          });
          return transaction;
        }
      };
      request.result = database;
      state.opens++;
      if (requestedVersion > state.version) {
        state.version = requestedVersion;
        request.onupgradeneeded?.();
      }
      request.onsuccess?.();
    });
    return request;
  }}};
}

/** Serialize the same lock name, including failed/aborted requests, without global state. */
export function registryLocks() {
  const queues = new Map();
  return {request(name, options, action) {
    const result = (queues.get(name) ?? Promise.resolve()).then(() => {
      options.signal?.throwIfAborted();
      return action();
    });
    queues.set(name, result.then(() => {}, () => {}));
    return result;
  }};
}

export function directoryHandle(key, compare = async other => key === other.key) {
  return {kind: 'directory', name: 'Same display name', key, isSameEntry: compare};
}
