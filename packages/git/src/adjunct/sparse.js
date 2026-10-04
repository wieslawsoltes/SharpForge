import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { SparseCheckout, applySparseCheckout } from '../sparse.js';

export async function sparseCheckoutStatus(repo, options = {}) {
  const bytes = await repo.store.get('info/sparse-checkout', options);
  const cone = bytes ? SparseCheckout.fromPatterns(bytes) : null;
  return { enabled: repo.config.getBoolean('core.sparsecheckout', false), directories: cone?.directories ?? [],
    skipped: repo.index.entries.filter(entry => entry.skipWorktree).length };
}

/** Integrate sparse worktree/index/config changes with existing snapshot rollback and editor guards. */
export async function setRepositorySparseCheckout(repo, options = {}) {
  await repo.loadIndex(options);
  const cone = new SparseCheckout(options.disable ? [''] : options.directories ?? []);
  const affected = [];
  let snapshotBytes = 0;
  for (const entry of repo.index.entries) {
    checkCancelled(options.signal);
    const current = await repo.worktree.read(entry.path, options);
    if (cone.includes(entry.path) === !!current) continue;
    if (repo.dirtyBuffers && await repo.dirtyBuffers(entry.path)) {
      throw new GitError('Conflict', 'Sparse checkout would overwrite an editor buffer', { path: entry.path });
    }
    affected.push(entry.path);
    snapshotBytes += current?.data.length ?? 0;
    checkLimit(snapshotBytes, options.maxSnapshotBytes ?? 128 * 1024 * 1024, 'Sparse rollback data');
  }
  const snapshot = await repo.snapshot(affected, options);
  const config = await repo.store.get('config', options);
  const patterns = await repo.store.get('info/sparse-checkout', options);
  try {
    const result = await applySparseCheckout({
      ...options, cone, index: repo.index, worktree: repo.worktree, odb: repo.odb, store: repo.store, algorithm: repo.algorithm,
      clean: (path, bytes) => repo.clean(path, bytes, options), smudge: (path, bytes) => repo.smudge(path, bytes, options),
      saveIndex: index => repo.replaceIndex(index, options)
    });
    repo.config.set('core.sparsecheckout', !options.disable);
    repo.config.set('core.sparsecheckoutcone', true);
    await repo.config.save(options);
    return { directories: cone.directories, written: result.written, removed: result.removed, enabled: !options.disable };
  } catch (error) {
    await repo.restoreSnapshot(snapshot);
    await repo.store.transaction(async transaction => {
      for (const [key, bytes] of [['config', config], ['info/sparse-checkout', patterns]]) {
        if (bytes === undefined) await transaction.delete(key);
        else await transaction.set(key, bytes);
      }
    });
    await repo.config.load();
    throw error;
  }
}
