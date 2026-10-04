import {decodeWorkspaceFile} from '@sharpforge/archive';
import {hashWorkspaceBytes, workspaceRecordBytes, throwIfWorkspaceAborted} from './content-hash.js';
import {cloneWorkspaceState, hashWorkspaceRecord, withinWorkspacePath, workspaceStateSize} from './transaction-state.js';
import {cloneWorkspaceRecordSnapshot, workspaceRecordSource} from './transaction-records.js';

const parentPath = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

function directories(state) {
  const result = new Set(state.folders);
  for (const record of state.records) {
    let parent = parentPath(record.path);
    while (parent) { result.add(parent); parent = parentPath(parent); }
  }
  return result;
}

/** Provider transaction adapter: one workspace lock, complete admission, exact physical completion, and deferred model baselines. */
export class ProviderTransactionAdapter {
  constructor({getWorkspace, ready = async () => {}, maxBytes = 128 * 1024 * 1024}) {
    Object.assign(this, {getWorkspace, ready, maxBytes});
    this.workspace = null;
  }

  async run(action, {signal} = {}) {
    await this.ready();
    const candidate = this.getWorkspace();
    this.workspace = candidate?.rootHandle || candidate?.handles?.size ? candidate : null;
    if (!this.workspace) return action();
    this.physicalRecords = this.workspace.records.map(record => cloneWorkspaceRecordSnapshot(record));
    const locks = this.workspace.saveLocks;
    if (!locks) throw new Error('SFW1116: Directory transactions require physical workspace identity and Web Locks');
    return locks.run('*', async options => {
      this.workspace.activeTransaction = true;
      try { return await action(options); }
      finally { this.workspace.activeTransaction = false; }
    }, {signal, workspace: true});
  }

  async snapshot(state, operations, options) {
    if (!this.workspace) return state;
    const result = cloneWorkspaceState(state);
    let loadedBytes = workspaceStateSize(result);
    for (let index = 0; index < result.records.length; index++) {
      const record = result.records[index];
      if (!record.lazy || workspaceRecordSource(record) || typeof record.text === 'string' || record.bytes ||
          !operations.some(operation => withinWorkspacePath(record.path, operation.path))) continue;
      const metadata = await this.workspace.provider.stat(record.path, options);
      const expectedTime = record.lastModified ?? record.mtime;
      if (metadata.size !== record.size || expectedTime && metadata.mtime !== expectedTime) {
        throw new Error('SFW1113: Unloaded file changed before the operation: ' + record.path);
      }
      const bytes = await this.workspace.provider.readFile(record.path, options);
      result.records[index] = {...record, ...decodeWorkspaceFile(record.path, bytes), lazy: false};
      loadedBytes += bytes.length + (result.records[index].text?.length ?? 0) * 2;
      if (loadedBytes > this.maxBytes) throw new Error('SFW1102: File operation exceeds the workspace byte budget');
    }
    return result;
  }

  async stat(path, options) {
    try { return await this.workspace.provider.stat(path, options); }
    catch (error) { if (error.code !== 'NotFound') throw error; return null; }
  }

  async expectedHash(record, options) {
    if (!record) return null;
    if (this.workspace.baselineHashes.has(record.path)) return this.workspace.baselineHashes.get(record.path);
    const baseline = this.workspace.record(record.path);
    const text = this.workspace.baseline.get(record.path);
    return hashWorkspaceRecord(text === undefined ? record : {path: record.path, text,
      encoding: baseline?.encoding, bom: baseline?.bom, originalText: baseline?.originalText, bytes: baseline?.bytes}, options);
  }

  async preflight(operations, {before, after, signal}) {
    this.pending = [];
    this.applied = false;
    if (!this.workspace) return;
    const provider = this.workspace.provider;
    const options = {signal, requestPermission: true, write: true};
    if (provider.permission) await provider.permission(provider.rootHandle, '', options);
    const previous = new Map(before.records.map(record => [record.path, record]));
    const next = new Map(after.records.map(record => [record.path, record]));
    const oldDirectories = directories(before);
    const newDirectories = directories(after);
    for (const path of [...newDirectories].filter(path => !oldDirectories.has(path)).sort()) {
      if (await this.stat(path, options)) throw new Error('SFW1103: Destination directory already exists: ' + path);
      this.pending.push({kind: 'mkdir', path});
    }
    for (const [path, record] of next) {
      const old = previous.get(path);
      if (old && await hashWorkspaceRecord(old, {signal}) === await hashWorkspaceRecord(record, {signal})) continue;
      const expectedHash = await this.expectedHash(old, {signal});
      const bytes = workspaceRecordBytes(record, {maxBytes: provider.maxFileBytes ?? this.maxBytes}).slice();
      if (provider.prepareWrite) await provider.prepareWrite(path, {...options, expectedHash});
      else await this.verifyFile(path, expectedHash, options);
      const version = Math.max(record.version ?? 0, this.workspace.record(path)?.version ?? 0) + 1;
      if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Disk document version space exhausted');
      this.pending.push({kind: 'write', path, bytes, expectedHash, version, hash: await hashWorkspaceBytes(bytes, {signal})});
    }
    for (const [path, record] of previous) {
      if (next.has(path)) continue;
      const expectedHash = await this.expectedHash(record, {signal});
      await this.verifyFile(path, expectedHash, options);
      if (provider.fileHandle) await provider.fileHandle(path, options);
      this.pending.push({kind: 'delete', path, expectedHash});
    }
    const removedDirectories = [...oldDirectories].filter(path => !newDirectories.has(path));
    const known = new Set([...previous.keys(), ...oldDirectories]);
    for (const path of removedDirectories.sort((left, right) => right.length - left.length)) {
      for (const child of await provider.readDirectory(path, options)) {
        if (!known.has(child.path)) throw new Error('SFW1117: Directory contains an untracked entry: ' + child.path);
      }
      if (provider.directory) await provider.directory(path, options);
      this.pending.push({kind: 'rmdir', path});
    }
    // Permission prompts and directory scans are asynchronous; recheck every baseline before admitting the first effect.
    for (const operation of this.pending) {
      if (operation.expectedHash !== undefined) await this.verifyFile(operation.path, operation.expectedHash, options);
    }
    const persisted = new Set(this.pending.filter(operation => operation.kind === 'write').map(operation => operation.path));
    if (after.dirty) after.dirty = after.dirty.filter(path => !persisted.has(path));
  }

  async verifyFile(path, expectedHash, options) {
    const metadata = await this.stat(path, options);
    if (metadata?.type === 'directory') throw new Error('SFW1103: A directory occupies the file destination: ' + path);
    const actualHash = metadata ? await hashWorkspaceBytes(await this.workspace.provider.readFile(path, options), options) : null;
    if (actualHash !== expectedHash) throw new Error('SFW1113: Disk bytes changed before transaction: ' + path);
  }

  async apply(operation, {signal, onCompleted}) {
    if (!this.workspace || this.applied) return {skipped: true};
    this.applied = true;
    const provider = this.workspace.provider;
    const completedMutations = [];
    const options = {signal, requestPermission: true};
    try {
      for (const item of this.pending) {
        throwIfWorkspaceAborted(signal);
        if (item.kind === 'mkdir') await provider.createDirectory(item.path, options);
        else if (item.kind === 'write') {
          await provider.writeFile(item.path, item.bytes, {...options, expectedHash: item.expectedHash});
          this.workspace.didSave?.({path: item.path, hash: item.hash});
        }
        else await provider.delete(item.path, {...options, expectedHash: item.expectedHash, recursive: false});
        const completed = {kind: item.kind, path: item.path, beforeHash: item.expectedHash ?? null, afterHash: item.hash ?? null};
        if (onCompleted) await onCompleted(completed);
        else completedMutations.push(completed);
      }
      return {completedMutations, reported: !!onCompleted};
    } catch (error) {
      error.completedMutations = [...completedMutations, ...(error.completedMutations ?? [])];
      throw error;
    }
  }

  async finalize(receipt) {
    if (!this.workspace) return;
    const workspace = this.workspace;
    const records = new Map(this.physicalRecords.map(record => [record.path, record]));
    for (const item of this.pending) {
      if (item.kind === 'write') {
        records.set(item.path, {...decodeWorkspaceFile(item.path, item.bytes), size: item.bytes.length, lazy: false, version: item.version});
      } else if (item.kind === 'delete') {
        records.delete(item.path);
      }
    }
    workspace.adoptRecords([...records.values()], {folders: receipt.after.folders});
    for (const item of this.pending) if (item.kind === 'write') {
      workspace.baselineHashes.set(item.path, item.hash);
      if (workspace.provider.fileHandle) workspace.handles.set(item.path, await workspace.provider.fileHandle(item.path));
    }
  }
}
