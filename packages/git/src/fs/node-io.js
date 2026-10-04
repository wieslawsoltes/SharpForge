import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateStorageKey } from '../storage/store-contract.js';

/** Node-only filesystem edge. Reject symlink traversal before reading Git metadata. */
export class NodeDirectoryIO {
  constructor({ directory, maxValueBytes = 512 * 1024 * 1024 } = {}) {
    if (typeof directory !== 'string' || !directory) throw new TypeError('A repository directory path is required');
    this.directory = resolve(directory);
    this.maxValueBytes = maxValueBytes;
  }

  async path(key, { create = false, allowMissing = false } = {}) {
    const parts = validateStorageKey(key).split('/');
    const root = await realpath(this.directory);
    if (root !== this.directory) throw new GitError('Unsafe', 'Repository metadata root cannot be a symbolic link');
    let current = root;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      if (create) await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await lstat(current).catch(error => {
        if (allowMissing && error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!stat) return null;
      if (stat.isSymbolicLink()) throw new GitError('Unsafe', 'Repository path traverses a symbolic link');
      if (!stat.isDirectory()) {
        if (allowMissing && stat.isFile()) return null;
        throw new GitError('Conflict', 'Repository directory is obstructed by a file', { key });
      }
    }
    return join(current, parts.at(-1));
  }

  async get(key, { signal } = {}) {
    checkCancelled(signal);
    let handle;
    try {
      const path = await this.path(key, { allowMissing: true });
      if (!path) return undefined;
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw new GitError('Unsafe', 'Repository metadata is a symbolic link');
      if (entry.isDirectory()) return undefined;
      if (!entry.isFile()) throw new GitError('Unsafe', 'Repository metadata must be a regular file');
      handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile()) throw new GitError('Unsafe', 'Repository metadata must be a regular file');
      checkLimit(stat.size, this.maxValueBytes, 'Repository file');
      const bytes = await handle.readFile({ signal });
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      if (error.code === 'ELOOP') throw new GitError('Unsafe', 'Repository metadata is a symbolic link');
      throw error;
    } finally { await handle?.close(); }
  }

  async delete(key) {
    try {
      const path = await this.path(key, { allowMissing: true });
      if (!path) return;
      const entry = await lstat(path);
      if (entry.isDirectory()) return;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new GitError('Unsafe', 'Repository metadata must be a regular file');
      await unlink(path);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  /** Publish a prepared native lock without following either repository path through a symlink. */
  async publish(key) {
    await rename(await this.path(`${key}.lock`), await this.path(key, { create: true }));
  }

  async list(prefix = '', { signal, maxEntries = 1000000, maxDepth = 128 } = {}) {
    validateStorageKey(prefix, { prefix: true });
    const pending = [{ directory: this.directory, path: '', depth: 0 }];
    const result = [];
    while (pending.length) {
      checkCancelled(signal);
      const current = pending.pop();
      for (const entry of await readdir(current.directory, { withFileTypes: true })) {
        const key = `${current.path}${entry.name}`;
        if (!key.startsWith(prefix) && !prefix.startsWith(`${key}/`)) continue;
        if (entry.isSymbolicLink()) throw new GitError('Unsafe', 'Repository metadata contains a symbolic link', { key });
        if (entry.isDirectory()) {
          checkLimit(current.depth + 1, maxDepth, 'Repository directory depth');
          pending.push({ directory: join(current.directory, entry.name), path: `${key}/`, depth: current.depth + 1 });
        } else if (entry.isFile()) result.push(key);
        checkLimit(result.length + pending.length, maxEntries, 'Repository file count');
      }
    }
    return result.sort();
  }
}
