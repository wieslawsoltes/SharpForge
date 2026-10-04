import {FileSystemProvider, FileSystemError, asFileSystemError, fileBytes} from './provider.js';
import {PollingFileWatcher} from '../watch.js';

/** Native MSBuild host adapter. Byte endpoints avoid re-encoding text during a provider write. */
export class NativeHostFileSystemProvider extends FileSystemProvider {
  constructor(client, capabilities = {}) {
    if (typeof client?.request !== 'function' && typeof client?.vfs !== 'function') throw new TypeError('An MSBuildClient is required');
    super({persistent: true, atomicWrite: true, atomicRename: true, watch: true, ...capabilities});
    this.client = client;
    this.watchers = new Set();
  }

  static async connect(client, {signal} = {}) {
    const provider = new NativeHostFileSystemProvider(client);
    const capabilities = await provider.call('capabilities', {}, {signal});
    return new NativeHostFileSystemProvider(client, capabilities);
  }

  async call(method, payload, {signal} = {}) {
    this.check(payload.path ?? payload.from ?? '', {signal});
    try {
      const result = typeof this.client.vfs === 'function' ? await this.client.vfs(method, payload, {signal})
        : await this.client.request('/vfs', {method: 'POST', body: {method, payload}, signal});
      if (result?.error) throw new FileSystemError(result.code ?? 'Io', payload.path, result.error);
      return result;
    } catch (error) {
      if (error?.code && ['Conflict', 'NotFound', 'AlreadyExists', 'NoPermissions', 'FileTooLarge', 'Unavailable'].includes(error.code)) {
        throw new FileSystemError(error.code, payload.path ?? payload.from ?? '', error.message, {cause: error});
      }
      throw asFileSystemError(error, payload.path ?? payload.from ?? '');
    }
  }

  async stat(path, options = {}) {
    path = this.check(path, options);
    return this.call('stat', {path, hash: !!options.hash}, options);
  }
  async readDirectory(path = '', options = {}) {
    path = this.check(path, options);
    return this.call('readDirectory', {path}, options);
  }
  async readFile(path, options = {}) {
    path = this.check(path, {...options, allowRoot: false});
    const result = await this.call('readFile', {path}, options);
    if (!Array.isArray(result.bytes) || result.bytes.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw new FileSystemError('Io', path, 'Native host returned invalid file bytes');
    }
    return Uint8Array.from(result.bytes);
  }
  async writeFile(path, bytes, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    return this.call('writeFile', {path, bytes: [...fileBytes(bytes)], create: options.create,
      overwrite: options.overwrite, expectedHash: options.expectedHash}, options);
  }
  async createDirectory(path, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    return this.call('createDirectory', {path, recursive: !!options.recursive}, options);
  }
  async delete(path, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    return this.call('delete', {path, recursive: !!options.recursive, expectedHash: options.expectedHash}, options);
  }
  async rename(from, to, options = {}) {
    from = this.check(from, {...options, write: true, allowRoot: false});
    to = this.check(to, {...options, write: true, allowRoot: false});
    return this.call('rename', {from, to, expectedHash: options.expectedHash}, options);
  }
  async watch(path, listener, options = {}) {
    const watcher = new PollingFileWatcher(this, listener, {path, ...options});
    await watcher.start();
    this.watchers.add(watcher);
    return {dispose: () => { watcher.dispose(); this.watchers.delete(watcher); }};
  }
  dispose() {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers.clear();
    super.dispose();
  }
}
