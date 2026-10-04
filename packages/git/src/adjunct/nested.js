import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { GitRepository } from '../repository.js';
import { ObjectDatabase } from '../odb.js';
import { GitExecutionPolicy } from '../policy.js';
import { FileSystemWorktree, KeyValueWorktree } from '../worktree.js';
import { validateCheckoutPath } from '../path-safety.js';
import { initializeRepositoryStore, readRepositoryMetadata } from '../fs/repository.js';
import { createPackReader } from '../pack/accessor.js';
import { ScopedRepositoryStore, ScopedWorktree } from './scoped-storage.js';
import { createLocalLfsAdapter } from './lfs.js';

const manifestKey = 'sharpforge/submodule.json';
const encode = value => new TextEncoder().encode(value);

async function nestedWorktree(parent, path, signal, create = true) {
  if (parent.directory?.kind === 'directory') {
    let directory = parent.directory;
    for (const component of path.split('/')) {
      checkCancelled(signal);
      try { directory = await directory.getDirectoryHandle(component, { create }); }
      catch (error) { if (!create && error.name === 'NotFoundError') return null; throw error; }
    }
    return new FileSystemWorktree(directory, { caseSensitive: parent.caseSensitive, maxFiles: parent.maxFiles });
  }
  if (parent instanceof KeyValueWorktree) return new KeyValueWorktree(parent.store, {
    prefix: parent.prefix + path + '/', caseSensitive: parent.caseSensitive
  });
  return new ScopedWorktree(parent, path);
}

async function inspectGitFile(worktree, expected, signal) {
  if (!worktree.directory) return null;
  checkCancelled(signal);
  try {
    const handle = await worktree.directory.getFileHandle('.git');
    const file = await handle.getFile();
    checkLimit(file.size, 32768, 'Submodule gitfile');
    if (await file.text() !== expected) throw new GitError('Conflict', 'Submodule path contains another Git repository');
    return handle;
  } catch (error) {
    if (error.name === 'NotFoundError') return null;
    if (error.name === 'TypeMismatchError') throw new GitError('Conflict', 'Submodule path contains an existing .git directory');
    throw error;
  }
}

async function writeGitFile(worktree, expected, signal) {
  if (!worktree.directory) return;
  if (await inspectGitFile(worktree, expected, signal)) return;
  const handle = await worktree.directory.getFileHandle('.git', { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.write(expected);
    checkCancelled(signal);
    await writer.close();
  } catch (error) { await writer.abort(); throw error; }
}

async function readChildIdentity(store, options) {
  const bytes = await store.get(manifestKey, options);
  if (!bytes) return null;
  checkLimit(bytes.length, 16384, 'Submodule identity');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new GitError('Corrupt', 'Invalid nested repository identity'); }
  if (!value || value.version !== 1 || typeof value.path !== 'string' || typeof value.url !== 'string') {
    throw new GitError('Corrupt', 'Invalid nested repository identity fields');
  }
  return value;
}

async function readOwnedMetadata(store, module, options) {
  const value = await readChildIdentity(store, options);
  if (!value) return null;
  if (value.path !== module.path || value.url !== module.url) {
    throw new GitError('Conflict', 'Nested repository identity differs from the trusted submodule');
  }
  return readRepositoryMetadata(store, options);
}

async function assembleChild(parent, components, options) {
  const { store, worktree, metadata } = components;
  const odb = new ObjectDatabase({ store, algorithm: metadata.algorithm });
  const readers = [];
  for (const id of await store.listPacks(options)) {
    readers.push(await createPackReader({ ...await store.readPack(id, options), algorithm: metadata.algorithm, ...options }));
  }
  odb.replacePackReaders(readers);
  const lfs = createLocalLfsAdapter(store);
  const policy = new GitExecutionPolicy({ notice: parent.policy.notice, signers: parent.policy.signers,
    filters: new Map([...parent.policy.filters, ['lfs', lfs]]) });
  const repository = new GitRepository({ ...metadata, odb, store, worktree, lfs, policy,
    dirtyBuffers: parent.dirtyBuffers ? child => parent.dirtyBuffers(components.path + '/' + child) : undefined });
  repository.setSubmoduleAdapter(createSubmoduleStateAdapter(repository, { depth: (options.depth ?? 0) + 1 }));
  await repository.loadIndex(options);
  await repository.loadRules(options);
  return repository;
}

/** Child status reads local owned metadata and treats nested Git repositories as opaque to the parent index. */
export function createSubmoduleStateAdapter(parent, { depth = 0 } = {}) {
  return { async state(path, options = {}) {
    checkLimit(depth, 8, 'Nested submodule status depth');
    const store = new ScopedRepositoryStore(parent.store, 'modules/' + validateCheckoutPath(path));
    let repository;
    try {
      const identity = await readChildIdentity(store, options);
      if (!identity) return { oid: null, initialized: false, modified: false, untracked: false };
      if (identity.path !== path) throw new GitError('Corrupt', 'Submodule identity path does not match its storage');
      const metadata = await readRepositoryMetadata(store, options);
      const oid = await metadata.refs.read('HEAD', options);
      const worktree = await nestedWorktree(parent.worktree, path, options.signal, false);
      if (!oid || !worktree) return { oid, initialized: false, modified: false, untracked: false };
      repository = await assembleChild(parent, { store, worktree, metadata, path }, { ...options, depth });
      const records = await repository.status(options);
      return { oid, initialized: true, modified: records.some(record => !['untracked', 'ignored'].includes(record.kind)),
        untracked: records.some(record => record.kind === 'untracked') };
    } finally { try { await repository?.dispose(); } finally { await store.close(); } }
  } };
}

async function childMetadata(store, module, options) {
  const existing = await readOwnedMetadata(store, module, options);
  if (existing) return existing;
  if ((await store.list('', options)).length) throw new GitError('Conflict', 'Submodule metadata belongs to an existing repository');
  await store.transaction(async transaction => {
    const view = { ...transaction, transaction: operation => operation(transaction) };
    await initializeRepositoryStore(view, options);
    await transaction.set(manifestKey, encode(JSON.stringify({ version: 1, path: module.path, url: module.url })));
  }, options);
  return readRepositoryMetadata(store, options);
}

/** Report only an owned child's persisted state; inspecting a submodule never creates storage or contacts a remote. */
export async function inspectSubmoduleRepository(parent, module, options = {}) {
  const store = new ScopedRepositoryStore(parent.store, 'modules/' + validateCheckoutPath(module.path));
  try {
    const metadata = await readOwnedMetadata(store, module, options);
    if (!metadata) return { state: 'uninitialized' };
    const oid = await metadata.refs.read('HEAD', options);
    return { state: oid ? 'initialized' : 'uninitialized', checkedOutOid: oid };
  } finally { await store.close(); }
}

/** Default browser child factory: native Git metadata namespace plus a worktree rooted at the trusted gitlink. */
export async function createSubmoduleRepository({ parent, path, module, signal }) {
  validateCheckoutPath(path);
  if (path !== module.path) throw new GitError('Unsafe', 'Nested repository path differs from its trusted gitlink');
  const entry = parent.index.get(path);
  if (entry?.mode !== 0o160000 || entry.oid !== module.oid) throw new GitError('Conflict', 'Submodule gitlink changed in the index', { path });
  const worktree = await nestedWorktree(parent.worktree, path, signal);
  const gitfile = 'gitdir: ' + '../'.repeat(path.split('/').length) + '.git/modules/' + path + '\n';
  const existingGitFile = await inspectGitFile(worktree, gitfile, signal);
  const store = new ScopedRepositoryStore(parent.store, 'modules/' + path);
  let repository;
  const dispose = async () => { try { await repository?.dispose(); } finally { await store.close(); } };
  try {
    const exists = await store.get(manifestKey, { signal });
    if (!exists && ((await worktree.list({ signal })).length || existingGitFile)) {
      throw new GitError('Conflict', 'Submodule destination is not an empty owned worktree', { path });
    }
    const metadata = await childMetadata(store, module, { algorithm: parent.algorithm, signal });
    if (metadata.algorithm !== parent.algorithm) throw new GitError('Unsupported', 'Submodule object format differs from its parent');
    repository = await assembleChild(parent, { store, worktree, metadata, path }, { signal });
    if (worktree.directory) {
      repository.config.set('core.worktree', '../'.repeat(path.split('/').length + 2) + path);
      await repository.config.save({ signal });
    }
    await writeGitFile(worktree, gitfile, signal);
    const initialized = !!await repository.refs.read('HEAD', { signal });
    return { repository, initialized, dispose };
  } catch (error) { await dispose(); throw error; }
}
