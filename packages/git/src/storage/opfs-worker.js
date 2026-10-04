import { GitError, checkCancelled } from '../errors.js';
import { FileSystemStore } from '../fs/directory-store.js';
import { sameBytes } from './store-contract.js';
import { hashBytes } from '../hash.js';
import { storageFailure } from './store-contract.js';

let store;
const operations = new Map();

async function initialize({ repositoryId }, { signal }) {
  checkCancelled(signal);
  if (store) throw new GitError('Conflict', 'OPFS worker already has a repository');
  if (!globalThis.navigator?.storage?.getDirectory) throw new GitError('Unsupported', 'Origin-private filesystem is unavailable');
  if (!globalThis.navigator?.locks) throw new GitError('Unsupported', 'Cross-worker Web Locks are required for OPFS transactions');
  if (typeof repositoryId !== 'string' || !repositoryId || repositoryId.length > 1024) throw new GitError('Unsafe', 'Invalid repository id');
  const root = await navigator.storage.getDirectory();
  checkCancelled(signal);
  const repositories = await root.getDirectoryHandle('sharpforge-git', { create: true });
  const bytes = new TextEncoder().encode(repositoryId);
  const directoryName = await hashBytes(bytes, { algorithm: 'sha256' });
  const directory = await repositories.getDirectoryHandle(directoryName, { create: true });
  checkCancelled(signal);
  await navigator.locks.request(`sharpforge-opfs:${repositoryId}`, { signal }, async () => {
    const probe = await directory.getFileHandle('.sync-probe', { create: true });
    if (!probe.createSyncAccessHandle) throw new GitError('Unsupported', 'OPFS synchronous handles are unavailable');
    const access = await probe.createSyncAccessHandle();
    access.close();
    await directory.removeEntry('.sync-probe');
  });
  checkCancelled(signal);
  store = new FileSystemStore({ directory, sync: true, lockName: `sharpforge-opfs:${repositoryId}` });
  return store.capabilities;
}

async function commit({ changes, reads, lists }, { signal }) {
  return store.transaction(async tx => {
    for (const [key, expected] of reads) {
      if (!sameBytes(await tx.get(key), expected)) throw new GitError('Conflict', 'Repository changed during transaction', { key });
    }
    for (const [prefix, expected] of lists) {
      const actual = await tx.list(prefix);
      if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
        throw new GitError('Conflict', 'Repository paths changed during transaction', { prefix });
      }
    }
    for (const [key, value] of changes) value === undefined ? await tx.delete(key) : await tx.set(key, value);
  }, { signal });
}

const handlers = {
  initialize,
  get: ({ key }, options) => store.get(key, options),
  list: ({ prefix }, options) => store.list(prefix, options),
  commit,
  close: () => store?.close()
};

globalThis.addEventListener('message', async event => {
  const { id, operation, args } = event.data ?? {};
  if (operation === 'cancel') { operations.get(id)?.abort(); return; }
  const controller = new AbortController();
  operations.set(id, controller);
  try {
    const handler = handlers[operation];
    if (!handler || (!store && operation !== 'initialize')) throw new GitError('Unsupported', 'Unknown OPFS worker operation');
    const result = await handler(args, { signal: controller.signal });
    globalThis.postMessage({ id, result }, result instanceof Uint8Array ? [result.buffer] : []);
  } catch (error) {
    globalThis.postMessage({ id, error: storageFailure(error, 'OPFS worker operation').toJSON() });
  } finally { operations.delete(id); }
});
