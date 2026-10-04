import {PathPolicy} from '@sharpforge/archive';
import {hashWorkspaceBytes} from '../content-hash.js';

export const FileSystemErrorCode = Object.freeze({
  NotFound: 'NotFound', AlreadyExists: 'AlreadyExists', NotDirectory: 'NotDirectory', IsDirectory: 'IsDirectory',
  NoPermissions: 'NoPermissions', ReadOnly: 'ReadOnly', Conflict: 'Conflict', Unavailable: 'Unavailable',
  InvalidPath: 'InvalidPath', FileTooLarge: 'FileTooLarge', QuotaExceeded: 'QuotaExceeded',
  DirectoryNotEmpty: 'DirectoryNotEmpty', Cancelled: 'Cancelled', Disposed: 'Disposed', Io: 'Io'
});

/** Stable provider diagnostic. Never conveys permission failure as an absent file. */
export class FileSystemError extends Error {
  constructor(code, path, message = code, options = {}) {
    super(message + (path ? ': ' + path : ''), options);
    this.name = code === FileSystemErrorCode.Cancelled ? 'AbortError' : 'FileSystemError';
    this.code = code;
    this.path = path;
    this.diagnostic = {code: 'SFVFS_' + code, severity: 'error', path, message: this.message};
  }
}

export function throwIfCancelled(signal) {
  if (signal?.aborted) throw new FileSystemError(FileSystemErrorCode.Cancelled, '', 'Filesystem operation cancelled', {cause: signal.reason});
}

export function asFileSystemError(error, path = '') {
  if (error instanceof FileSystemError) return error;
  const codes = {
    NotFoundError: 'NotFound', ENOENT: 'NotFound', TypeMismatchError: 'NotDirectory', ENOTDIR: 'NotDirectory',
    NotAllowedError: 'NoPermissions', SecurityError: 'NoPermissions', EACCES: 'NoPermissions', EPERM: 'NoPermissions',
    AbortError: 'Cancelled', QuotaExceededError: 'QuotaExceeded', ENOSPC: 'QuotaExceeded', EEXIST: 'AlreadyExists',
    InvalidModificationError: 'DirectoryNotEmpty', ENOTEMPTY: 'DirectoryNotEmpty', EISDIR: 'IsDirectory',
    NoModificationAllowedError: 'Conflict'
  };
  const stableCode = Object.hasOwn(FileSystemErrorCode, error?.code ?? '') ? error.code : null;
  const code = stableCode ?? codes[error?.code] ?? codes[error?.name] ?? (error?.status === 409 ? 'Conflict' : 'Io');
  return new FileSystemError(code, path, error?.message ?? String(error), {cause: error});
}

export function fileBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError('File providers accept Uint8Array or ArrayBuffer bytes');
}

export const hashFileBytes = hashWorkspaceBytes;

/**
 * Async byte-oriented root-relative provider contract. All methods take an optional AbortSignal.
 * readDirectory returns direct children; writeFile defaults to create/overwrite, expectedHash:null requires absence.
 * Cancellation is checked before commit; an already-committed write is reported as success.
 */
export class FileSystemProvider {
  constructor(capabilities = {}) {
    this.capabilities = Object.freeze({readonly: false, caseSensitive: true, atomicWrite: false, atomicRename: false,
      watch: false, persistent: false, ...capabilities});
    this.pathPolicy = new PathPolicy(this.capabilities);
    this.disposed = false;
  }

  check(path = '', {signal, write = false, allowRoot = true} = {}) {
    throwIfCancelled(signal);
    if (this.disposed) throw new FileSystemError('Disposed', path, 'Filesystem provider has been disposed');
    if (write && this.capabilities.readonly) throw new FileSystemError('ReadOnly', path, 'Filesystem is read-only');
    try { return this.pathPolicy.normalize(path, {allowRoot}); }
    catch (error) { throw new FileSystemError('InvalidPath', path, error.message, {cause: error}); }
  }

  async stat(path, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'stat is unavailable'); }
  async readDirectory(path, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'readDirectory is unavailable'); }
  async readFile(path, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'readFile is unavailable'); }
  async writeFile(path, bytes, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'writeFile is unavailable'); }
  async delete(path, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'delete is unavailable'); }
  async rename(from, to, options) { this.check(from, options); throw new FileSystemError('Unavailable', from, 'rename is unavailable'); }
  async createDirectory(path, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'createDirectory is unavailable'); }
  async watch(path, listener, options) { this.check(path, options); throw new FileSystemError('Unavailable', path, 'watch is unavailable'); }
  dispose() { this.disposed = true; }
}

export async function assertExpectedHash(provider, path, expectedHash, options = {}) {
  if (expectedHash === undefined) return;
  let bytes;
  try { bytes = await provider.readFile(path, options); }
  catch (error) { if (error.code !== 'NotFound') throw error; }
  const actual = bytes === undefined ? null : await hashFileBytes(bytes, options);
  if (actual !== expectedHash) throw new FileSystemError('Conflict', path, 'Disk bytes changed since the saved baseline');
}

/** Event subscriptions are scoped to each provider, never process-global. */
export class ProviderEvents {
  constructor(policy) { this.policy = policy; this.listeners = new Set(); }
  subscribe(path, listener, {signal, recursive = true} = {}) {
    throwIfCancelled(signal);
    if (typeof listener !== 'function') throw new TypeError('A filesystem change listener is required');
    const item = {path, listener, recursive};
    const dispose = () => { this.listeners.delete(item); signal?.removeEventListener('abort', dispose); };
    this.listeners.add(item);
    signal?.addEventListener('abort', dispose, {once: true});
    return {dispose};
  }
  emit(event) {
    for (const item of [...this.listeners]) {
      const parent = event.path.includes('/') ? event.path.slice(0, event.path.lastIndexOf('/')) : '';
      if (this.policy.equals(item.path, event.path) || this.policy.equals(item.path, parent)
        || item.recursive && this.policy.contains(item.path, event.path)) item.listener(event);
    }
  }
  dispose() { this.listeners.clear(); }
}
