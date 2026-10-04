import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { sameBytes } from '../storage/store-contract.js';
import { NODE_NAMESPACE_JOURNAL, namespaceFile, isNodeJournalKey, nodeEntry,
  writeNamespaceFile, writeNamespaceManifest, createNamespaceDirectory, removeNamespaceDirectory,
  acquireNamespaceLock, releaseNamespaceLocks, removeEmptyNamespace, syncNodeParents } from './node-namespace-io.js';
import { rollbackNodeNamespace } from './node-namespace-recovery.js';

/** Detect file/directory conversions from the complete, bounded transaction write set. */
export function hasNodeNamespaceChanges(changes) {
  for (const [key, value] of changes) {
    const parts = key.split('/');
    for (let count = 1; count < parts.length; count++) {
      const ancestor = parts.slice(0, count).join('/');
      if (changes.has(ancestor) && (changes.get(ancestor) === undefined) !== (value === undefined)) return true;
    }
  }
  return false;
}

async function stageNamespace(io, overlay, options) {
  const keys = [...new Set([...overlay.reads.keys(), ...overlay.changes.keys()])].sort();
  checkLimit(keys.length, 100000, 'Namespace transaction records');
  const manifest = { version: 1, state: 'prepare', records: [] };
  let total = 0;
  for (const [index, key] of keys.entries()) {
    checkCancelled(options.signal);
    if (key.endsWith('.lock')) throw new GitError('Unsafe', 'Namespace transactions cannot replace Git locks', { key });
    const changed = overlay.changes.has(key);
    const after = overlay.changes.get(key);
    const record = { index, key, changed, before: false, after: changed && after !== undefined };
    const staged = record.after ? after : new Uint8Array();
    total += staged.length * 2;
    checkLimit(total, options.maxTransactionBytes ?? 1024 * 1024 * 1024, 'Namespace journal bytes');
    record.lock = await writeNamespaceFile(io, namespaceFile(index, 'lock'), staged, 0o666);
    record.guard = await writeNamespaceFile(io, namespaceFile(index, 'guard'), new Uint8Array(), 0o666);
    if (record.after) await writeNamespaceFile(io, namespaceFile(index, 'after'), after);
    manifest.records.push(record);
  }
  return { manifest, total };
}

async function prepareNamespace(io, overlay, manifest, total, options) {
  const ownedLocks = new Set(manifest.records.map(record => `${record.key}.lock`));
  for (const record of manifest.records) await acquireNamespaceLock(io, record);
  for (const [key, expected] of overlay.reads) {
    if (!sameBytes(await io.get(key, options), expected)) throw new GitError('Conflict', 'Repository changed during transaction', { key });
  }
  for (const [prefix, expected] of overlay.lists) {
    const actual = (await io.list(prefix, options)).filter(key => key !== '.sharpforge-transaction.lock'
      && !isNodeJournalKey(key) && !ownedLocks.has(key));
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new GitError('Conflict', 'Repository paths changed during transaction', { prefix });
    }
  }
  for (const record of manifest.records) {
    if (!record.changed) continue;
    const before = await io.get(record.key, options);
    if (before !== undefined) {
      total += before.length;
      checkLimit(total, options.maxTransactionBytes ?? 1024 * 1024 * 1024, 'Namespace journal bytes');
      record.before = true;
      await writeNamespaceFile(io, namespaceFile(record.index, 'before'), before);
    }
    if (!record.after) continue;
    if ((await nodeEntry(io, record.key))?.stat.isDirectory()) {
      for (const child of await io.list(`${record.key}/`, options)) {
        if (ownedLocks.has(child)) continue;
        if (!overlay.changes.has(child) || overlay.changes.get(child) !== undefined) {
          throw new GitError('Conflict', 'A repository directory contains a file outside the transaction', { key: child });
        }
      }
    }
  }
  checkCancelled(options.signal);
  manifest.state = 'revert';
  await writeNamespaceManifest(io, manifest);
}

async function publishNamespace(io, manifest) {
  const changes = manifest.records.filter(record => record.changed);
  for (const record of [...changes].sort((left, right) => right.key.length - left.key.length)) {
    if (!record.after) await io.delete(record.key);
  }
  for (const record of changes.sort((left, right) => left.key.length - right.key.length)) {
    if (!record.after) continue;
    await releaseNamespaceLocks(io, manifest.records, { prefix: `${record.key}/`, strict: true });
    await removeEmptyNamespace(io, record.key);
    if (!await acquireNamespaceLock(io, record)) {
      throw new GitError('Conflict', 'A repository file obstructs the new namespace', { key: record.key });
    }
    const before = record.before ? await io.get(namespaceFile(record.index, 'before')) : undefined;
    if (!sameBytes(await io.get(record.key), before)) {
      throw new GitError('Conflict', 'Repository changed before namespace publication', { key: record.key });
    }
    await io.publish(record.key);
  }
  await syncNodeParents(io, changes.map(record => record.key));
}

/** Publish prefix-changing refs and their companion metadata with durable rollback originals. */
export async function commitNodeNamespace(io, overlay, options = {}) {
  const maximum = Math.min(options.maxTransactionBytes ?? 1024 * 1024 * 1024, 1024 * 1024 * 1024);
  checkLimit(maximum, 1024 * 1024 * 1024, 'Maximum namespace journal bytes');
  options = { ...options, maxTransactionBytes: maximum };
  await createNamespaceDirectory(io);
  let manifest;
  let prepared = false;
  try {
    const staged = await stageNamespace(io, overlay, options);
    manifest = staged.manifest;
    await writeNamespaceManifest(io, manifest);
    await prepareNamespace(io, overlay, manifest, staged.total, options);
    prepared = true;
    checkCancelled(options.signal);
    await publishNamespace(io, manifest);
  } catch (error) {
    if (prepared) {
      try { await rollbackNodeNamespace(io, manifest); }
      catch (rollback) {
        throw new GitError('Conflict', 'Namespace transaction needs recovery before further access', { reason: rollback.message });
      }
    }
    if (manifest) await releaseNamespaceLocks(io, manifest.records);
    await removeNamespaceDirectory(io);
    throw error;
  }
  manifest.state = 'commit';
  try { await writeNamespaceManifest(io, manifest); }
  catch (error) {
    throw new GitError('Conflict', 'Namespace commit outcome requires recovery before further access', { reason: error.message });
  }
  await releaseNamespaceLocks(io, manifest.records);
  await removeNamespaceDirectory(io);
}

export { NODE_NAMESPACE_JOURNAL, isNodeJournalKey };
export { recoverNodeNamespace } from './node-namespace-recovery.js';
