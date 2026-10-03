import {FileSystemAccessProvider} from './fsa.js';
import {FileSystemError, fileBytes, asFileSystemError} from './provider.js';
import {OpfsWorkerClient} from './opfs-worker-client.js';

/** Persistent browser-only workspace. Large files use a dedicated sync-access worker when available. */
export class OriginPrivateFileSystemProvider extends FileSystemAccessProvider {
  constructor(rootHandle, {storage = globalThis.navigator?.storage, rootPath = [], worker = null,
    workerThresholdBytes = 1024 * 1024, onDiagnostic = () => {}, ...options} = {}) {
    super(rootHandle, {persistent: true, caseSensitive: true, ...options});
    this.storage = storage;
    this.rootPath = rootPath;
    this.worker = worker ? new OpfsWorkerClient(worker) : null;
    this.workerThresholdBytes = workerThresholdBytes;
    this.onDiagnostic = onDiagnostic;
    this.backend = this.worker ? 'opfs-sync-worker' : 'opfs-async';
  }

  static async open({name = 'default', storage = globalThis.navigator?.storage,
    workerFactory = typeof Worker === 'function' ? url => new Worker(url, {type: 'module'}) : null,
    workerUrl = null, ...options} = {}) {
    if (typeof storage?.getDirectory !== 'function') throw new FileSystemError('Unavailable', '', 'Origin Private File System is unavailable');
    if (typeof name !== 'string' || !/^[\p{L}\p{N}_-]{1,100}$/u.test(name)) throw new FileSystemError('InvalidPath', name, 'Invalid OPFS workspace name');
    const rootPath = ['sharpforge-workspaces', name];
    let root = await storage.getDirectory();
    for (const part of rootPath) root = await root.getDirectoryHandle(part, {create: true});
    let worker = null;
    if (workerFactory) {
      try {
        const base = globalThis.document?.baseURI ?? globalThis.location?.href;
        const url = workerUrl ?? new URL('./packages/workspace/src/vfs/opfs.worker.js', base);
        worker = workerFactory(url);
      }
      catch (error) { options.onDiagnostic?.({code: 'SFVFS_Unavailable', severity: 'warning',
        message: 'OPFS sync worker could not start; asynchronous writable streams are active: ' + error.message}); }
    }
    return new OriginPrivateFileSystemProvider(root, {storage, rootPath, worker, ...options});
  }

  async quota() {
    if (typeof this.storage?.estimate !== 'function') throw new FileSystemError('Unavailable', '', 'Storage quota reporting is unavailable');
    const estimate = await this.storage.estimate();
    return {usage: estimate.usage ?? null, quota: estimate.quota ?? null,
      available: estimate.quota == null || estimate.usage == null ? null : Math.max(0, estimate.quota - estimate.usage),
      persistent: typeof this.storage.persisted === 'function' ? await this.storage.persisted() : null};
  }

  async workerOperation(method, payload, options) {
    try { return await this.worker.request(method, {...payload, rootPath: this.rootPath}, options); }
    catch (error) {
      if (error.code !== 'Unavailable') throw asFileSystemError(error, payload.path);
      this.onDiagnostic({code: 'SFVFS_Unavailable', severity: 'warning', path: payload.path,
        message: 'OPFS sync access is unavailable; asynchronous writable streams are active'});
      this.worker.dispose();
      this.worker = null;
      this.backend = 'opfs-async';
      return null;
    }
  }

  async readFile(path, options = {}) {
    path = this.check(path, {...options, allowRoot: false});
    if (this.worker && (await this.stat(path, {...options, hash: false})).size >= this.workerThresholdBytes) {
      const result = await this.workerOperation('readFile', {path}, options);
      if (result) return fileBytes(result.bytes).slice();
    }
    return super.readFile(path, options);
  }

  async writeFile(path, value, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    const bytes = fileBytes(value);
    if (bytes.length > this.maxFileBytes) throw new FileSystemError('FileTooLarge', path);
    if (this.worker && bytes.length >= this.workerThresholdBytes) {
      const result = await this.workerOperation('writeFile', {path, bytes, create: options.create,
        overwrite: options.overwrite, expectedHash: options.expectedHash}, options);
      if (result) { this.events.emit({type: 'changed', path, hash: result.hash, source: 'provider'}); return result; }
    }
    return super.writeFile(path, bytes, options);
  }

  dispose() { this.worker?.dispose(); super.dispose(); }
}
