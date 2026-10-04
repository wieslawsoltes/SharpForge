import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { GitError } from '../errors.js';
import { FsObjectDatabase } from '../fs-odb.js';
import { NodeFileStore } from './node-store.js';
import { NodeWorktree } from './node-worktree.js';
import { initializeRepositoryStore, readRepositoryMetadata } from './repository.js';
import { decodeStorageText } from '../storage/store-contract.js';

async function metadataPath(directory, bare, create = false) {
  const root = resolve(directory);
  if (create) await mkdir(root, { recursive: true });
  const canonical = await realpath(root);
  const metadata = bare ? canonical : join(canonical, '.git');
  if (create) await mkdir(metadata, { recursive: true });
  const stat = await lstat(metadata).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (!stat) throw new GitError('NotFound', 'The directory has no .git metadata');
  if (stat.isSymbolicLink()) throw new GitError('Unsafe', 'Git metadata directory cannot be a symbolic link');
  if (!stat.isDirectory()) throw new GitError('Unsupported', 'Linked-worktree .git files require an explicitly resolved common directory');
  return { directory: canonical, metadata };
}

/** Open an existing native repository, with optional explicitly granted alternate ODBs. */
export async function openNodeRepository({ directory, bare = false, signal, ...options } = {}) {
  const paths = await metadataPath(directory, bare);
  const store = new NodeFileStore({ ...options, directory: paths.metadata });
  const { config, refs, algorithm } = await readRepositoryMetadata(store, { signal });
  const odb = new FsObjectDatabase({ ...options, store, algorithm });
  await odb.loadPacks({ signal });
  const alternates = decodeStorageText(await store.get('objects/info/alternates', { signal }));
  if (alternates?.trim() && !options.alternates?.length) {
    throw new GitError('Unsupported', 'Filesystem alternate object directories must be supplied explicitly');
  }
  const worktree = bare || config.getBoolean('core.bare', false) ? undefined : new NodeWorktree(paths.directory, options);
  return { odb, refs, config, store, worktree, directory: paths.directory, gitDirectory: paths.metadata,
    algorithm, capabilities: store.capabilities };
}

/** Create command-line-Git-compatible metadata in a native working tree or bare directory. */
export async function initNodeRepository({ directory, bare = false, signal, ...options } = {}) {
  const paths = await metadataPath(directory, bare, true);
  await mkdir(join(paths.metadata, 'objects'), { recursive: true });
  await mkdir(join(paths.metadata, 'refs'), { recursive: true });
  const store = new NodeFileStore({ ...options, directory: paths.metadata });
  await initializeRepositoryStore(store, { ...options, bare, filemode: true, signal });
  await store.close();
  return openNodeRepository({ directory: paths.directory, bare, signal, ...options });
}

export { NodeFileStore } from './node-store.js';
export { NodeWorktree } from './node-worktree.js';
