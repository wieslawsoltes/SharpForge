import {FileSystemProvider, FileSystemError, fileBytes, hashFileBytes, ProviderEvents} from './provider.js';

/** Indexed in-memory tree. Lookup is O(path depth); directory enumeration is O(direct children). */
export class MemoryFileSystemProvider extends FileSystemProvider {
  constructor({maxBytes = 128 * 1024 * 1024, maxEntries = 100000, ...capabilities} = {}) {
    super({atomicWrite: true, atomicRename: true, watch: true, ...capabilities});
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.usedBytes = 0;
    this.entryCount = 1;
    this.revision = 0;
    this.root = this.node('', 'directory');
    this.events = new ProviderEvents(this.pathPolicy);
  }

  node(name, type) {
    return {name, type, mtime: ++this.revision, bytes: null, hash: null, children: type === 'directory' ? new Map() : null};
  }

  find(path) {
    let entry = this.root;
    for (const part of path ? path.split('/') : []) {
      if (entry.type !== 'directory') throw new FileSystemError('NotDirectory', path);
      entry = entry.children.get(this.pathPolicy.identity(part));
      if (!entry) throw new FileSystemError('NotFound', path);
    }
    return entry;
  }

  parent(path) {
    const slash = path.lastIndexOf('/');
    const parent = this.find(slash < 0 ? '' : path.slice(0, slash));
    if (parent.type !== 'directory') throw new FileSystemError('NotDirectory', path);
    return {parent, name: path.slice(slash + 1), key: this.pathPolicy.identity(path.slice(slash + 1))};
  }

  metadata(path, entry) {
    return {path, name: entry.name, type: entry.type, size: entry.bytes?.length ?? 0, mtime: entry.mtime, hash: entry.hash};
  }

  async stat(path, options = {}) {
    path = this.check(path, options);
    return this.metadata(path, this.find(path));
  }

  async readDirectory(path = '', options = {}) {
    path = this.check(path, options);
    const entry = this.find(path);
    if (entry.type !== 'directory') throw new FileSystemError('NotDirectory', path);
    return [...entry.children.values()].map(child => this.metadata(path ? path + '/' + child.name : child.name, child))
      .sort((left, right) => this.pathPolicy.compare(left.path, right.path));
  }

  async readFile(path, options = {}) {
    path = this.check(path, {...options, allowRoot: false});
    const entry = this.find(path);
    if (entry.type !== 'file') throw new FileSystemError('IsDirectory', path);
    return entry.bytes.slice();
  }

  async writeFile(path, value, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    const bytes = fileBytes(value).slice();
    const hash = await hashFileBytes(bytes, options);
    this.check(path, {...options, write: true});
    const {parent, name, key} = this.parent(path);
    const previous = parent.children.get(key);
    if (previous?.type === 'directory') throw new FileSystemError('IsDirectory', path);
    if (!previous && options.create === false) throw new FileSystemError('NotFound', path);
    if (previous && options.overwrite === false) throw new FileSystemError('AlreadyExists', path);
    if (options.expectedHash !== undefined && (previous?.hash ?? null) !== options.expectedHash) {
      throw new FileSystemError('Conflict', path, 'Disk bytes changed since the saved baseline');
    }
    const nextBytes = this.usedBytes - (previous?.bytes.length ?? 0) + bytes.length;
    if (nextBytes > this.maxBytes) throw new FileSystemError('QuotaExceeded', path);
    if (!previous && this.entryCount >= this.maxEntries) throw new FileSystemError('QuotaExceeded', path, 'Filesystem entry limit exceeded');
    const entry = this.node(previous?.name ?? name, 'file');
    entry.bytes = bytes;
    entry.hash = hash;
    parent.children.set(key, entry);
    parent.mtime = this.revision;
    this.usedBytes = nextBytes;
    if (!previous) this.entryCount++;
    this.events.emit({type: previous ? 'changed' : 'created', path, hash});
    return this.metadata(path, entry);
  }

  async createDirectory(path, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    const parts = path.split('/');
    let entry = this.root;
    let missingIndex = -1;
    for (let index = 0; index < parts.length; index++) {
      const next = entry.children.get(this.pathPolicy.identity(parts[index]));
      if (!next) { missingIndex = index; break; }
      if (next.type !== 'directory') throw new FileSystemError('NotDirectory', path);
      entry = next;
    }
    if (missingIndex < 0) return this.metadata(path, entry);
    if (missingIndex !== parts.length - 1 && !options.recursive) throw new FileSystemError('NotFound', path);
    if (this.entryCount + parts.length - missingIndex > this.maxEntries) throw new FileSystemError('QuotaExceeded', path);
    for (let index = missingIndex; index < parts.length; index++) {
      const next = this.node(parts[index], 'directory');
      entry.children.set(this.pathPolicy.identity(parts[index]), next);
      entry = next;
      this.entryCount++;
      this.events.emit({type: 'created', path: parts.slice(0, index + 1).join('/'), kind: 'directory'});
    }
    return this.metadata(path, entry);
  }

  async delete(path, options = {}) {
    path = this.check(path, {...options, write: true, allowRoot: false});
    const {parent, key} = this.parent(path);
    const entry = parent.children.get(key);
    if (!entry) throw new FileSystemError('NotFound', path);
    if (entry.children?.size && !options.recursive) throw new FileSystemError('DirectoryNotEmpty', path);
    if (options.expectedHash !== undefined && entry.hash !== options.expectedHash) throw new FileSystemError('Conflict', path);
    const pending = [entry];
    while (pending.length) {
      const next = pending.pop();
      this.usedBytes -= next.bytes?.length ?? 0;
      this.entryCount--;
      if (next.children) for (const child of next.children.values()) pending.push(child);
    }
    parent.children.delete(key);
    parent.mtime = ++this.revision;
    this.events.emit({type: 'deleted', path});
  }

  async rename(from, to, options = {}) {
    from = this.check(from, {...options, write: true, allowRoot: false});
    to = this.check(to, {...options, write: true, allowRoot: false});
    if (this.pathPolicy.contains(from, to, {includeSelf: false})) throw new FileSystemError('InvalidPath', to, 'A folder cannot contain itself');
    const source = this.parent(from);
    const entry = source.parent.children.get(source.key);
    if (!entry) throw new FileSystemError('NotFound', from);
    if (options.expectedHash !== undefined && entry.hash !== options.expectedHash) throw new FileSystemError('Conflict', from);
    const target = this.parent(to);
    const existing = target.parent.children.get(target.key);
    if (existing && existing !== entry) throw new FileSystemError('AlreadyExists', to, 'Rename never overwrites implicitly');
    source.parent.children.delete(source.key);
    entry.name = target.name;
    entry.mtime = ++this.revision;
    target.parent.children.set(target.key, entry);
    this.events.emit({type: 'renamed', path: to, oldPath: from});
    return this.metadata(to, entry);
  }

  async watch(path, listener, options = {}) {
    path = this.check(path, options);
    return this.events.subscribe(path, listener, options);
  }

  dispose() { this.events.dispose(); super.dispose(); }
}
