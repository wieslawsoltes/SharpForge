import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { cleanLfs, LfsUploadClient } from '../lfs-push.js';
import { parseLfsPointer, lfsObjectKey, verifyLfsObject } from '../lfs.js';
import { compilePathspec } from '../ignore.js';
import { validateRemoteUrl } from '../transport/http.js';

/** Built-in LFS filters use verified local cache only. Network hydration is a separate operation. */
export function createLocalLfsAdapter(cache) {
  return Object.freeze({
    clean: (data, options) => cleanLfs(data, { ...options, cache }),
    async smudge(data, options = {}) {
      checkCancelled(options.signal);
      const pointer = parseLfsPointer(data);
      if (!pointer) return data;
      const bytes = await cache.get(lfsObjectKey(pointer.oid), options);
      return bytes === undefined ? data : verifyLfsObject(pointer, bytes);
    }
  });
}

export function createRepositoryLfsClient(repo, options) {
  const remoteName = options.remoteName ?? 'origin';
  const configured = options.lfsEndpoint ?? repo.config.get(`remote.${remoteName}.lfsurl`) ?? repo.config.get('lfs.url');
  const remote = validateRemoteUrl(options.url, options);
  remote.pathname = `${remote.pathname.replace(/\/$/, '')}/info/lfs`;
  remote.search = '';
  return new LfsUploadClient({
    endpoint: configured ?? remote.href, cache: repo.store, transport: options.transport,
    allowInsecureLocalhost: options.allowInsecureLocalhost, maxObjectBytes: options.maxLfsObjectBytes ?? 256 * 1024 * 1024
  });
}

/** Enumerate pointers and verified cache state without downloading any LFS content. */
export async function repositoryLfsStatus(repo, options = {}) {
  const selected = compilePathspec(options.paths ?? ['.']);
  const entries = options.revision ? [...(await repo.readTree(options.revision, options)).values()] : repo.index.entries;
  checkLimit(entries.length, options.maxFiles ?? 100000, 'LFS scan files');
  const result = [];
  for (const entry of entries) {
    checkCancelled(options.signal);
    if (entry.stage || entry.mode === 0o160000 || !selected(entry.path)) continue;
    const object = await (repo.odb.readLocal?.(entry.oid, options) ?? repo.odb.read(entry.oid, options));
    if (object.type !== 'blob' || object.data.length > 1024) continue;
    const pointer = parseLfsPointer(object.data);
    if (!pointer) continue;
    const cached = await repo.store.get(lfsObjectKey(pointer.oid), options);
    if (cached !== undefined) await verifyLfsObject(pointer, cached);
    result.push({ path: entry.path, oid: pointer.oid, size: pointer.size, state: cached === undefined ? 'missing' : 'ready' });
  }
  return result;
}

/** Download into the local verified cache; materialization requires an explicit caller request and overwrite checks. */
export async function fetchRepositoryLfs(repo, options) {
  const files = await repositoryLfsStatus(repo, options);
  const client = createRepositoryLfsClient(repo, options);
  const downloaded = await client.downloadAll(files, options);
  const results = downloaded.map((result, index) => ({
    path: files[index].path, oid: result.pointer.oid, size: result.pointer.size, state: result.state, cached: !!result.cached
  }));
  if (!options.materialize) return results;
  const writes = [];
  for (let index = 0; index < downloaded.length; index++) {
    const file = files[index];
    const result = downloaded[index];
    if (result.state !== 'ready') continue;
    const current = await repo.worktree.read(file.path, options);
    if (current?.data.length === result.data.length && current.data.every((value, offset) => value === result.data[offset])) continue;
    const pointer = current ? parseLfsPointer(current.data) : null;
    if (repo.dirtyBuffers && await repo.dirtyBuffers(file.path)) {
      throw new GitError('Conflict', 'LFS checkout would overwrite an editor buffer', { path: file.path });
    }
    if (current && !pointer && !options.force) throw new GitError('Conflict', 'LFS checkout would overwrite edited content', { path: file.path });
    if (pointer && pointer.oid !== file.oid && !options.force) throw new GitError('Conflict', 'LFS worktree pointer has changed', { path: file.path });
    writes.push({ path: file.path, data: result.data, mode: repo.index.get(file.path)?.mode ?? 0o100644 });
  }
  const snapshot = await repo.snapshot(writes.map(file => file.path), options);
  try {
    for (const file of writes) await repo.worktree.write(file.path, file.data, { ...options, mode: file.mode });
  } catch (error) { await repo.restoreSnapshot(snapshot); throw error; }
  return results;
}
