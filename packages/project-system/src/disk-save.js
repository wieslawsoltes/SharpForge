import {encodeWorkspaceFile, decodeWorkspaceFile} from '@sharpforge/archive';
import {FileSystemError, hashFileBytes} from '@sharpforge/workspace';
import {diskRecordBytes} from './disk-baseline.js';
import {checkDiskCancelled} from './disk-scan.js';

async function baselineHash(workspace, record, options) {
  if (workspace.baselineHashes.has(record?.path)) return workspace.baselineHashes.get(record.path);
  if (!record) return null;
  if (record.lazy) throw new FileSystemError('Conflict', record.path, 'Load the file before replacing its bytes');
  const hash = await hashFileBytes(encodeWorkspaceFile(record), options);
  workspace.baselineHashes.set(record.path, hash);
  return hash;
}

async function readHash(provider, path, options) {
  try { return await hashFileBytes(await provider.readFile(path, options), options); }
  catch (error) { if (error.code !== 'NotFound') throw error; return null; }
}

function nextVersion(record) {
  const version = (record?.version ?? 0) + 1;
  if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Disk document version space exhausted');
  return version;
}

async function preflight(workspace, pending, options) {
  const provider = workspace.provider;
  for (const file of pending) {
    checkDiskCancelled(options.signal);
    if (typeof provider.permission === 'function') await provider.permission(provider.rootHandle, file.path, {...options, write: true});
    if (typeof provider.prepareWrite === 'function') {
      try { await provider.prepareWrite(file.path, {...options, expectedHash: file.expectedHash}); }
      catch (error) {
        if (error.code === 'Conflict') throw new FileSystemError('Conflict', file.path, 'Disk conflict; no files were written');
        throw error;
      }
    } else if (await readHash(provider, file.path, options) !== file.expectedHash) {
      throw new FileSystemError('Conflict', file.path, 'Disk conflict; no files were written');
    }
  }
}

/** Prepare encoded bytes and every target before the first mutation; retain exact bytes as the next baseline. */
export async function saveDiskChanges(workspace, changes, options = {}) {
  if (!Array.isArray(changes) || changes.length > workspace.options.maxFiles) throw new TypeError('Expected a bounded list of file changes');
  if (workspace.requireSaveLock && !workspace.saveLocks && workspace.resolveSaveLocks) {
    workspace.saveLocks = await workspace.resolveSaveLocks(workspace, options);
  }
  if (workspace.requireSaveLock && !workspace.saveLocks) {
    throw new FileSystemError('Unavailable', '', 'Browser save requires directory identity and Web Locks; await workspace coordination');
  }
  options = {requestPermission: true, ...options};
  const pending = [];
  const seen = new Set();
  let loadedBytes = workspace.loadedBytes;
  for (const change of changes) {
    checkDiskCancelled(options.signal);
    const candidate = workspace.provider.check(change.path ?? change.uri, {...options, write: true, allowRoot: false});
    const record = workspace.record(candidate);
    const path = record?.path ?? workspace.canonicalPath(candidate);
    const identity = workspace.provider.pathPolicy.identity(path);
    if (seen.has(identity)) throw new FileSystemError('AlreadyExists', path, 'Duplicate save path');
    seen.add(identity);
    if (typeof change.text !== 'string' && !(change.bytes instanceof Uint8Array)) throw new TypeError('Save requires text or bytes');
    const next = {...record, ...change, path};
    const bytes = change.bytes instanceof Uint8Array && change.text === undefined ? change.bytes.slice() : encodeWorkspaceFile(next);
    if (bytes.length > workspace.options.maxFileBytes) throw new FileSystemError('FileTooLarge', path, 'Encoded save exceeds maxFileBytes');
    loadedBytes += bytes.length - diskRecordBytes(record);
    if (loadedBytes > workspace.options.maxTotalBytes) throw new FileSystemError('QuotaExceeded', path, 'Loaded workspace byte budget exceeded');
    const expectedHash = change.expectedHash === undefined ? await baselineHash(workspace, record, options) : change.expectedHash;
    pending.push({path, bytes, expectedHash, version: nextVersion(workspace.record(path))});
  }
  await preflight(workspace, pending, options);
  for (const file of pending) {
    if (await readHash(workspace.provider, file.path, options) !== file.expectedHash) {
      throw new FileSystemError('Conflict', file.path, 'Disk conflict after permission prompt; no files were written');
    }
  }
  const written = [];
  const hashes = [];
  const locks = workspace.saveLocks;
  for (const file of pending) {
    try {
      const write = ({signal = options.signal} = {}) =>
        workspace.provider.writeFile(file.path, file.bytes, {...options, signal, expectedHash: file.expectedHash});
      const result = locks ? await locks.guardedSave({path: file.path, expectedHash: file.expectedHash, signal: options.signal,
        read: async ({signal = options.signal} = {}) => { try { return await workspace.provider.readFile(file.path, {...options, signal}); }
          catch (error) { if (error.code === 'NotFound') return null; throw error; } }, write}) : await write();
      const hash = result.hash ?? await hashFileBytes(file.bytes, {});
      written.push(file.path);
      hashes.push({path: file.path, hash});
      workspace.baselineHashes.set(file.path, hash);
      const version = Math.max(file.version, nextVersion(workspace.record(file.path)));
      const record = {...decodeWorkspaceFile(file.path, file.bytes), size: file.bytes.length, lazy: false, version};
      workspace.replaceRecord(record);
      workspace.didSave({path: file.path, hash, record});
      if (typeof workspace.provider.fileHandle === 'function') {
        workspace.handles.set(file.path, await workspace.provider.fileHandle(file.path, {requestPermission: true}));
      }
    } catch (cause) {
      const failure = new Error(`Save failed for '${file.path}'. Written before failure: ${written.join(', ') || 'none'}. ${cause.message}`, {cause});
      failure.code = cause.code;
      failure.name = cause.name;
      failure.written = written;
      failure.hashes = hashes;
      throw failure;
    }
  }
  return {written, hashes, atomic: false};
}
