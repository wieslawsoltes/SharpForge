import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';
import {FileSystemAccessProvider, FileSystemError, hashFileBytes} from '@sharpforge/workspace';
import {createHandleMapRoot} from './disk-handle-map.js';
import {DISK_WORKSPACE_LIMITS, checkDiskCancelled} from './disk-scan.js';
import {saveDiskChanges} from './disk-save.js';
import {applyDiskOperations} from './disk-operations.js';
import {DiskTextBaselines, diskRecordBytes} from './disk-baseline.js';

/** Directory-backed records. Lazy entries carry explicit metadata and never stand in for empty source text. */
export class ProviderDiskWorkspace {
  constructor(records, handles = new Map(), name = 'Selected files', folders = [], skipped = [], options = {}) {
    this.records = records;
    this.handles = handles;
    this.name = name;
    this.folders = folders;
    this.skipped = skipped;
    this.options = {...DISK_WORKSPACE_LIMITS, ...options};
    this.rootHandle = options.rootHandle ?? null;
    this.provider = options.provider ?? new FileSystemAccessProvider(this.rootHandle ?? createHandleMapRoot(handles,
      new Set(records.filter(record => !record.bytes && typeof record.text === 'string').map(record => record.path))),
    {maxFileBytes: Math.max(this.options.maxFileBytes, this.options.maxAssemblyBytes), caseSensitive: options.caseSensitive ?? false});
    this.baseline = new DiskTextBaselines(this);
    this.baselineHashes = new Map();
    this.index = new Map(records.map(record => [this.provider.pathPolicy.identity(record.path), record]));
    this.positions = new Map(records.map((record, index) => [this.provider.pathPolicy.identity(record.path), index]));
    this.folderIndex = new Map(folders.map(path => [this.provider.pathPolicy.identity(path), path]));
    this.importReport = options.report ?? null;
    this.saveLocks = options.saveLocks ?? null;
    this.resolveSaveLocks = options.resolveSaveLocks ?? null;
    this.saveListeners = new Set();
    this.requireSaveLock = options.requireSaveLock ?? typeof globalThis.window !== 'undefined';
    this.loadedBytes = records.reduce((total, record) => total + diskRecordBytes(record), 0);
    this.queue = Promise.resolve();
  }

  record(path) { return this.index.get(this.provider.pathPolicy.identity(path)); }

  canonicalPath(path) {
    const existing = this.record(path)?.path ?? this.folderIndex.get(this.provider.pathPolicy.identity(path));
    if (existing) return existing;
    for (let slash = path.lastIndexOf('/'); slash >= 0; slash = path.lastIndexOf('/', slash - 1)) {
      const parent = this.folderIndex.get(this.provider.pathPolicy.identity(path.slice(0, slash)));
      if (parent) return parent + path.slice(slash);
    }
    return path;
  }

  async initializeBaselines({signal} = {}) {
    for (const record of this.records) {
      checkDiskCancelled(signal);
      if (record.lazy) continue;
      this.baselineHashes.set(record.path, await hashFileBytes(encodeWorkspaceFile(record), {signal}));
    }
  }

  /** Materialize one entry. A synchronous beforeAdmit guard can reject after I/O, before bytes/hash/handle publication. */
  async load(path, options = {}) {
    const provider = this.provider;
    path = provider.check(path, {...options, allowRoot: false});
    const existing = this.record(path);
    if (existing && !existing.lazy && !options.reload) return existing;
    path = existing?.path ?? this.canonicalPath(path);
    const index = this.index;
    const baseline = this.baselineHashes.get(path);
    const previousHandle = this.handles.get(path);
    const assertCurrent = () => {
      provider.check(path, options);
      if (this.provider !== provider || this.record(path) !== existing || existing && existing.path !== path
        || !existing && this.index !== index || this.baselineHashes.get(path) !== baseline
        || this.handles.get(path) !== previousHandle) {
        throw new FileSystemError('Conflict', path, 'Disk entry changed while its contents were loading');
      }
    };
    const bytes = await provider.readFile(path, options);
    assertCurrent();
    const maximum = /\.(?:dll|exe|pdb)$/i.test(path) ? this.options.maxAssemblyBytes : this.options.maxFileBytes;
    if (bytes.length > maximum) throw new FileSystemError('FileTooLarge', path);
    const version = (existing?.version ?? 0) + 1;
    if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Disk document version space exhausted');
    const record = {...decodeWorkspaceFile(path, bytes), size: bytes.length, lazy: false, version};
    const hash = await hashFileBytes(bytes, options);
    assertCurrent();
    const hasHandle = typeof provider.fileHandle === 'function';
    const handle = hasHandle ? await provider.fileHandle(path, options) : undefined;
    assertCurrent();
    const nextBytes = this.loadedBytes - diskRecordBytes(existing) + bytes.length;
    if (nextBytes > this.options.maxTotalBytes) throw new FileSystemError('QuotaExceeded', path, 'Loaded workspace byte budget exceeded');
    const admission = options.beforeAdmit?.(record);
    if (admission && typeof admission.then === 'function') {
      // The invalid asynchronous callback is reported here; do not let its later rejection escape this error boundary.
      Promise.resolve(admission).catch(() => {});
      throw new TypeError('Disk document admission guards must be synchronous');
    }
    assertCurrent();
    this.replaceRecord(record);
    this.baselineHashes.set(record.path, hash);
    if (hasHandle) this.handles.set(record.path, handle);
    return record;
  }

  unload(path) {
    const record = this.record(path);
    if (!record || record.lazy) return false;
    const lazy = {path: record.path, size: record.size ?? diskRecordBytes(record), lazy: true};
    if (record.version !== undefined) lazy.version = record.version;
    if (record.lastModified !== undefined) lazy.lastModified = record.lastModified;
    this.replaceRecord(lazy);
    return true;
  }

  async hydrate(paths = this.records.map(record => record.path), options = {}) {
    const loaded = [];
    for (const path of paths) {
      loaded.push(await this.load(path, options));
      if (loaded.length % 64 === 0) {
        options.onProgress?.({loaded: loaded.length, total: paths.length});
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    return loaded;
  }

  replaceRecord(record) {
    const key = this.provider.pathPolicy.identity(record.path);
    const old = this.index.get(key);
    this.loadedBytes += diskRecordBytes(record) - diskRecordBytes(old);
    if (old) this.records[this.positions.get(key)] = record;
    else { this.positions.set(key, this.records.length); this.records.push(record); }
    this.index.set(key, record);
  }

  /** Adopt a complete validated disk snapshot. Existing hashes survive only for paths that remain; editor overlays belong to the host. */
  adoptRecords(records, {folders = this.folders, report = this.importReport, preserveBaselines = true} = {}) {
    if (!Array.isArray(records) || records.length > this.options.maxFiles || !Array.isArray(folders)
      || folders.length > this.options.maxFiles * 5) throw new RangeError('Disk snapshot entry budget exceeded');
    const index = new Map();
    const positions = new Map();
    const paths = new Map();
    const next = [];
    let loadedBytes = 0;
    for (const input of records) {
      const path = this.provider.check(input.path ?? input.uri, {allowRoot: false});
      const identity = this.provider.pathPolicy.identity(path);
      if (index.has(identity)) throw new FileSystemError('AlreadyExists', path, 'Duplicate disk snapshot identity');
      if (input.text !== undefined && typeof input.text !== 'string' || input.bytes !== undefined && !(input.bytes instanceof Uint8Array)) {
        throw new TypeError('Disk snapshot records require text, Uint8Array bytes, or explicit lazy metadata');
      }
      if (input.text === undefined && input.bytes === undefined && input.lazy !== true) throw new TypeError('Unloaded disk records must be explicit');
      if (input.lazy === true && (input.text !== undefined || input.bytes !== undefined)) throw new TypeError('Lazy disk records cannot retain contents');
      const record = {...input, path};
      const size = diskRecordBytes(record);
      const maximum = /\.(?:dll|exe|pdb)$/i.test(path) ? this.options.maxAssemblyBytes : this.options.maxFileBytes;
      if (size > maximum) throw new FileSystemError('FileTooLarge', path);
      loadedBytes += size;
      if (loadedBytes > this.options.maxTotalBytes) throw new FileSystemError('QuotaExceeded', path, 'Loaded workspace byte budget exceeded');
      positions.set(identity, next.length);
      index.set(identity, record);
      paths.set(identity, path);
      next.push(record);
    }
    const folderIndex = new Map();
    for (const input of folders) {
      const path = this.provider.check(input, {allowRoot: false});
      const identity = this.provider.pathPolicy.identity(path);
      if (index.has(identity) || folderIndex.has(identity)) throw new FileSystemError('AlreadyExists', path, 'Duplicate disk directory identity');
      folderIndex.set(identity, path);
    }
    const hashes = new Map();
    const handles = new Map();
    if (preserveBaselines) for (const [path, hash] of this.baselineHashes) {
      const target = paths.get(this.provider.pathPolicy.identity(path));
      if (target) hashes.set(target, hash);
    }
    for (const [path, handle] of this.handles) {
      const target = paths.get(this.provider.pathPolicy.identity(path));
      if (target) handles.set(target, handle);
    }
    Object.assign(this, {records: next, index, positions, folderIndex, folders: [...folderIndex.values()],
      loadedBytes, baselineHashes: hashes, handles, importReport: report});
    if (report) this.skipped = report.outcomes ?? (Array.isArray(report.skipped) ? report.skipped : []);
    return this.records;
  }

  enqueue(action) {
    const next = this.queue.then(action);
    this.queue = next.catch(() => {});
    return next;
  }

  subscribeSaves(listener) {
    if (typeof listener !== 'function') throw new TypeError('A save listener is required');
    this.saveListeners.add(listener);
    return () => this.saveListeners.delete(listener);
  }

  didSave(record) { for (const listener of this.saveListeners) listener(record); }

  /** Preflight all baselines and permissions before opening any stream. Multi-file I/O is explicitly non-atomic. */
  save(changes, options = {}) { return this.enqueue(() => saveDiskChanges(this, changes, options)); }
  mutate(operations, options = {}) { return this.enqueue(() => applyDiskOperations(this, operations, options)); }
  create(path, value = '', options = {}) {
    return this.save([{path, ...(typeof value === 'string' ? {text: value} : {bytes: value}), expectedHash: null}], options);
  }
  delete(path, options = {}) { return this.mutate([{kind: 'delete', path, recursive: options.recursive}], options); }
  rename(path, destination, options = {}) { return this.mutate([{kind: 'move', path, destination}], options); }
  move(path, destination, options = {}) { return this.rename(path, destination, options); }
}
