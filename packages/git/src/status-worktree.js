import { checkCancelled } from './errors.js';
import { sameWorktreeStat } from './worktree-stat.js';
import { StatusContentCache } from './status-content-cache.js';
import { gitlinkPaths, gitlinkAncestor, readGitlinkState, submoduleStatus } from './gitlink-worktree.js';
import { classifyStatusIndex } from './status-index.js';

/** Share one current path snapshot between rule discovery and content comparison. */
export async function scanWorktree(repo, options = {}, indexState) {
  if (repo.worktree.scan) {
    return repo.worktree.scan({ ...options, excludedPaths: indexState?.gitlinks ?? gitlinkPaths(repo.index) });
  }
  return new Map((await repo.worktree.list(options)).map(path => [path, null]));
}

function readFiles(worktree, paths, options) {
  return worktree.readMany ? worktree.readMany(paths, options) : readIndividually(worktree, paths, options);
}

async function* readIndividually(worktree, paths, options) {
  for (const path of paths) yield [path, await worktree.read(path, options)];
}

function treeEntry(entry, path, file, cached, settings) {
  const mode = settings.filemode ? file.mode : entry?.mode ?? file.mode;
  if (settings.reuseEntries && cached.entry?.mode === mode) return cached.entry;
  const result = { path, oid: cached.oid, data: cached.data, stat: file.stat, mode };
  if (settings.reuseEntries) cached.entry = Object.freeze(result);
  return result;
}

/** Reuse content hashes only after current adapter metadata matches the prior stable read. */
export async function worktreeTree(repo, options = {}, snapshot, reuseEntries = false, indexState = classifyStatusIndex(repo.index)) {
  const result = new Map();
  const files = snapshot ?? await scanWorktree(repo, options, indexState);
  const gitlinks = indexState.gitlinks;
  const configuredMode = repo.config?.get('core.filemode');
  const settings = { filemode: configuredMode !== false && configuredMode !== 'false', reuseEntries };
  const pending = [];
  for (const [path, file] of files) {
    checkCancelled(options.signal);
    if (gitlinks.size && gitlinkAncestor(path, gitlinks)) continue;
    const entry = repo.index.get(path);
    if (entry?.skipWorktree) {
      result.set(path, entry);
      continue;
    }
    const cached = repo.statCache.get(path);
    if (file && cached?.mode === file.mode && sameWorktreeStat(file.stat, cached.stat)) {
      result.set(path, treeEntry(entry, path, file, cached, settings));
    } else pending.push(path);
  }
  const content = new StatusContentCache(repo.algorithm);
  const readOptions = { ...options, snapshot: files };
  const batched = typeof repo.worktree.readBatches === 'function';
  const source = batched ? repo.worktree.readBatches(pending, readOptions) : readFiles(repo.worktree, pending, readOptions);
  for await (const records of source) {
    for (const [path, file] of batched ? records : [records]) {
      checkCancelled(options.signal);
      if (!file) {
        repo.statCache.delete(path);
        continue;
      }
      const cleaned = repo.cleanForStatus ? repo.cleanForStatus(path, file.data, options) : repo.clean(path, file.data, options);
      const data = typeof cleaned?.then === 'function' ? await cleaned : cleaned;
      checkCancelled(options.signal);
      const digest = content.hash(data);
      const oid = typeof digest === 'string' ? digest : await digest;
      checkCancelled(options.signal);
      const cached = { mode: file.mode, stat: file.stat, oid, data };
      if (file.stat?.revision !== undefined || file.stat?.cacheable) repo.statCache.set(path, cached);
      else repo.statCache.delete(path);
      result.set(path, treeEntry(repo.index.get(path), path, file, cached, settings));
    }
  }
  for (const path of repo.statCache.keys()) if (!files.has(path)) repo.statCache.delete(path);
  for (const entry of indexState.special) {
    if (entry.stage !== 0 || result.has(entry.path)) continue;
    if (entry.mode === 0o160000) {
      const state = await readGitlinkState(repo, entry, options);
      result.set(entry.path, { ...entry, oid: state.oid ?? entry.oid,
        submoduleState: state, submodule: submoduleStatus(entry, state) });
    } else if (entry.skipWorktree) result.set(entry.path, entry);
  }
  return result;
}
