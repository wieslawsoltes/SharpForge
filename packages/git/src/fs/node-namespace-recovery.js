import { GitError, checkLimit } from '../errors.js';
import { decodeStorageText, sameBytes, validateStorageKey } from '../storage/store-contract.js';
import { NODE_NAMESPACE_JOURNAL, namespaceFile, namespaceManifest, isNodeJournalKey, nodeEntry,
  acquireNamespaceLock, releaseNamespaceLocks, removeEmptyNamespace, restoreNamespaceFile,
  syncNodeParents, removeNamespaceDirectory } from './node-namespace-io.js';

function validateNamespaceManifest(manifest) {
  if (manifest?.version !== 1 || !['prepare', 'revert', 'commit'].includes(manifest.state) || !Array.isArray(manifest.records)) {
    throw new GitError('Corrupt', 'Invalid namespace transaction journal');
  }
  checkLimit(manifest.records.length, 100000, 'Namespace journal records');
  const keys = new Set();
  for (const [index, record] of manifest.records.entries()) {
    if (!record || record.index !== index || typeof record.changed !== 'boolean'
      || typeof record.before !== 'boolean' || typeof record.after !== 'boolean') {
      throw new GitError('Corrupt', 'Invalid namespace transaction record');
    }
    validateStorageKey(record.key);
    if (keys.has(record.key) || isNodeJournalKey(record.key) || record.key === '.sharpforge-transaction.lock'
      || record.key.endsWith('.lock') || !/^\d+:\d+$/u.test(record.lock) || !/^\d+:\d+$/u.test(record.guard)) {
      throw new GitError('Corrupt', 'Invalid namespace transaction key or lock');
    }
    keys.add(record.key);
  }
  return manifest;
}

async function rollbackData(io, manifest) {
  const data = new Map();
  let total = 0;
  for (const record of manifest.records) {
    if (!record.changed) continue;
    const values = {};
    for (const side of ['before', 'after']) {
      if (!record[side]) continue;
      const bytes = await io.get(namespaceFile(record.index, side));
      if (bytes === undefined) throw new GitError('Corrupt', 'Namespace journal is missing recovery data');
      total += bytes.length;
      checkLimit(total, 1024 * 1024 * 1024, 'Namespace recovery bytes');
      values[side] = bytes;
    }
    data.set(record.key, values);
  }
  return data;
}

/** Restore the complete original namespace; conflicting external writes keep the journal intact. */
export async function rollbackNodeNamespace(io, manifest) {
  const data = await rollbackData(io, manifest);
  for (const record of manifest.records) await acquireNamespaceLock(io, record, { recovery: true });
  for (const record of manifest.records) {
    if (!record.changed) continue;
    const current = await io.get(record.key);
    const { before, after } = data.get(record.key);
    if (current !== undefined && !sameBytes(current, before) && !sameBytes(current, after)) {
      throw new GitError('Conflict', 'Repository changed after interrupted namespace publication', { key: record.key });
    }
  }
  const changed = manifest.records.filter(record => record.changed);
  for (const record of [...changed].sort((left, right) => right.key.length - left.key.length)) {
    if (!record.before) await io.delete(record.key);
  }
  for (const record of changed.sort((left, right) => left.key.length - right.key.length)) {
    if (!record.before) continue;
    const before = data.get(record.key).before;
    if (sameBytes(await io.get(record.key), before)) continue;
    await releaseNamespaceLocks(io, manifest.records, { prefix: `${record.key}/`, strict: true });
    await removeEmptyNamespace(io, record.key);
    await restoreNamespaceFile(io, record, before);
  }
  await syncNodeParents(io, changed.map(record => record.key));
  for (const record of changed) {
    if (!sameBytes(await io.get(record.key), data.get(record.key).before)) {
      throw new GitError('Conflict', 'Namespace recovery could not restore a repository path', { key: record.key });
    }
  }
}

/** Called only under the process lock; never remove or steal a stale process lock. */
export async function recoverNodeNamespace(io) {
  const directory = await nodeEntry(io, NODE_NAMESPACE_JOURNAL);
  if (!directory) return;
  if (!directory.stat.isDirectory()) throw new GitError('Corrupt', 'Namespace journal is not a directory');
  const bytes = await io.get(namespaceManifest);
  if (bytes === undefined) {
    // Native lock acquisition begins only after the prepare manifest is durable.
    await removeNamespaceDirectory(io);
    return;
  }
  checkLimit(bytes.length, 64 * 1024 * 1024, 'Namespace journal manifest');
  let manifest;
  try { manifest = JSON.parse(decodeStorageText(bytes)); }
  catch { throw new GitError('Corrupt', 'Invalid namespace transaction journal'); }
  validateNamespaceManifest(manifest);
  if (manifest.state === 'revert') await rollbackNodeNamespace(io, manifest);
  await releaseNamespaceLocks(io, manifest.records);
  await removeNamespaceDirectory(io);
}
