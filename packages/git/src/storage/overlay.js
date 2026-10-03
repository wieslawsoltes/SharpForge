import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { copyBytes, validateStorageKey } from './store-contract.js';

/** Transaction-local write set; the adapter decides how to durably publish it. */
export function createStoreOverlay(store, { signal, maxTransactionBytes = 1024 * 1024 * 1024 } = {}) {
  const changes = new Map();
  const reads = new Map();
  const lists = new Map();
  let active = true;
  let bytes = 0;
  const check = () => {
    checkCancelled(signal);
    if (!active) throw new GitError('Disposed', 'Storage transaction has completed');
  };
  const tx = {
    async get(key) {
      check();
      validateStorageKey(key);
      if (changes.has(key)) return changes.get(key)?.slice();
      if (!reads.has(key)) reads.set(key, await store.get(key, { signal }));
      return reads.get(key)?.slice();
    },
    async set(key, value) {
      check();
      validateStorageKey(key);
      const copy = copyBytes(value);
      bytes += copy.length - (changes.get(key)?.length ?? 0);
      checkLimit(bytes, maxTransactionBytes, 'Repository transaction');
      changes.set(key, copy);
    },
    async delete(key) {
      check();
      validateStorageKey(key);
      bytes -= changes.get(key)?.length ?? 0;
      changes.set(key, undefined);
    },
    async list(prefix = '') {
      check();
      validateStorageKey(prefix, { prefix: true });
      if (!lists.has(prefix)) lists.set(prefix, await store.list(prefix, { signal }));
      const keys = new Set(lists.get(prefix));
      for (const [key, value] of changes) {
        if (!key.startsWith(prefix)) continue;
        value === undefined ? keys.delete(key) : keys.add(key);
      }
      return [...keys].sort();
    }
  };
  return { tx, changes, reads, lists, finish() { active = false; } };
}
