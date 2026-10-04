import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GitError, checkLimit } from '../errors.js';
import { encodeStorageText, sameBytes, validateStorageKey } from '../storage/store-contract.js';

export const NODE_NAMESPACE_JOURNAL = '.sharpforge-node-transaction';
export const namespaceFile = (index, kind) => `${NODE_NAMESPACE_JOURNAL}/${index}.${kind}`;
export const namespaceManifest = `${NODE_NAMESPACE_JOURNAL}/manifest`;
export const isNodeJournalKey = key => typeof key === 'string'
  && (key === NODE_NAMESPACE_JOURNAL || key.startsWith(`${NODE_NAMESPACE_JOURNAL}/`));
const fileIdentity = stat => `${stat.dev}:${stat.ino}`;

export async function nodeEntry(io, key) {
  const path = await io.path(key, { allowMissing: true });
  if (!path) return undefined;
  const stat = await lstat(path, { bigint: true }).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (stat?.isSymbolicLink()) throw new GitError('Unsafe', 'Repository metadata is a symbolic link', { key });
  return stat && { path, stat, identity: fileIdentity(stat) };
}

export async function syncNodeDirectory(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32' || !['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'].includes(error.code)) throw error;
  } finally { await handle?.close(); }
}

export async function syncNodeParents(io, keys) {
  const directories = new Set([io.directory]);
  for (const key of keys) {
    const parts = key.split('/');
    for (let count = 1; count < parts.length; count++) {
      const entry = await nodeEntry(io, parts.slice(0, count).join('/'));
      if (entry?.stat.isDirectory()) directories.add(entry.path);
    }
  }
  for (const directory of [...directories].sort((left, right) => right.length - left.length)) await syncNodeDirectory(directory);
}

export async function writeNamespaceFile(io, key, bytes, mode = 0o600) {
  checkLimit(bytes.length, io.maxValueBytes, 'Namespace journal file');
  const path = await io.path(key, { create: true });
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    return fileIdentity(await handle.stat({ bigint: true }));
  } finally { await handle.close(); }
}

export async function writeNamespaceManifest(io, manifest) {
  const bytes = encodeStorageText(JSON.stringify(manifest));
  checkLimit(bytes.length, 64 * 1024 * 1024, 'Namespace journal manifest');
  const temporary = `${namespaceManifest}.next`;
  await writeNamespaceFile(io, temporary, bytes);
  await rename(await io.path(temporary), await io.path(namespaceManifest));
  await syncNodeParents(io, [namespaceManifest]);
}

export async function createNamespaceDirectory(io) {
  const path = await io.path(NODE_NAMESPACE_JOURNAL);
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new GitError('Conflict', 'A namespace transaction needs recovery');
    throw error;
  }
}

export async function removeNamespaceDirectory(io) {
  const entry = await nodeEntry(io, NODE_NAMESPACE_JOURNAL);
  if (!entry) return;
  if (!entry.stat.isDirectory()) throw new GitError('Corrupt', 'Namespace journal is not a directory');
  await rm(entry.path, { recursive: true });
  await syncNodeDirectory(io.directory);
}

const ownsLock = (entry, record) => entry?.stat.isFile() && [record.lock, record.guard].includes(entry.identity);

export async function acquireNamespaceLock(io, record, { recovery = false } = {}) {
  const key = `${record.key}.lock`;
  const path = await io.path(key, { create: true, allowMissing: true });
  if (!path) return false;
  const entry = await nodeEntry(io, key);
  if (entry) {
    if (ownsLock(entry, record)) return true;
    throw new GitError('Conflict', 'Git lock already exists; another writer may be active', { key });
  }
  const sourceKey = namespaceFile(record.index, recovery ? 'guard' : 'lock');
  const source = await nodeEntry(io, sourceKey);
  if (!source?.stat.isFile() || source.identity !== record[recovery ? 'guard' : 'lock']) {
    throw new GitError('Corrupt', 'Namespace journal lock ownership does not match its staged file');
  }
  try { await link(source.path, path); }
  catch (error) {
    if (error.code === 'EEXIST') throw new GitError('Conflict', 'Git lock already exists; another writer may be active', { key });
    throw error;
  }
  return true;
}

export async function releaseNamespaceLocks(io, records, { prefix = '', strict = false } = {}) {
  for (const record of records) {
    if (!record.key.startsWith(prefix)) continue;
    const key = `${record.key}.lock`;
    const entry = await nodeEntry(io, key);
    if (!entry) continue;
    if (ownsLock(entry, record)) await unlink(entry.path);
    else if (strict) throw new GitError('Conflict', 'Another writer owns a namespace transaction lock', { key });
  }
}

export async function removeEmptyNamespace(io, key, depth = 0) {
  validateStorageKey(key);
  checkLimit(depth, 128, 'Namespace directory depth');
  const entry = await nodeEntry(io, key);
  if (!entry?.stat.isDirectory()) return;
  const children = await readdir(entry.path, { withFileTypes: true });
  checkLimit(children.length, 100000, 'Namespace directory entries');
  for (const child of children) {
    if (!child.isDirectory() || child.isSymbolicLink()) {
      throw new GitError('Conflict', 'A repository directory still contains another file or lock', { key });
    }
    await removeEmptyNamespace(io, `${key}/${child.name}`, depth + 1);
  }
  await rmdir(entry.path);
  await syncNodeDirectory(dirname(entry.path));
}

export async function restoreNamespaceFile(io, record, bytes) {
  if (!await acquireNamespaceLock(io, record, { recovery: true })) {
    throw new GitError('Conflict', 'A repository file obstructs namespace recovery', { key: record.key });
  }
  const current = await io.get(record.key);
  const after = record.after ? await io.get(namespaceFile(record.index, 'after')) : undefined;
  if (current !== undefined && !sameBytes(current, bytes) && !sameBytes(current, after)) {
    throw new GitError('Conflict', 'Repository changed before namespace restoration', { key: record.key });
  }
  const path = await io.path(`${record.key}.lock`);
  const handle = await open(path, constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0));
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  await io.publish(record.key);
}
