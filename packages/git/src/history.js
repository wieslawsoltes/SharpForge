import { GitError, checkCancelled, checkLimit } from './errors.js';

/** Immutable-object caches belong to a repository session, never to a global singleton. */
export class GitHistory {
  constructor(repository, { cacheEntries = 64, cacheBytes = 16 * 1024 * 1024 } = {}) {
    this.repository = repository;
    this.cacheEntries = checkLimit(cacheEntries, 4096, 'History cache entries');
    this.trees = new Map();
    this.blobs = new Map();
    this.blames = new Map();
    this.maxCacheBytes = checkLimit(cacheBytes, 256 * 1024 * 1024, 'History cache bytes');
    this.weights = new Map([this.trees, this.blobs, this.blames].map(cache => [cache, { sizes: new Map(), bytes: 0 }]));
  }

  async tree(revision, options) {
    return this.cached(this.trees, revision, () => this.repository.readTree(revision, options));
  }

  async text(oid, options) {
    return this.cached(this.blobs, oid, async () => {
      const object = await this.repository.odb.read(oid, options);
      if (object.type !== 'blob') throw new GitError('Corrupt', 'History path does not point to a blob');
      if (object.data.includes(0)) throw new GitError('Unsupported', 'Line history is unavailable for binary files');
      try { return new TextDecoder('utf-8', { fatal: true }).decode(object.data); }
      catch { throw new GitError('Unsupported', 'Line history requires UTF-8 text'); }
    });
  }

  async cached(cache, key, factory) {
    if (cache.has(key)) {
      const value = cache.get(key);
      cache.delete(key);
      cache.set(key, value);
      return value;
    }
    const value = await factory();
    this.remember(cache, key, value);
    return value;
  }

  remember(cache, key, value) {
    const weight = typeof value === 'string' ? value.length * 2 : value instanceof Map
      ? [...value.keys()].reduce((bytes, path) => bytes + path.length * 2 + 128, 0)
      : Array.isArray(value) ? value.reduce((bytes, item) => bytes + (item.text?.length ?? 0) * 2 + 256, 0) : 128;
    if (!this.cacheEntries || weight > this.maxCacheBytes) return value;
    const metadata = this.weights.get(cache);
    metadata.bytes -= metadata.sizes.get(key) ?? 0;
    cache.delete(key);
    cache.set(key, value);
    metadata.sizes.set(key, weight);
    metadata.bytes += weight;
    while (cache.size > this.cacheEntries || metadata.bytes > this.maxCacheBytes) {
      const oldest = cache.keys().next().value;
      metadata.bytes -= metadata.sizes.get(oldest);
      metadata.sizes.delete(oldest);
      cache.delete(oldest);
    }
    return value;
  }

  dispose() {
    this.trees.clear();
    this.blobs.clear();
    this.blames.clear();
    for (const metadata of this.weights.values()) { metadata.sizes.clear(); metadata.bytes = 0; }
  }
}

export function historySession(repository) {
  if (!repository.history) repository.history = new GitHistory(repository);
  return repository.history;
}

/** Follow exact renames first, then compare bounded candidate line histograms. */
export async function previousPath(history, before, after, path, options = {}) {
  if (before.has(path)) return path;
  const current = after.get(path);
  if (!current || options.follow === false) return null;
  const deleted = [];
  for (const [name, entry] of before) {
    if (after.has(name) || entry.mode === 0o160000) continue;
    if (entry.oid === current.oid) return name;
    deleted.push([name, entry]);
  }
  const limit = options.renameLimit ?? 200;
  checkLimit(limit, 10000, 'Rename candidates');
  if (deleted.length > limit) return null;
  const currentText = await history.text(current.oid, options).catch(error => {
    if (error.code === 'Unsupported') return null;
    throw error;
  });
  if (currentText === null) return null;
  const wanted = lineHistogram(currentText);
  let best = null;
  let bestScore = options.renameThreshold ?? 0.5;
  for (const [name, entry] of deleted) {
    checkCancelled(options.signal);
    let text;
    try { text = await history.text(entry.oid, options); }
    catch (error) { if (error.code === 'Unsupported') continue; throw error; }
    const candidate = lineHistogram(text);
    let common = 0;
    for (const [line, count] of wanted.counts) common += Math.min(count, candidate.counts.get(line) ?? 0) * line.length;
    const score = 2 * common / Math.max(1, wanted.bytes + candidate.bytes);
    if (score > bestScore || score === bestScore && (best === null || name < best)) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

function lineHistogram(text) {
  const counts = new Map();
  let bytes = 0;
  for (const line of splitHistoryLines(text)) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
    bytes += line.length;
  }
  return { counts, bytes };
}

export function splitHistoryLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Return commits without touching the index, worktree, editor buffers or HEAD. */
export async function log(repository, options = {}) {
  const { signal, path, follow = false, firstParent = false, reverse = false } = options;
  const maxCount = checkLimit(options.maxCount ?? 100, 100000, 'History result count');
  const skip = checkLimit(options.skip ?? 0, 1000000, 'History skip count');
  if (!maxCount) return [];
  const history = historySession(repository);
  if (!options.all && (!options.revision || options.revision === 'HEAD') && !await repository.refs.read('HEAD', { signal })) return [];
  const names = options.all ? (await repository.refs.list('refs/', { signal })).filter(ref => ref.oid).map(ref => ref.name)
    : [options.revision ?? 'HEAD'];
  const tips = [];
  const selected = new Set();
  for (const name of names) {
    const oid = await repository.revParse(`${name}^{}`, { signal });
    if (selected.has(oid)) continue;
    if ((await repository.odb.read(oid, { signal })).type === 'commit') { selected.add(oid); tips.push(oid); }
  }
  const commits = await repository.graph.walk(tips, {
    signal, exclude: options.exclude ?? [], order: options.order ?? 'topo',
    maxCommits: options.maxCommits ?? 100000
  });
  const result = [];
  const permitted = firstParent ? firstParentSet(commits, tips) : null;
  let currentPath = path;
  let accepted = 0;
  for (const commit of commits) {
    checkCancelled(signal);
    if (permitted && !permitted.has(commit.oid)) continue;
    let changed = true;
    let oldPath = currentPath;
    if (currentPath) {
      const after = await history.tree(commit.oid, { signal });
      const parent = commit.parents?.[0];
      const before = parent ? await history.tree(parent, { signal }) : new Map();
      oldPath = await previousPath(history, before, after, currentPath, { ...options, follow });
      const left = oldPath ? before.get(oldPath) : undefined;
      const right = after.get(currentPath);
      changed = left?.oid !== right?.oid || left?.mode !== right?.mode || oldPath !== currentPath && !!right;
    }
    if (changed && matchesFilters(commit, options)) {
      if (accepted++ >= skip) result.push(Object.freeze({ ...commit, path: currentPath, previousPath: oldPath }));
      if (result.length >= maxCount) break;
    }
    if (follow && oldPath) currentPath = oldPath;
  }
  if (reverse) result.reverse();
  return result;
}

function firstParentSet(commits, tips) {
  const byId = new Map(commits.map(commit => [commit.oid, commit]));
  const included = new Set();
  for (let oid of tips) {
    while (oid && !included.has(oid)) {
      included.add(oid);
      oid = byId.get(oid)?.parents?.[0];
    }
  }
  return included;
}

function matchesFilters(commit, options) {
  const identity = commit.author;
  const author = typeof identity === 'string' ? identity : `${identity?.name ?? ''} <${identity?.email ?? ''}>`;
  const timestamp = typeof commit.committer === 'object' ? commit.committer.timestamp : null;
  if (options.author && !author.toLowerCase().includes(String(options.author).toLowerCase())) return false;
  if (options.since !== undefined && timestamp !== null && timestamp < options.since) return false;
  if (options.until !== undefined && timestamp !== null && timestamp > options.until) return false;
  const search = options.search ?? options.grep;
  if (search && !commit.message.includes(search)) return false;
  return true;
}
