import { preflightDestination, DestinationError, existingDirectory } from './destination-preflight.js';
import { rollbackDestination } from './destination-rollback.js';
import { destinationMode, requireEmptyDestination, destinationWriteFailure } from './destination-mode.js';

const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
const leafName = path => path.slice(path.lastIndexOf('/') + 1);
const sameBytes = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);

async function lookupFile(parent, name) {
  try { return await parent.getFileHandle(name); }
  catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}

async function backupsFor(handle, checked, options) {
  const permitted = new Set(options.overwritePaths ?? []);
  const denied = checked.conflicts.filter(conflict => !conflict.overwritable || !permitted.has(conflict.path));
  if (denied.length) {
    const error = new DestinationError('SFDST005', 'Destination already exists or conflicts; confirm exact overwrite paths');
    error.conflicts = denied;
    throw error;
  }
  const backups = new Map();
  const records = new Map(checked.records.map(record => [record.path, record]));
  let total = 0;
  for (const conflict of checked.conflicts) {
    options.signal?.throwIfAborted();
    const parent = await existingDirectory(handle, parentPath(conflict.path));
    const fileHandle = await parent.getFileHandle(leafName(conflict.path));
    const file = await fileHandle.getFile();
    total += file.size;
    if (total > (options.maxBackupBytes ?? 128 * 1024 * 1024)) throw new DestinationError('SFDST004', 'Destination rollback budget exceeded');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = records.get(conflict.path);
    if (record.expectedText !== undefined && decodeWorkspaceFile(conflict.path, bytes).text !== record.expectedText) {
      throw new DestinationError('SFDST006', 'Destination changed since preview: ' + conflict.path);
    }
    const snapshot = checked.snapshots.get(conflict.path);
    if (snapshot.size !== file.size || snapshot.lastModified !== file.lastModified) {
      throw new DestinationError('SFDST006', 'Destination changed since preflight: ' + conflict.path);
    }
    backups.set(conflict.path, bytes);
  }
  return backups;
}

/** Save to an empty folder by default; mode:'merge' applies a confirmed plan with rollback. Neither mode is atomic. */
export async function writeNewDirectory(handle, plan, options = {}) {
  const mode = destinationMode(options);
  const checked = await preflightDestination(handle, plan, options);
  if (mode === 'empty') await requireEmptyDestination(handle, options.signal);
  const backups = await backupsFor(handle, checked, options);
  const cache = new Map([['', handle]]);
  const journal = [];
  const written = [];
  async function directory(path) {
    if (cache.has(path)) return cache.get(path);
    const parent = await directory(parentPath(path));
    const name = leafName(path);
    let result;
    try { result = await parent.getDirectoryHandle(name); }
    catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      result = await parent.getDirectoryHandle(name, { create: true });
      journal.push({ kind: 'directory', path, parent, name });
    }
    cache.set(path, result);
    return result;
  }
  try {
    for (const path of checked.directories) { options.signal?.throwIfAborted(); await directory(path); }
    for (const record of checked.records) {
      options.signal?.throwIfAborted();
      const parent = await directory(parentPath(record.path));
      const name = leafName(record.path);
      let target = await lookupFile(parent, name);
      if (target) {
        const previous = backups.get(record.path);
        if (!previous || !sameBytes(new Uint8Array(await (await target.getFile()).arrayBuffer()), previous)) {
          throw new DestinationError('SFDST006', 'Destination changed while saving: ' + record.path);
        }
        journal.push({ kind: 'overwrite', path: record.path, handle: target, bytes: previous });
      } else {
        if (backups.has(record.path)) throw new DestinationError('SFDST006', 'Destination disappeared while saving: ' + record.path);
        target = await parent.getFileHandle(name, { create: true });
        journal.push({ kind: 'file', path: record.path, parent, name });
      }
      const stream = await target.createWritable();
      try { await stream.write(record.bytes); options.signal?.throwIfAborted(); await stream.close(); }
      catch (error) { await stream.abort().catch(abortError => { error.abortError = abortError; }); throw error; }
      written.push(record.path);
      await options.onProgress?.({ written: written.length, total: checked.records.length, path: record.path });
    }
    options.signal?.throwIfAborted();
    return { written, atomic: false, rolledBack: false, destination: checked.destination };
  } catch (cause) {
    const rollback = mode === 'merge' ? await rollbackDestination(journal) :
      { rolledBack: false, leftovers: journal.map(item => ({ path: item.path, kind: item.kind })) };
    throw destinationWriteFailure(cause, written, rollback, mode);
  }
}
import { decodeWorkspaceFile } from '@sharpforge/archive';
