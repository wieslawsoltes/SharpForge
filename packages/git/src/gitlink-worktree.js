import { GitError, checkCancelled } from './errors.js';

/** Indexed gitlinks are opaque worktree roots, including unresolved gitlink stages. */
export function gitlinkPaths(index) {
  return new Set(index.entries.filter(entry => entry.mode === 0o160000).map(entry => entry.path));
}

/** Return the nearest indexed gitlink containing a child path, excluding the root itself. */
export function gitlinkAncestor(path, roots) {
  let current = path;
  while (current.includes('/')) {
    current = current.slice(0, current.lastIndexOf('/'));
    if (roots.has(current)) return current;
  }
  return null;
}

/** Inspect an explicitly configured child repository without reading gitlink objects from the parent ODB. */
export async function readGitlinkState(repo, entry, options = {}) {
  checkCancelled(options.signal);
  const state = await repo.submoduleAdapter?.state(entry.path, { ...options, indexOid: entry.oid });
  checkCancelled(options.signal);
  if (!state?.initialized) return { oid: entry.oid, initialized: false, modified: false, untracked: false };
  const length = repo.algorithm === 'sha256' ? 64 : 40;
  if (state.oid !== null && (typeof state.oid !== 'string' || state.oid.length !== length || !/^[a-f0-9]+$/u.test(state.oid))) {
    throw new GitError('Corrupt', 'Initialized submodule returned an invalid HEAD object ID', { path: entry.path });
  }
  return { oid: state.oid, initialized: true, modified: !!state.modified, untracked: !!state.untracked };
}

export function submoduleStatus(entry, state) {
  return `S${state.oid !== entry.oid ? 'C' : '.'}${state.modified ? 'M' : '.'}${state.untracked ? 'U' : '.'}`;
}
