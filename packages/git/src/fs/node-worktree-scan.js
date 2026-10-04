import { lstatSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { validateCheckoutPath } from '../path-safety.js';
import { NodeWorktreeSnapshots } from './node-worktree-snapshot.js';

const statOptions = Object.freeze({ bigint: true, throwIfNoEntry: false });

/** Scan every current entry without opening file contents; yield between bounded metadata batches. */
export async function scanNodeWorktree(worktree, options = {}, snapshots = new NodeWorktreeSnapshots()) {
  const { signal, maxEntries = 1000000, maxDepth = 128, excludedPaths } = options;
  const pending = [{ directory: worktree.directory, path: '', depth: 0 }];
  const result = new Map();
  const parents = new Map();
  const validatedNames = snapshots.names;
  const observedAt = BigInt(Date.now()) * 1000000n;
  const recordOptions = { observedAt, maxEntries };
  let deadline = performance.now() + 8;
  let inspected = 0;
  while (pending.length) {
    checkCancelled(signal);
    const current = pending.pop();
    const directoryStat = lstatSync(current.directory, statOptions);
    if (!directoryStat) continue;
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new GitError('Unsafe', 'Worktree parent is not a regular directory', { path: current.path });
    }
    // Keep one fixed root proof plus at most maxEntries visited descendant proofs.
    checkLimit(parents.size, maxEntries, 'Worktree parent proof count');
    parents.set(current.path.slice(0, -1), { absolute: current.directory, stat: directoryStat });
    const absolutePrefix = current.directory.endsWith(sep) ? current.directory : current.directory + sep;
    for (const name of readdirSync(current.directory)) {
      checkCancelled(signal);
      if (name.toLowerCase() === '.git') continue;
      const path = current.path + name;
      if (!validatedNames.has(name)) {
        validateCheckoutPath(name);
        if (validatedNames.size >= maxEntries) validatedNames.clear();
        validatedNames.add(name);
      }
      checkLimit(path.length, 32768, 'Repository path length');
      const absolute = absolutePrefix + name;
      const stat = lstatSync(absolute, statOptions);
      if (!stat) continue;
      if (stat.isDirectory()) {
        if (excludedPaths?.has(path)) continue;
        checkLimit(current.depth + 1, maxDepth, 'Worktree directory depth');
        pending.push({ directory: absolute, path: `${path}/`, depth: current.depth + 1 });
      } else {
        checkLimit(Number(stat.size), worktree.maxFileBytes, 'Worktree file');
        result.set(path, snapshots.record(path, absolute, stat, recordOptions));
      }
      checkLimit(result.size + pending.length, maxEntries, 'Worktree file count');
      if (!(++inspected & 127) && performance.now() >= deadline) {
        await setImmediate();
        checkCancelled(signal);
        deadline = performance.now() + 8;
      }
    }
  }
  snapshots.finish(result, parents);
  return result;
}
