import {FileSystemProvider, FileSystemError, asFileSystemError, fileBytes, hashFileBytes, ProviderEvents} from './provider.js';
import {PollingFileWatcher, observeFileSystemHandle} from '../watch.js';
import {renameFileSystemEntry} from './fsa-rename.js';

/** Permission-aware File System Access provider; writable streams commit only after close succeeds. */
export class FileSystemAccessProvider extends FileSystemProvider {
  constructor(rootHandle, {maxFileBytes = 64 * 1024 * 1024, maxEntries = 100000, ...capabilities} = {}) {
    if (rootHandle?.kind !== 'directory') throw new TypeError('A granted FileSystemDirectoryHandle is required');
    super({persistent: true, atomicWrite: true, watch: true, ...capabilities});
    this.rootHandle = rootHandle;
    this.maxFileBytes = maxFileBytes;
    this.maxEntries = maxEntries;
    this.events = new ProviderEvents(this.pathPolicy);
    this.watchers = new Set();
    this.directoryNames = new WeakMap();
    this.directoryHandles = new WeakMap();
  }

  async permission(handle, path, {signal, write = false, requestPermission = false} = {}) {
    this.check(path, {signal, write});
    const mode = write ? 'readwrite' : 'read';
    if (typeof handle.queryPermission !== 'function') return;
    let permission = await handle.queryPermission({mode});
    this.check(path, {signal, write});
    if (permission !== 'granted' && requestPermission && typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({mode});
    }
    this.check(path, {signal, write});
    if (permission !== 'granted') throw new FileSystemError('NoPermissions', path, 'Filesystem permission denied or revoked');
  }

  async child(directory, name, type, options = {}) {
    let actual = name;
    let names = this.directoryNames.get(directory);
    if (!names) {
      names = new Map();
      const handles = new Map();
      for await (const [candidate, handle] of directory.entries()) {
        this.check('', options);
        if (names.size >= this.maxEntries) throw new FileSystemError('QuotaExceeded', name, 'Directory entry limit exceeded');
        const key = this.nameIdentity(candidate);
        names.set(key, names.has(key) ? null : candidate);
        handles.set(candidate, handle);
      }
      this.directoryNames.set(directory, names);
      this.directoryHandles.set(directory, handles);
    }
    const found = names.get(this.nameIdentity(name));
    if (found === null) throw new FileSystemError('Conflict', name, 'Ambiguous Unicode/case path identity');
    if (found) actual = found;
    if (typeof directory.getFileHandle !== 'function' || typeof directory.getDirectoryHandle !== 'function') {
      const handle = this.directoryHandles.get(directory)?.get(actual);
      if (!handle) throw new FileSystemError('NotFound', name);
      if (handle.kind !== type) throw new FileSystemError(type === 'directory' ? 'NotDirectory' : 'IsDirectory', name);
      return handle;
    }
    return type === 'directory' ? directory.getDirectoryHandle(actual) : directory.getFileHandle(actual);
  }

  nameIdentity(name) {
    const normalized = this.pathPolicy.unicodeNormalization === 'none' ? name : name.normalize(this.pathPolicy.unicodeNormalization);
    return this.capabilities.caseSensitive ? normalized : normalized.toLowerCase();
  }

  async directory(path = '', options = {}) {
    let handle = this.rootHandle;
    await this.permission(handle, path, options);
    try {
      for (const part of path ? path.split('/') : []) handle = await this.child(handle, part, 'directory', options);
      await this.permission(handle, path, options);
      return handle;
    } catch (error) { throw asFileSystemError(error, path); }
  }

  async fileHandle(path, options = {}) {
    const slash = path.lastIndexOf('/');
    const parent = await this.directory(slash < 0 ? '' : path.slice(0, slash), options);
    try {
      const handle = await this.child(parent, path.slice(slash + 1), 'file', options);
      await this.permission(handle, path, options);
      return handle;
    } catch (error) { throw asFileSystemError(error, path); }
  }

  async stat(path, options = {}) {
    path = this.check(path, options);
    if (!path) { await this.permission(this.rootHandle, '', options); return {path, type: 'directory', size: 0, mtime: 0}; }
    try {
      const handle = await this.fileHandle(path, options);
      const file = await handle.getFile();
      this.check(path, options);
      const result = {path, name: handle.name, type: 'file', size: file.size, mtime: file.lastModified ?? 0};
      if (options.hash) result.hash = await hashFileBytes(await this.readFile(path, options), options);
      return result;
    } catch (error) {
      if (!['NotDirectory', 'IsDirectory', 'NotFound', 'Io'].includes(error.code)) throw error;
      try {
        const handle = await this.directory(path, options);
        return {path, name: handle.name, type: 'directory', size: 0, mtime: 0};
      } catch (directoryError) {
        if (error.code !== 'NotFound' && directoryError.code === 'NotFound') throw error;
        throw directoryError;
      }
    }
  }

  async readDirectory(path = '', options = {}) {
    path = this.check(path, options);
    const directory = await this.directory(path, options);
    const entries = [];
    const names = new Map();
    try {
      for await (const [name, handle] of directory.entries()) {
        this.check(path, options);
        if (entries.length >= this.maxEntries) throw new FileSystemError('QuotaExceeded', path, 'Directory entry limit exceeded');
        const childPath = path ? path + '/' + name : name;
        const identity = this.nameIdentity(name);
        names.set(identity, names.has(identity) ? null : name);
        const entry = {name, path: childPath, type: handle.kind, size: 0, mtime: 0};
        if (handle.kind === 'file' && options.metadata !== false) {
          const file = await handle.getFile();
          entry.size = file.size;
          entry.mtime = file.lastModified ?? 0;
        }
        entries.push(entry);
      }
    } catch (error) { throw asFileSystemError(error, path); }
    this.directoryNames.set(directory, names);
    return entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  async *iterateDirectory(path = '', options = {}) {
    path = this.check(path, options);
    const directory = await this.directory(path, options);
    let count = 0;
    for await (const [name, handle] of directory.entries()) {
      this.check(path, options);
      if (++count > this.maxEntries) throw new FileSystemError('QuotaExceeded', path, 'Directory entry limit exceeded');
      const entry = {name, path: path ? path + '/' + name : name, type: handle.kind, size: 0, mtime: 0};
      if (handle.kind === 'file' && options.metadata !== false) {
        const file = await handle.getFile();
        entry.size = file.size;
        entry.mtime = file.lastModified ?? 0;
      }
      yield entry;
    }
  }

  async readFile(path, options = {}) {
    path = this.check(path, {...options, allowRoot: false});
    try {
      const file = await (await this.fileHandle(path, options)).getFile();
      if (file.size > this.maxFileBytes) throw new FileSystemError('FileTooLarge', path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      this.check(path, options);
      if (bytes.length !== file.size) throw new FileSystemError('Conflict', path, 'File changed while it was read');
      return bytes;
    } catch (error) { throw asFileSystemError(error, path); }
  }

  async prepareWrite(path, options) {
    await this.permission(this.rootHandle, path, {...options, write: true});
    let handle = null;
    try { handle = await this.fileHandle(path, {...options, write: true}); }
    catch (error) { if (error.code !== 'NotFound') throw error; }
    if (!handle && options.create === false) throw new FileSystemError('NotFound', path);
    if (handle && options.overwrite === false) throw new FileSystemError('AlreadyExists', path);
    if (options.expectedHash !== undefined) {
      const actual = handle ? await hashFileBytes(await this.readFile(path, options), options) : null;
      if (actual !== options.expectedHash) throw new FileSystemError('Conflict', path, 'Disk bytes changed since the saved baseline');
    }
    return handle;
  }

  async writeFile(path, value, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    const bytes = fileBytes(value).slice();
    if (bytes.length > this.maxFileBytes) throw new FileSystemError('FileTooLarge', path);
    const hash = await hashFileBytes(bytes, options);
    let handle = await this.prepareWrite(path, options);
    const previous = !!handle;
    const slash = path.lastIndexOf('/');
    const parent = await this.directory(slash < 0 ? '' : path.slice(0, slash), {...options, write: true});
    let stream;
    try {
      this.check(path, {...options, write: true});
      if (!handle) {
        handle = await parent.getFileHandle(path.slice(slash + 1), {create: true});
        this.directoryNames.delete(parent);
      }
      stream = await handle.createWritable();
      await stream.write(bytes);
      this.check(path, options);
      if (previous && options.expectedHash !== undefined) await this.prepareWrite(path, options);
      await stream.close();
    } catch (error) {
      const failure = asFileSystemError(error, path);
      try { await stream?.abort(); } catch (cleanupError) { failure.abortError = asFileSystemError(cleanupError, path); }
      if (!previous && handle) {
        try { await parent.removeEntry(handle.name); } catch (cleanupError) { failure.cleanupError = asFileSystemError(cleanupError, path); }
      }
      throw failure;
    }
    this.events.emit({type: previous ? 'changed' : 'created', path, hash, source: 'provider'});
    return {path, type: 'file', size: bytes.length, hash};
  }

  async createDirectory(path, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    await this.permission(this.rootHandle, path, {...options, write: true});
    const parts = path.split('/');
    let handle = this.rootHandle;
    try {
      for (let index = 0; index < parts.length; index++) {
        this.check(path, options);
        const create = options.recursive || index === parts.length - 1;
        let next;
        try { next = await this.child(handle, parts[index], 'directory', options); }
        catch (error) {
          if (asFileSystemError(error).code !== 'NotFound' || !create) throw error;
          await this.permission(handle, path, {...options, write: true});
          next = await handle.getDirectoryHandle(parts[index], {create: true});
          this.directoryNames.delete(handle);
          this.events.emit({type: 'created', path: parts.slice(0, index + 1).join('/'), kind: 'directory', source: 'provider'});
        }
        handle = next;
      }
    } catch (error) { throw asFileSystemError(error, path); }
    return {path, type: 'directory', size: 0};
  }

  async delete(path, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    const metadata = await this.stat(path, options);
    if (options.expectedHash !== undefined && metadata.type === 'file') await this.prepareWrite(path, options);
    const slash = path.lastIndexOf('/');
    const parent = await this.directory(slash < 0 ? '' : path.slice(0, slash), {...options, write: true});
    const handle = metadata.type === 'file' ? await this.fileHandle(path, {...options, write: true})
      : await this.directory(path, {...options, write: true});
    this.check(path, options);
    try { await parent.removeEntry(handle.name, {recursive: !!options.recursive}); }
    catch (error) { throw asFileSystemError(error, path); }
    this.directoryNames.delete(parent);
    this.events.emit({type: 'deleted', path, source: 'provider'});
  }

  async rename(from, to, options = {}) {
    return renameFileSystemEntry(this, from, to, options);
  }

  async watch(path, listener, options = {}) {
    path = this.check(path, options);
    const metadata = await this.stat(path, options);
    const file = metadata.type === 'file';
    const handle = file ? await this.fileHandle(path, options) : await this.directory(path, options);
    const notify = file ? event => {
      if (this.pathPolicy.equals(event.path, path) || event.oldPath && this.pathPolicy.equals(event.oldPath, path)) listener(event);
    } : listener;
    const observer = await observeFileSystemHandle(handle, notify, {...options, path, file});
    const parent = file ? path.slice(0, Math.max(0, path.lastIndexOf('/'))) : path;
    const watcher = observer ?? new PollingFileWatcher(this, notify, {...options, path: parent,
      watchedPaths: file ? [path] : options.watchedPaths});
    if (!observer) await watcher.start();
    this.watchers.add(watcher);
    return {dispose: () => { watcher.dispose(); this.watchers.delete(watcher); },
      setWatchedPaths: paths => watcher.setWatchedPaths?.(paths)};
  }

  dispose() {
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers.clear();
    this.events.dispose();
    super.dispose();
  }
}
