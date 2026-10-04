import { GitError } from './errors.js';
import { ObjectDatabase } from './odb.js';
import { FileSystemStore } from './fs/directory-store.js';
import { initializeRepositoryStore, readRepositoryMetadata } from './fs/repository.js';
import { createPackReader } from './pack/accessor.js';
import { FileSystemWorktree } from './worktree.js';

/** Object database using native loose-object and pack paths in a picked .git directory. */
export class FsObjectDatabase extends ObjectDatabase {
  constructor({ directory, ...options } = {}) {
    super({ ...options, store: options.store ?? new FileSystemStore({ directory, ...options }) });
    this.directory = directory;
  }

  async loadPacks({ signal } = {}) {
    const readers = [];
    for (const id of await this.store.listPacks({ signal })) {
      const { pack, index } = await this.store.readPack(id, { signal });
      readers.push(await createPackReader({ pack, index, algorithm: this.algorithm, signal }));
    }
    this.replacePackReaders(readers);
    return this;
  }
}

async function gitDirectory(directory, { bare, create }) {
  if (!directory || directory.kind !== 'directory') throw new TypeError('A FileSystemDirectoryHandle is required');
  if (bare) return directory;
  try { return await directory.getDirectoryHandle('.git', { create }); } catch (error) {
    if (error.name === 'TypeMismatchError') {
      throw new GitError('Unsupported', 'A linked worktree .git file requires its common-directory handle to be supplied explicitly');
    }
    if (error.name === 'NotFoundError') throw new GitError('NotFound', 'The selected folder has no .git directory');
    throw GitError.from(error);
  }
}

/** Open a real repository without relaxing workspace .git exclusions outside this Git-only path. */
export async function openLocalRepository({ directory, bare = false, signal, ...options } = {}) {
  const metadata = await gitDirectory(directory, { bare, create: false });
  const store = new FileSystemStore({ directory: metadata, ...options });
  const { config, refs, algorithm } = await readRepositoryMetadata(store, { signal });
  const odb = new FsObjectDatabase({ ...options, directory: metadata, store, algorithm });
  await odb.loadPacks({ signal });
  const alternates = await store.get('objects/info/alternates', { signal });
  if (alternates?.length && !options.alternates?.length) {
    throw new GitError('Unsupported', 'Filesystem alternate object directories require explicit directory grants');
  }
  const worktree = bare || config.getBoolean('core.bare', false) ? undefined : new FileSystemWorktree(directory);
  return { odb, refs, config, store, worktree, directory, gitDirectory: metadata, algorithm, capabilities: store.capabilities };
}

export async function initLocalRepository({ directory, bare = false, signal, ...options } = {}) {
  const metadata = await gitDirectory(directory, { bare, create: true });
  await metadata.getDirectoryHandle('objects', { create: true });
  await metadata.getDirectoryHandle('refs', { create: true });
  const store = new FileSystemStore({ directory: metadata, ...options });
  await initializeRepositoryStore(store, { ...options, bare, signal });
  await store.close();
  return openLocalRepository({ directory, bare, signal, ...options });
}

export { FileSystemStore } from './fs/directory-store.js';
