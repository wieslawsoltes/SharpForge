import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateStorageKey } from './store-contract.js';

export function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Observe each request before enqueueing the next: an IDB method can throw synchronously.
function idbRequestBatch(enqueue) {
  return new Promise((resolve, reject) => {
    const results = [];
    let pending = 0;
    enqueue(request => {
      const index = results.length;
      results.push(undefined);
      pending++;
      request.onsuccess = () => {
        results[index] = request.result;
        if (--pending === 0) resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
    if (pending === 0) resolve(results);
  });
}

export function idbCompletion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new DOMException('Transaction aborted', 'AbortError'));
    transaction.onerror = () => {};
  });
}

/** Chunk records remain in the same IndexedDB transaction as their manifest. */
export function createIdbTransaction({ objectStore, keyRange, repositoryId, chunkBytes, maxValueBytes, signal }) {
  const range = key => keyRange.bound([repositoryId, key, 0], [repositoryId, key, Number.MAX_SAFE_INTEGER]);
  const check = key => {
    checkCancelled(signal);
    return validateStorageKey(key);
  };
  return {
    async get(key) {
      check(key);
      const metadata = await idbRequest(objectStore.get([repositoryId, key, 0]));
      if (metadata === undefined) return undefined;
      checkLimit(metadata.length, maxValueBytes, 'IndexedDB value');
      checkLimit(metadata.chunks, Math.ceil(maxValueBytes / chunkBytes), 'IndexedDB chunk count');
      if (metadata.chunks !== Math.ceil(metadata.length / chunkBytes)) throw new GitError('Corrupt', 'Invalid storage chunk manifest');
      const pieces = await idbRequestBatch(add => {
        for (let chunk = 1; chunk <= metadata.chunks; chunk++) add(objectStore.get([repositoryId, key, chunk]));
      });
      const value = new Uint8Array(metadata.length);
      let offset = 0;
      for (const piece of pieces) {
        if (!(piece instanceof Uint8Array) || piece.length !== Math.min(chunkBytes, value.length - offset)) {
          throw new GitError('Corrupt', 'Missing or malformed repository storage chunk');
        }
        value.set(piece, offset);
        offset += piece.length;
      }
      checkCancelled(signal);
      return value;
    },
    async set(key, value) {
      check(key);
      if (!(value instanceof Uint8Array)) throw new TypeError('Repository storage values must be Uint8Array');
      checkLimit(value.length, maxValueBytes, 'IndexedDB value');
      const count = Math.ceil(value.length / chunkBytes);
      await idbRequestBatch(add => {
        add(objectStore.delete(range(key)));
        add(objectStore.put({ length: value.length, chunks: count }, [repositoryId, key, 0]));
        for (let chunk = 0; chunk < count; chunk++) {
          const bytes = value.slice(chunk * chunkBytes, Math.min(value.length, (chunk + 1) * chunkBytes));
          add(objectStore.put(bytes, [repositoryId, key, chunk + 1]));
        }
      });
    },
    async delete(key) {
      check(key);
      await idbRequest(objectStore.delete(range(key)));
    },
    async list(prefix = '') {
      checkCancelled(signal);
      validateStorageKey(prefix, { prefix: true });
      const bounds = keyRange.bound([repositoryId, prefix], [repositoryId, `${prefix}\uffff`]);
      return new Promise((resolve, reject) => {
        const result = [];
        const request = objectStore.openKeyCursor(bounds);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          try {
            checkCancelled(signal);
            const cursor = request.result;
            if (!cursor) return resolve(result);
            if (cursor.key[2] === 0) result.push(cursor.key[1]);
            cursor.continue();
          } catch (error) {
            reject(error);
          }
        };
      });
    }
  };
}
