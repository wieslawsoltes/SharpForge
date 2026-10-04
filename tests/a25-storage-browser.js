import { GitError } from '../packages/git/src/errors.js';
import { ObjectDatabase } from '../packages/git/src/odb.js';
import { MemoryObjectDatabase } from '../packages/git/src/memory-odb.js';
import { IndexedDBStore } from '../packages/git/src/storage/idb-odb.js';
import { createBrowserObjectDatabase } from '../packages/git/src/storage/opfs-odb.js';
import { RefDatabase } from '../packages/git/src/refs.js';
import { GitConfig } from '../packages/git/src/config.js';
import { initLocalRepository, openLocalRepository } from '../packages/git/src/fs-odb.js';
import { encodeTree, encodeCommit } from '../packages/git/src/objects.js';
import { runCredentialVault } from './a25-auth-browser.js';

const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);
const identity = { name: 'Browser Fixture', email: 'browser@example.test', timestamp: 1700000000, timezone: '+0000' };
const status = document.querySelector('#status');

function assert(value, message) { if (!value) throw new Error(message); }

async function expectCode(callback, code) {
  try { await callback(); } catch (error) {
    assert(error.code === code, `Expected ${code}, received ${error.code}: ${error.message}`);
    return;
  }
  throw new Error(`Expected ${code}`);
}

async function openDatabase(backend, repositoryId) {
  if (backend === 'memory') {
    const odb = new MemoryObjectDatabase();
    return { odb, store: odb.store, capabilities: odb.store.capabilities, backend: 'memory' };
  }
  return createBrowserObjectDatabase({ backend, repositoryId });
}

/** A reloadable 50,000-object IndexedDB fixture; all persisted objects are rehashed on read. */
async function run({ backend = 'indexeddb', repositoryId = 'a25-persistence', count = 50000, phase = 'write' } = {}) {
  const started = performance.now();
  const descriptor = await openDatabase(backend, repositoryId);
  const { odb, store } = descriptor;
  let total = 0;
  try {
    if (phase === 'write') {
      for (let start = 0; start < count; start += 500) {
        const batch = [];
        for (let index = start; index < Math.min(count, start + 500); index++) {
          batch.push({ type: 'blob', data: encode(`SharpForge persistent object ${index}\n`) });
        }
        await odb.writeMany(batch, { maxObjects: 500 });
        total += batch.length;
        status.textContent = `Persisted ${total} objects using ${descriptor.backend}`;
      }
      await store.set('acceptance.json', encode(JSON.stringify({ count })));
    } else if (phase === 'read') {
      const marker = JSON.parse(decode(await store.get('acceptance.json')));
      assert(marker.count === count, 'Persistence marker did not survive reload');
      await store.transaction(async tx => {
        const reader = new ObjectDatabase({ store: tx });
        const ids = await reader.list();
        assert(ids.length === count, `Expected ${count} persisted objects; got ${ids.length}`);
        for (let start = 0; start < ids.length; start += 128) {
          const values = await Promise.all(ids.slice(start, start + 128).map(oid => reader.read(oid)));
          for (const value of values) assert(value.type === 'blob' && value.size > 0, 'Persisted object failed validation');
          total += values.length;
        }
      });
    } else throw new Error('Unknown acceptance phase');
    return { phase, requestedBackend: backend, backend: descriptor.backend, count: total,
      elapsedMs: performance.now() - started, capabilities: descriptor.capabilities };
  } finally { await odb.close(); }
}

async function conformance({ backend = 'memory', repositoryId = `a25-conformance-${backend}` } = {}) {
  const { odb, store, capabilities, backend: actualBackend } = await openDatabase(backend, repositoryId);
  try {
    const source = encode('conformance\n');
    const blob = await odb.write('blob', source);
    source.fill(0);
    assert(decode((await odb.read(blob)).data) === 'conformance\n', 'Input buffer leaked into storage');
    const tree = await odb.write('tree', encodeTree([{ name: 'file.txt', mode: 0o100644, oid: blob }]));
    const commit = await odb.write('commit', encodeCommit({ tree, author: identity, committer: identity, message: 'Browser fixture\n' }));
    assert((await odb.readHeader(commit)).type === 'commit', 'Commit header mismatch');
    const refs = new RefDatabase({ store });
    await refs.setSymbolic('HEAD', 'refs/heads/main', { identity });
    await refs.update('HEAD', commit, { expected: null, identity });
    await expectCode(() => refs.update('HEAD', blob, { expected: null }), 'Conflict');
    assert(await refs.read('HEAD') === commit, 'CAS overwrote HEAD');
    const config = await new GitConfig({ store }).load();
    config.set('user.name', identity.name);
    await config.save();
    assert((await new GitConfig({ store }).load()).get('user.name') === identity.name, 'Config did not persist');
    const controller = new AbortController();
    await expectCode(() => store.transaction(async tx => {
      await tx.set('cancelled', encode('must not exist'));
      controller.abort();
    }, { signal: controller.signal }), 'Cancelled');
    assert(await store.get('cancelled') === undefined, 'Cancelled transaction partially committed');
    await expectCode(() => store.transaction(async tx => {
      await tx.set('rollback', encode('must not exist'));
      throw new GitError('Conflict', 'Injected transaction failure');
    }), 'Conflict');
    assert(await store.get('rollback') === undefined, 'Failed transaction partially committed');
    const id = 'a'.repeat(40);
    await store.installPack({ id, pack: Uint8Array.of(1, 2), index: Uint8Array.of(3, 4) });
    assert((await store.readPack(id)).index[1] === 4, 'Pack index did not persist');
    await store.removePack(id);
    assert((await store.listPacks()).length === 0, 'Pack removal left records');
    await odb.remove(blob);
    assert(!await odb.has(blob), 'Object deletion failed');
    return { requestedBackend: backend, backend: actualBackend, capabilities, cases: 12 };
  } finally { await odb.close(); }
}

function quotaFactory(nativeFactory) {
  const wrap = (target, overrides) => new Proxy(target, {
    get(object, name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      const value = Reflect.get(object, name, object);
      return typeof value === 'function' ? value.bind(object) : value;
    },
    set(object, name, value) { return Reflect.set(object, name, value, object); }
  });
  const database = native => wrap(native, { transaction(...args) {
    const transaction = native.transaction(...args);
    return wrap(transaction, { objectStore(name) {
      const store = transaction.objectStore(name);
      return wrap(store, { put(value, key) {
        if (key?.[1]?.endsWith('.idx')) throw new DOMException('Injected storage quota exhaustion', 'QuotaExceededError');
        return store.put(value, key);
      } });
    } });
  } });
  return { open(...args) {
    const request = nativeFactory.open(...args);
    return new Proxy(request, {
      get(object, name) {
        const value = Reflect.get(object, name, object);
        if (name === 'result' && value) return database(value);
        return typeof value === 'function' ? value.bind(object) : value;
      },
      set(object, name, value) { return Reflect.set(object, name, value, object); }
    });
  } };
}

/** Inject QuotaExceededError into real IndexedDB after pack chunks have been written. */
async function runQuota({ repositoryId = 'a25-quota' } = {}) {
  const options = { repositoryId, databaseName: 'sharpforge-git-quota-acceptance', chunkBytes: 1024 };
  const failing = new IndexedDBStore({ ...options, indexedDB: quotaFactory(indexedDB) });
  const id = 'f'.repeat(40);
  try {
    await expectCode(() => failing.installPack({ id, pack: new Uint8Array(8192), index: new Uint8Array(1024) }), 'Quota');
  } finally { await failing.close(); }
  const reloaded = new IndexedDBStore(options);
  try {
    const paths = await reloaded.list('objects/pack/');
    assert(paths.length === 0, `Quota failure left ${paths.length} partial pack paths`);
    return { backend: 'indexeddb', quotaInjected: true, partialPackPaths: paths.length };
  } finally { await reloaded.close(); }
}

async function runFallback({ repositoryId = 'a25-fallback' } = {}) {
  const descriptor = await createBrowserObjectDatabase({ repositoryId,
    workerFactory: () => { throw new Error('Fixture reports module worker unsupported'); } });
  try {
    assert(descriptor.backend === 'indexeddb', 'Unsupported OPFS did not fall back to IndexedDB');
    assert(descriptor.capabilities.fallbackFrom === 'opfs', 'Fallback capability was not reported');
    const oid = await descriptor.odb.write('blob', encode('fallback works'));
    assert(await descriptor.odb.has(oid), 'Fallback ODB did not work');
    return descriptor.capabilities;
  } finally { await descriptor.odb.close(); }
}

async function runFileSystem({ name = 'a25-picked-directory' } = {}) {
  const root = await navigator.storage.getDirectory();
  await root.removeEntry(name, { recursive: true }).catch(error => { if (error.name !== 'NotFoundError') throw error; });
  const directory = await root.getDirectoryHandle(name, { create: true });
  const initial = await initLocalRepository({ directory });
  const blob = await initial.odb.write('blob', encode('filesystem API fixture'));
  await initial.worktree.write('file.txt', encode('filesystem API fixture'));
  await initial.odb.close();
  const reopened = await openLocalRepository({ directory });
  try {
    assert(decode((await reopened.odb.read(blob)).data) === 'filesystem API fixture', 'Filesystem object did not persist');
    assert((await reopened.worktree.list()).join(',') === 'file.txt', 'Worktree exposed .git metadata');
    return { backend: 'filesystem-access', directorySource: 'opfs-test-handle', oid: blob, metadataHiddenFromWorktree: true };
  } finally { await reopened.odb.close(); }
}

window.gitStorageAcceptance = { run, conformance, runQuota, runFallback, runFileSystem, runCredentialVault };
status.textContent = 'Ready';
