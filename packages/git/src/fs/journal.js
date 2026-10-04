import { GitError, checkLimit } from '../errors.js';
import { encodeStorageText, decodeStorageText, validateStorageKey } from '../storage/store-contract.js';

export const JOURNAL_DIRECTORY = '.sharpforge-transaction';
const manifestPath = `${JOURNAL_DIRECTORY}/manifest`;

function journalKey(key) {
  validateStorageKey(key);
  if (key === JOURNAL_DIRECTORY || key.startsWith(`${JOURNAL_DIRECTORY}/`)) {
    throw new GitError('Unsafe', 'Transaction cannot overwrite its journal');
  }
  return key;
}

function validateManifest(manifest) {
  if (manifest?.version !== 1 || !['commit', 'revert', 'apply', 'rollback'].includes(manifest.state)
    || !Array.isArray(manifest.changes)) throw new GitError('Corrupt', 'Unsupported repository transaction journal');
  checkLimit(manifest.changes.length, 100000, 'Repository journal size');
  const keys = new Set();
  for (const record of manifest.changes) {
    if (!record || typeof record !== 'object') throw new GitError('Corrupt', 'Invalid repository journal entry');
    journalKey(record.key);
    if (keys.has(record.key)) throw new GitError('Corrupt', 'Duplicate repository journal path');
    keys.add(record.key);
    for (const side of ['before', 'after']) {
      if (record[side] !== null) checkLimit(record[side], manifest.changes.length * 2, 'Journal record index');
    }
  }
}

async function applyJournal(io, manifest, side) {
  if (side === 'before') {
    // Reclaim newly created files before restoring prior values under a full quota.
    for (const record of manifest.changes) {
      if (record.before === null) await io.delete(validateStorageKey(record.key));
    }
  }
  for (const record of manifest.changes) {
    if (record[side] === null) await io.delete(record.key);
    else {
      if (!Number.isSafeInteger(record[side]) || record[side] < 0) throw new GitError('Corrupt', 'Invalid journal record');
      const bytes = await io.get(`${JOURNAL_DIRECTORY}/${record[side]}`);
      if (!bytes) throw new GitError('Corrupt', 'Repository transaction journal is incomplete');
      await io.set(record.key, bytes);
    }
  }
}

/** Recover a transaction interrupted after its durable commit decision. */
export async function recoverDirectoryJournal(io) {
  const bytes = await io.get(manifestPath);
  if (bytes !== undefined) {
    let manifest;
    try { manifest = JSON.parse(decodeStorageText(bytes)); } catch { throw new GitError('Corrupt', 'Invalid repository transaction journal'); }
    validateManifest(manifest);
    await applyJournal(io, manifest, ['revert', 'rollback'].includes(manifest.state) ? 'before' : 'after');
  }
  await io.delete(JOURNAL_DIRECTORY, { recursive: true });
}

/** Stage both versions before publishing, so failed writes can restore every prior file. */
export async function commitDirectoryJournal(io, changes, { signal } = {}) {
  if (!changes.size) return;
  checkLimit(changes.size, 100000, 'Repository journal size');
  for (const key of changes.keys()) journalKey(key);
  const manifest = { version: 1, state: 'commit', changes: [] };
  let sequence = 0;
  try {
    for (const [key, bytes] of changes) {
      const previous = await io.get(key, { signal });
      const record = { key, before: null, after: null };
      if (previous !== undefined) {
        record.before = sequence++;
        await io.set(`${JOURNAL_DIRECTORY}/${record.before}`, previous, { signal });
      }
      if (bytes !== undefined) {
        record.after = sequence++;
        await io.set(`${JOURNAL_DIRECTORY}/${record.after}`, bytes, { signal });
      }
      manifest.changes.push(record);
    }
    await io.set(manifestPath, encodeStorageText(JSON.stringify(manifest)), { signal });
  } catch (error) {
    await io.delete(JOURNAL_DIRECTORY, { recursive: true });
    throw error;
  }
  try {
    await applyJournal(io, manifest, 'after');
  } catch (error) {
    // Equal-width decisions can be rewritten without requiring extra quota bytes.
    manifest.state = 'revert';
    await io.set(manifestPath, encodeStorageText(JSON.stringify(manifest)));
    await applyJournal(io, manifest, 'before');
    await io.delete(JOURNAL_DIRECTORY, { recursive: true });
    throw error;
  }
  await io.delete(JOURNAL_DIRECTORY, { recursive: true });
}
