import { GitError, checkCancelled, checkLimit } from './errors.js';
import { validateCheckoutPath, validateSymlinkTarget } from './path-safety.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytes(data) {
  if (typeof data === 'string') return textEncoder.encode(data);
  if (data instanceof Uint8Array) return data.slice();
  if (data instanceof ArrayBuffer) return new Uint8Array(data).slice();
  throw new GitError('Corrupt', 'Worktree content must be text or bytes');
}

function copyFile(file) {
  return file ? { data: file.data.slice(), mode: file.mode, stat: { ...file.stat } } : null;
}

/** An isolated byte-oriented tree; files are not registered as open editor documents. */
export class MemoryWorktree {
  constructor(files = {}, { caseSensitive = true } = {}) {
    this.files = new Map();
    this.caseSensitive = caseSensitive;
    this.sequence = 0;
    for (const [path, value] of files instanceof Map ? files : Object.entries(files)) {
      this.put(path, value?.data ?? value, { mode: value?.mode });
    }
  }

  put(path, data, { mode = 0o100644 } = {}) {
    validateCheckoutPath(path);
    const content = bytes(data);
    if (mode === 0o120000) validateSymlinkTarget(path, textDecoder.decode(content));
    this.files.set(path, { data: content, mode, stat: { size: content.length, mtimeMs: ++this.sequence, revision: this.sequence } });
  }

  async read(path, { signal } = {}) {
    checkCancelled(signal);
    validateCheckoutPath(path);
    return copyFile(this.files.get(path));
  }

  async write(path, data, options = {}) {
    checkCancelled(options.signal);
    this.put(path, data, options);
  }

  async remove(path, { signal } = {}) {
    checkCancelled(signal);
    validateCheckoutPath(path);
    this.files.delete(path);
  }

  async list({ signal } = {}) {
    checkCancelled(signal);
    return [...this.files.keys()].sort();
  }

  /** Snapshot revisions and modes without copying file content. Writes issue a fresh revision. */
  async scan({ signal, maxEntries = 1000000 } = {}) {
    checkCancelled(signal);
    checkLimit(this.files.size, maxEntries, 'Worktree file count');
    const result = new Map();
    for (const [path, file] of this.files) {
      checkCancelled(signal);
      result.set(path, { mode: file.mode, stat: { ...file.stat } });
    }
    return result;
  }
}

/** A byte-oriented tree backed by a transactional IndexedDB/OPFS-compatible KV store. */
export class KeyValueWorktree {
  constructor(store, { prefix = 'worktree/', caseSensitive = true } = {}) {
    this.store = store;
    this.prefix = prefix;
    this.caseSensitive = caseSensitive;
  }

  key(path) {
    return this.prefix + validateCheckoutPath(path);
  }

  async read(path, { signal } = {}) {
    checkCancelled(signal);
    const raw = await this.store.get(this.key(path));
    if (!raw) return null;
    if (raw.length < 4) throw new GitError('Corrupt', 'Truncated persisted worktree entry', { path });
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    return { data: raw.slice(4), mode: view.getUint32(0), stat: { size: raw.length - 4 } };
  }

  async write(path, data, { mode = 0o100644, signal } = {}) {
    checkCancelled(signal);
    const content = bytes(data);
    if (mode === 0o120000) validateSymlinkTarget(path, textDecoder.decode(content));
    const raw = new Uint8Array(content.length + 4);
    new DataView(raw.buffer).setUint32(0, mode);
    raw.set(content, 4);
    await this.store.set(this.key(path), raw);
  }

  async remove(path, { signal } = {}) {
    checkCancelled(signal);
    await this.store.delete(this.key(path));
  }

  async list({ signal } = {}) {
    checkCancelled(signal);
    return (await this.store.list(this.prefix)).map(key => key.slice(this.prefix.length)).sort();
  }
}

/** File System Access and OPFS adapter without an editor-document limit. */
export class FileSystemWorktree {
  constructor(directory, { caseSensitive = false, maxFiles = 1000000 } = {}) {
    this.directory = directory;
    this.caseSensitive = caseSensitive;
    this.maxFiles = maxFiles;
    this.supportedModes = [0o100644];
  }

  async parent(path, create = false) {
    const components = validateCheckoutPath(path).split('/');
    const name = components.pop();
    let directory = this.directory;
    for (const component of components) directory = await directory.getDirectoryHandle(component, { create });
    return { directory, name };
  }

  async read(path, { signal } = {}) {
    checkCancelled(signal);
    try {
      const { directory, name } = await this.parent(path);
      const file = await (await directory.getFileHandle(name)).getFile();
      return { data: new Uint8Array(await file.arrayBuffer()), mode: 0o100644,
        stat: { size: file.size, mtimeMs: file.lastModified } };
    } catch (error) {
      if (error.name === 'NotFoundError') return null;
      throw GitError.from(error);
    }
  }

  async write(path, data, { mode = 0o100644, signal } = {}) {
    checkCancelled(signal);
    if (mode !== 0o100644) throw new GitError('Unsupported', 'File System Access cannot preserve executable or symlink modes', { path, mode });
    const { directory, name } = await this.parent(path, true);
    const handle = await directory.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try {
      await writer.write(bytes(data));
      checkCancelled(signal);
      await writer.close();
    } catch (error) {
      await writer.abort();
      throw GitError.from(error);
    }
  }

  async remove(path, { signal } = {}) {
    checkCancelled(signal);
    try {
      const { directory, name } = await this.parent(path);
      await directory.removeEntry(name);
    } catch (error) {
      if (error.name !== 'NotFoundError') throw GitError.from(error);
    }
  }

  async list({ signal } = {}) {
    const paths = [];
    const queue = [{ directory: this.directory, prefix: '', depth: 0 }];
    for (let position = 0; position < queue.length; position++) {
      const { directory, prefix, depth } = queue[position];
      checkLimit(depth, 512, 'Worktree depth');
      for await (const [name, handle] of directory.entries()) {
        checkCancelled(signal);
        if (name.toLowerCase() === '.git') continue;
        const path = prefix + name;
        validateCheckoutPath(path);
        if (handle.kind === 'directory') queue.push({ directory: handle, prefix: `${path}/`, depth: depth + 1 });
        else paths.push(path);
        checkLimit(paths.length + queue.length, this.maxFiles, 'Worktree entries');
      }
    }
    return paths.sort();
  }
}

/** Adapt a DiskWorkspace root handle while leaving its open-document collection untouched. */
export class DiskWorkspaceWorktree extends FileSystemWorktree {
  constructor(workspace, options = {}) {
    const directory = options.directory ?? workspace.directory ?? workspace.rootHandle ?? workspace.directoryHandle ?? workspace.root;
    if (!directory?.getDirectoryHandle) throw new GitError('Unsupported', 'DiskWorkspace must expose its root directory handle');
    super(directory, options);
  }
}

export function createWorktree(options = {}) {
  if (options.worktree) return options.worktree;
  if (options.directory) return new FileSystemWorktree(options.directory, options);
  if (options.store) return new KeyValueWorktree(options.store, options);
  return new MemoryWorktree(options.files, options);
}
