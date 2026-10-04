import {FileSystemError, hashFileBytes} from '@sharpforge/workspace';
import {checkDiskCancelled} from './disk-scan.js';
import {diskRecordBytes} from './disk-baseline.js';

function affected(path, root) { return path === root || path.startsWith(root + '/'); }

async function permissionPreflight(provider, operation, options) {
  if (typeof provider.permission !== 'function') return;
  await provider.permission(provider.rootHandle, operation.path, {...options, write: true});
  if (operation.kind !== 'mkdir') {
    const handle = operation.metadata.type === 'directory' ? await provider.directory(operation.path, options)
      : await provider.fileHandle(operation.path, options);
    await provider.permission(handle, operation.path, {...options, write: true});
  }
  const destination = operation.destination ?? operation.path;
  const slash = destination.lastIndexOf('/');
  const parent = await provider.directory(slash < 0 ? '' : destination.slice(0, slash), options);
  await provider.permission(parent, destination, {...options, write: true});
}

/** Permission and collision preflight for each target precedes all directory-handle mutations. */
export async function applyDiskOperations(workspace, operations, options = {}) {
  options = {requestPermission: true, ...options};
  if (!Array.isArray(operations) || !operations.length || operations.length > 256) throw new RangeError('Use 1–256 filesystem operations');
  const provider = workspace.provider;
  const pending = [];
  const touched = new Set();
  for (const input of operations) {
    checkDiskCancelled(options.signal);
    if (!['mkdir', 'move', 'rename', 'delete'].includes(input.kind)) throw new TypeError('Unsupported disk operation: ' + input.kind);
    const path = workspace.canonicalPath(provider.check(input.path, {...options, write: true, allowRoot: false}));
    const destination = input.destination
      ? workspace.canonicalPath(provider.check(input.destination, {...options, write: true, allowRoot: false})) : null;
    const identity = provider.pathPolicy.identity(path);
    if (touched.has(identity)) throw new FileSystemError('Conflict', path, 'Overlapping disk operations require separate batches');
    touched.add(identity);
    const metadata = input.kind === 'mkdir' ? null : await provider.stat(path, options);
    const expectedHash = metadata?.type === 'file' ? await hashFileBytes(await provider.readFile(path, options), options) : undefined;
    if (input.expectedHash !== undefined && input.expectedHash !== expectedHash) throw new FileSystemError('Conflict', path);
    const operation = {...input, path, destination, metadata, expectedHash};
    await permissionPreflight(provider, operation, options);
    if (destination || input.kind === 'mkdir') {
      const target = destination ?? path;
      try { await provider.stat(target, options); throw new FileSystemError('AlreadyExists', target); }
      catch (error) { if (error.code !== 'NotFound') throw error; }
    }
    pending.push(operation);
  }
  for (let index = 0; index < pending.length; index++) {
    const paths = [pending[index].path, pending[index].destination].filter(Boolean);
    for (const later of pending.slice(index + 1)) {
      if ([later.path, later.destination].filter(Boolean).some(path => paths.some(other =>
        provider.pathPolicy.contains(path, other) || provider.pathPolicy.contains(other, path)))) {
        throw new FileSystemError('Conflict', later.path, 'Overlapping disk operations require separate batches');
      }
    }
  }
  const completed = [];
  try {
    for (const operation of pending) {
      checkDiskCancelled(options.signal);
      if (operation.kind === 'mkdir') {
        await provider.createDirectory(operation.path, options);
        workspace.folders.push(operation.path);
        workspace.folderIndex.set(provider.pathPolicy.identity(operation.path), operation.path);
      } else if (operation.kind === 'delete') {
        await provider.delete(operation.path, {...options, recursive: !!operation.recursive, expectedHash: operation.expectedHash});
        removeRecords(workspace, operation.path);
      } else {
        await provider.rename(operation.path, operation.destination, {...options, expectedHash: operation.expectedHash});
        moveRecords(workspace, operation.path, operation.destination);
      }
      completed.push(operation);
    }
  } catch (error) { error.completed = completed; error.atomic = false; throw error; }
  return {completed, atomic: false};
}

function removeRecords(workspace, path) {
  for (const record of workspace.records) if (affected(record.path, path)) workspace.loadedBytes -= diskRecordBytes(record);
  workspace.records = workspace.records.filter(record => !affected(record.path, path));
  workspace.folders = workspace.folders.filter(folder => !affected(folder, path));
  for (const map of [workspace.handles, workspace.baselineHashes]) {
    for (const key of map.keys()) if (affected(key, path)) map.delete(key);
  }
  workspace.index = new Map(workspace.records.map(record => [workspace.provider.pathPolicy.identity(record.path), record]));
  workspace.positions = new Map(workspace.records.map((record, index) => [workspace.provider.pathPolicy.identity(record.path), index]));
  workspace.folderIndex = new Map(workspace.folders.map(folder => [workspace.provider.pathPolicy.identity(folder), folder]));
}

function moveRecords(workspace, path, destination) {
  workspace.records = workspace.records.map(record => affected(record.path, path)
    ? {...record, path: destination + record.path.slice(path.length)} : record);
  workspace.folders = workspace.folders.map(folder => affected(folder, path) ? destination + folder.slice(path.length) : folder);
  for (const map of [workspace.handles, workspace.baselineHashes]) {
    for (const [key, value] of [...map]) if (affected(key, path)) { map.delete(key); map.set(destination + key.slice(path.length), value); }
  }
  workspace.index = new Map(workspace.records.map(record => [workspace.provider.pathPolicy.identity(record.path), record]));
  workspace.positions = new Map(workspace.records.map((record, index) => [workspace.provider.pathPolicy.identity(record.path), index]));
  workspace.folderIndex = new Map(workspace.folders.map(folder => [workspace.provider.pathPolicy.identity(folder), folder]));
}
