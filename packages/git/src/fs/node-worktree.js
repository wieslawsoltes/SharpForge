import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, readlink, rename, rmdir, symlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateCheckoutPath, validateSymlinkTarget } from '../path-safety.js';
import { scanNodeWorktree } from './node-worktree-scan.js';
import { readNodeWorktreeFiles, readNodeWorktreeBatches } from './node-worktree-read.js';
import { nodeWorktreeMode, nodeWorktreeStat, requireStableRead } from './node-worktree-stat.js';
import { NodeWorktreeSnapshots } from './node-worktree-snapshot.js';

async function* recordBatches(records, options = {}) {
  for await (const record of records) {
    checkCancelled(options.signal);
    yield [record];
  }
}

/** Node-only working tree supporting executable blobs and literal symbolic-link contents. */
export class NodeWorktree {
  #snapshots = new NodeWorktreeSnapshots();

  constructor(directory, { maxFileBytes = 64 * 1024 * 1024 } = {}) {
    if (typeof directory !== 'string' || !directory) throw new TypeError('A worktree directory path is required');
    this.directory = resolve(directory);
    this.maxFileBytes = maxFileBytes;
  }

  async #path(path, { create = false } = {}) {
    validateCheckoutPath(path);
    const root = await lstat(this.directory);
    if (root.isSymbolicLink() || !root.isDirectory()) {
      throw new GitError('Unsafe', 'Worktree root is not a regular directory', { path });
    }
    const parts = path.split('/');
    let current = this.directory;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      if (create) await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new GitError('Unsafe', 'Worktree parent is not a regular directory', { path });
    }
    return join(current, parts.at(-1));
  }

  async read(path, { signal } = {}) {
    checkCancelled(signal);
    const observedAt = BigInt(Date.now()) * 1000000n;
    let absolute;
    let stat;
    try { absolute = await this.#path(path); stat = await lstat(absolute, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isDirectory()) return null;
    if (stat.isSymbolicLink()) {
      const data = new TextEncoder().encode(await readlink(absolute));
      requireStableRead(stat, await lstat(absolute, { bigint: true }), path);
      return { data, mode: 0o120000, stat: nodeWorktreeStat(stat, observedAt) };
    }
    if (!stat.isFile()) throw new GitError('Unsafe', 'Unsupported worktree filesystem object', { path });
    checkLimit(Number(stat.size), this.maxFileBytes, 'Worktree file');
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      requireStableRead(stat, await handle.stat({ bigint: true }), path);
      const bytes = await handle.readFile({ signal });
      requireStableRead(stat, await handle.stat({ bigint: true }), path);
      return { data: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length).slice(),
        mode: nodeWorktreeMode(stat), stat: nodeWorktreeStat(stat, observedAt) };
    } finally { await handle.close(); }
  }

  async write(path, data, { mode = 0o100644, signal } = {}) {
    checkCancelled(signal);
    if (!(data instanceof Uint8Array)) throw new TypeError('Worktree data must be Uint8Array');
    checkLimit(data.length, this.maxFileBytes, 'Worktree file');
    if (![0o100644, 0o100755, 0o120000].includes(mode)) throw new GitError('Unsupported', 'Unsupported worktree file mode', { mode });
    const absolute = await this.#path(path, { create: true });
    const temporary = `${absolute}.sharpforge-write`;
    let created = false;
    try {
      if (mode === 0o120000) {
        const target = new TextDecoder('utf-8', { fatal: true }).decode(data);
        validateSymlinkTarget(path, target);
        await symlink(target, temporary);
        created = true;
      } else {
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o666);
        created = true;
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await chmod(temporary, mode === 0o100755 ? 0o755 : 0o644);
      }
      checkCancelled(signal);
      const previous = await lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (previous?.isDirectory()) throw new GitError('Conflict', 'Cannot overwrite a worktree directory with a file', { path });
      await rename(temporary, absolute);
      created = false;
    } catch (error) {
      if (error.code === 'EEXIST') throw new GitError('Conflict', 'Worktree write is already in progress', { path });
      if (error.code === 'ENOSPC' || error.code === 'EDQUOT') throw new GitError('Quota', 'Worktree filesystem quota exceeded');
      throw error;
    } finally { if (created) await unlink(temporary); }
  }

  async remove(path, { signal } = {}) {
    checkCancelled(signal);
    try {
      const absolute = await this.#path(path);
      const stat = await lstat(absolute);
      if (stat.isDirectory()) throw new GitError('Unsafe', 'Worktree removal requires a file path', { path });
      await unlink(absolute);
      let parent = dirname(absolute);
      while (parent !== this.directory) {
        try { await rmdir(parent); }
        catch (error) {
          if (['ENOTEMPTY', 'EEXIST', 'ERR_FS_EISDIR', 'EISDIR', 'EPERM'].includes(error.code)) break;
          throw error;
        }
        parent = dirname(parent);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  async list({ signal, maxEntries = 1000000, maxDepth = 128 } = {}) {
    const pending = [{ directory: this.directory, path: '', depth: 0 }];
    const result = [];
    while (pending.length) {
      checkCancelled(signal);
      const current = pending.pop();
      for (const entry of await readdir(current.directory, { withFileTypes: true })) {
        if (entry.name.toLowerCase() === '.git') continue;
        const path = `${current.path}${entry.name}`;
        validateCheckoutPath(path);
        if (entry.isDirectory()) {
          checkLimit(current.depth + 1, maxDepth, 'Worktree directory depth');
          pending.push({ directory: join(current.directory, entry.name), path: `${path}/`, depth: current.depth + 1 });
        } else if (entry.isFile() || entry.isSymbolicLink()) result.push(path);
        checkLimit(result.length + pending.length, maxEntries, 'Worktree file count');
      }
    }
    return result.sort();
  }

  /** Bounded metadata scan used by status; every call observes current filesystem entries. */
  scan(options) { return scanNodeWorktree(this, options, this.#snapshots); }

  /** Clear derived scan records and proofs; reuse always requires a fresh metadata check. */
  clearScanCache() { this.#snapshots.clear(); }

  /** Stream content for selected paths without one promise-based filesystem round trip per small file. */
  readMany(paths, options) { return readNodeWorktreeFiles(this, paths, options, this.#snapshots); }

  /** Status consumes verified small-file batches; large files remain individually bounded. */
  readBatches(paths, options) {
    return this.readMany === NodeWorktree.prototype.readMany
      ? readNodeWorktreeBatches(this, paths, options, this.#snapshots) : recordBatches(this.readMany(paths, options), options);
  }
}
