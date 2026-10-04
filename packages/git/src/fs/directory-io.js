import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateStorageKey, storageFailure } from '../storage/store-contract.js';

/** Native File System Access operations, with optional worker-only sync handles. */
export class DirectoryIO {
  constructor({ directory, sync = false, maxValueBytes = 512 * 1024 * 1024 } = {}) {
    if (!directory || directory.kind !== 'directory') throw new TypeError('A FileSystemDirectoryHandle is required');
    this.directory = directory;
    this.sync = sync;
    this.maxValueBytes = maxValueBytes;
  }

  async parent(key, create = false) {
    const parts = validateStorageKey(key).split('/');
    let directory = this.directory;
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name: parts.at(-1) };
  }

  async get(key, { signal } = {}) {
    checkCancelled(signal);
    let handle;
    try {
      const { directory, name } = await this.parent(key);
      handle = await directory.getFileHandle(name);
    } catch (error) {
      if (error.name === 'NotFoundError') return undefined;
      throw storageFailure(error, 'read');
    }
    try {
      if (!this.sync) {
        const file = await handle.getFile();
        checkLimit(file.size, this.maxValueBytes, 'Repository file');
        const value = new Uint8Array(await file.arrayBuffer());
        checkCancelled(signal);
        return value;
      }
      if (!handle.createSyncAccessHandle) throw new GitError('Unsupported', 'OPFS synchronous access handles are unavailable');
      const access = await handle.createSyncAccessHandle();
      try {
        const value = new Uint8Array(checkLimit(access.getSize(), this.maxValueBytes, 'Repository file'));
        let offset = 0;
        while (offset < value.length) {
          checkCancelled(signal);
          const count = access.read(value.subarray(offset), { at: offset });
          if (!count) throw new GitError('Corrupt', 'Repository file ended before its reported size');
          offset += count;
        }
        return value;
      } finally { access.close(); }
    } catch (error) { throw storageFailure(error, 'read'); }
  }

  async set(key, value, { signal } = {}) {
    checkCancelled(signal);
    if (!(value instanceof Uint8Array)) throw new TypeError('Repository storage values must be Uint8Array');
    checkLimit(value.length, this.maxValueBytes, 'Repository file');
    try {
      const { directory, name } = await this.parent(key, true);
      const handle = await directory.getFileHandle(name, { create: true });
      if (!this.sync) {
        const writable = await handle.createWritable();
        try {
          await writable.write(value);
          checkCancelled(signal);
          await writable.close();
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
        return;
      }
      if (!handle.createSyncAccessHandle) throw new GitError('Unsupported', 'OPFS synchronous access handles are unavailable');
      const access = await handle.createSyncAccessHandle();
      try {
        let offset = 0;
        while (offset < value.length) {
          checkCancelled(signal);
          const count = access.write(value.subarray(offset), { at: offset });
          if (!count) throw new GitError('Quota', 'Repository filesystem accepted no more bytes');
          offset += count;
        }
        access.truncate(value.length);
        access.flush();
      } finally { access.close(); }
    } catch (error) { throw storageFailure(error, 'write'); }
  }

  async delete(key, { signal, recursive = false } = {}) {
    checkCancelled(signal);
    try {
      const { directory, name } = await this.parent(key);
      await directory.removeEntry(name, { recursive });
    } catch (error) {
      if (error.name !== 'NotFoundError') throw storageFailure(error, 'delete');
    }
  }

  async list(prefix = '', { signal, maxEntries = 1000000, maxDepth = 128 } = {}) {
    validateStorageKey(prefix, { prefix: true });
    const result = [];
    const pending = [{ directory: this.directory, path: '', depth: 0 }];
    while (pending.length) {
      checkCancelled(signal);
      const current = pending.pop();
      for await (const [name, entry] of current.directory.entries()) {
        const path = `${current.path}${name}`;
        if (!path.startsWith(prefix) && !prefix.startsWith(`${path}/`)) continue;
        if (entry.kind === 'directory') {
          checkLimit(current.depth + 1, maxDepth, 'Repository directory depth');
          pending.push({ directory: entry, path: `${path}/`, depth: current.depth + 1 });
        } else result.push(path);
        checkLimit(result.length + pending.length, maxEntries, 'Repository file count');
      }
    }
    return result.sort();
  }
}
