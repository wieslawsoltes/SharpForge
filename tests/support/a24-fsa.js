const encode = value => typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
const failure = (name, message = name) => Object.assign(new Error(message), {name});

/** Deterministic File System Access double. Browser API qualification is a separate Chromium test. */
export class TestFileHandle {
  constructor(name, bytes = new Uint8Array(), options = {}, parent = null) {
    this.kind = 'file';
    this.name = name;
    this.bytes = encode(bytes).slice();
    this.options = options;
    this.parent = parent;
    this.modified = 1;
    this.reads = 0;
    this.writes = 0;
    this.metadataReads = 0;
    this.syncReads = 0;
    this.syncWrites = 0;
  }
  async queryPermission({mode}) { return this.options.permission?.[mode] ?? this.options.permission ?? 'granted'; }
  async requestPermission(options) { return this.options.requestPermission?.(options) ?? this.queryPermission(options); }
  async getFile() {
    this.metadataReads++;
    const file = new File([this.bytes], this.name, {lastModified: this.modified});
    const read = file.arrayBuffer.bind(file);
    file.arrayBuffer = () => { this.reads++; return read(); };
    return file;
  }
  async createWritable() {
    const owner = this;
    let pending = null;
    return {
      async write(value) {
        if (owner.options.failWrite) throw failure('QuotaExceededError', 'Storage full');
        pending = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : encode(value);
      },
      async close() {
        if (owner.options.failClose) throw failure('QuotaExceededError', 'Commit failed');
        owner.bytes = pending.slice();
        owner.modified++;
        owner.writes++;
      },
      async abort() { pending = null; }
    };
  }
  async createSyncAccessHandle() {
    const owner = this;
    let closed = false;
    return {
      getSize() { if (closed) throw new Error('Closed handle'); return owner.bytes.length; },
      read(target, {at = 0} = {}) {
        if (closed) throw new Error('Closed handle');
        owner.syncReads++;
        const count = Math.min(target.length, owner.bytes.length - at);
        target.set(owner.bytes.subarray(at, at + count));
        return count;
      },
      write(source, {at = 0} = {}) {
        if (closed) throw new Error('Closed handle');
        owner.syncWrites++;
        if (owner.bytes.length < at + source.length) {
          const next = new Uint8Array(at + source.length);
          next.set(owner.bytes);
          owner.bytes = next;
        }
        owner.bytes.set(source, at);
        return source.length;
      },
      truncate(size) {
        const next = new Uint8Array(size);
        next.set(owner.bytes.subarray(0, size));
        owner.bytes = next;
      },
      flush() { owner.modified++; },
      close() { closed = true; }
    };
  }
}

export class TestDirectoryHandle {
  constructor(name = 'Workspace', options = {}) {
    this.kind = 'directory';
    this.name = name;
    this.options = options;
    this.children = new Map();
    this.enumerations = 0;
  }
  async *entries() { this.enumerations++; yield* this.children; }
  async queryPermission({mode}) { return this.options.permission?.[mode] ?? this.options.permission ?? 'granted'; }
  async requestPermission(options) { return this.options.requestPermission?.(options) ?? this.queryPermission(options); }
  async getFileHandle(name, {create = false} = {}) {
    let handle = this.children.get(name);
    if (!handle) {
      if (!create) throw failure('NotFoundError');
      handle = new TestFileHandle(name, new Uint8Array(), this.options.fileOptions?.[name] ?? {}, this);
      this.children.set(name, handle);
    }
    if (handle.kind !== 'file') throw failure('TypeMismatchError');
    return handle;
  }
  async getDirectoryHandle(name, {create = false} = {}) {
    let handle = this.children.get(name);
    if (!handle) {
      if (!create) throw failure('NotFoundError');
      handle = new TestDirectoryHandle(name, this.options);
      this.children.set(name, handle);
    }
    if (handle.kind !== 'directory') throw failure('TypeMismatchError');
    return handle;
  }
  async removeEntry(name, {recursive = false} = {}) {
    const handle = this.children.get(name);
    if (!handle) throw failure('NotFoundError');
    if (handle.kind === 'directory' && handle.children.size && !recursive) throw failure('InvalidModificationError');
    this.children.delete(name);
  }
  async put(path, content, options = {}) {
    const parts = path.split('/');
    let directory = this;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, {create: true});
    const name = parts.at(-1);
    const handle = new TestFileHandle(name, content, options, directory);
    directory.children.set(name, handle);
    return handle;
  }
}
