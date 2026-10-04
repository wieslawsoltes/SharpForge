import { GitError, checkCancelled } from './errors.js';
import { MemoryObjectDatabase, MemoryStore } from './memory-odb.js';
import { RefDatabase } from './refs.js';
import { GitConfig } from './config.js';
import { GitIndex, decodeIndex, encodeIndex } from './index-file.js';
import { MemoryWorktree } from './worktree.js';
import { CommitGraph } from './graph.js';
import { revParse } from './revparse.js';
import { readTree, writeTree, indexTree } from './worktree-tree.js';
import { IgnoreMatcher, compilePathspec } from './ignore.js';
import { AttributesMatcher } from './attributes.js';
import { smudgeEol } from './eol.js';
import { cleanWorktreeBytes } from './worktree-clean.js';
import { GitExecutionPolicy } from './policy.js';
import { status, worktreeTree } from './status.js';
import { addPaths, removePaths, movePath, unstagePaths, stagePatch } from './stage.js';
import { createCommit } from './commit.js';
import { checkout } from './checkout.js';
import { createBranch, deleteBranch, renameBranch, createTag, deleteTag } from './branch.js';
import { merge } from './merge/index.js';
import { rebase } from './rebase.js';
import { sequence } from './sequencer.js';
import { stash } from './stash.js';
import { reset, restore } from './reset.js';
import { treeDiff } from './diff/tree.js';
import { log } from './history.js';
import { blame } from './blame.js';
import { gitlinkPaths, gitlinkAncestor } from './gitlink-worktree.js';
import { WorktreeTreeCache } from './worktree-tree-cache.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sameBytes(left, right) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
  return true;
}

/** Portable local Git facade. External transports and account permissions are composed above this layer. */
export class GitRepository {
  constructor({ odb, refs, worktree, config, store, algorithm = 'sha1', dirtyBuffers,
    policy, globalExcludes = '', globalAttributes = '', maxEntries = 1000000, lfs, submoduleAdapter } = {}) {
    this.algorithm = algorithm;
    this.store = store ?? odb?.store ?? refs?.store ?? new MemoryStore();
    this.odb = odb ?? new MemoryObjectDatabase({ store: this.store, algorithm });
    this.refs = refs ?? new RefDatabase({ store: this.store, algorithm });
    this.worktree = worktree ?? new MemoryWorktree();
    this.config = config ?? new GitConfig({ store: this.store });
    this.index = new GitIndex();
    this.indexBytes = undefined;
    this.graph = new CommitGraph({ odb: this.odb, store: this.store, algorithm, maxCommits: maxEntries,
      onShallowChange: () => { this.history?.dispose(); this.views?.dispose(); } });
    this.dirtyBuffers = dirtyBuffers;
    this.policy = policy ?? new GitExecutionPolicy();
    this.globalExcludes = globalExcludes;
    this.globalAttributes = globalAttributes;
    this.ignore = new IgnoreMatcher();
    this.attributes = new AttributesMatcher();
    this.statCache = new Map();
    this.treeCache = new WorktreeTreeCache();
    this.maxEntries = maxEntries;
    this.pendingWrite = Promise.resolve();
    this.disposed = false;
    this.lfs = lfs;
    this.setSubmoduleAdapter(submoduleAdapter);
  }

  check(options = {}) {
    if (this.disposed) throw new GitError('Disposed', 'Repository has been disposed');
    checkCancelled(options.signal);
  }

  async init({ branch = 'main', ...options } = {}) {
    this.check(options);
    await this.config.load(options);
    if (!(await this.refs.read('HEAD', { deref: false }))) await this.refs.setSymbolic('HEAD', `refs/heads/${branch}`);
    if (!this.config.has('core.repositoryformatversion')) {
      this.config.set('core.repositoryformatversion', this.algorithm === 'sha256' ? 1 : 0);
      this.config.set('core.bare', false);
      if (this.algorithm === 'sha256') this.config.set('extensions.objectformat', 'sha256');
      await this.config.save(options);
    }
    await this.loadIndex(options);
    await this.loadRules(options);
    await this.refreshShallow(options);
    return this;
  }

  /** Reload authoritative shallow boundaries and invalidate any history derived from the previous graph. */
  async refreshShallow(options = {}) {
    this.check(options);
    return this.graph.refreshShallow(options);
  }

  async loadIndex(options = {}) {
    this.check(options);
    const bytes = await this.store.get('index', options);
    if (!this.index.dirty && sameBytes(bytes, this.indexBytes)) return this.index;
    this.index = bytes ? await decodeIndex(bytes, { algorithm: this.algorithm, maxEntries: this.maxEntries }) : new GitIndex();
    this.indexBytes = bytes;
    return this.index;
  }

  async replaceIndex(index, options = {}) {
    this.check(options);
    const bytes = await encodeIndex(index, { algorithm: this.algorithm });
    await this.store.transaction(async transaction => {
      const existing = await transaction.get('index');
      if (!options.forceIndex && !sameBytes(existing, this.indexBytes)) throw new GitError('Conflict', 'Git index changed concurrently');
      await transaction.set('index', bytes);
    }, options);
    this.index = await decodeIndex(bytes, { algorithm: this.algorithm, maxEntries: this.maxEntries });
    this.indexBytes = bytes;
    return this.index;
  }

  saveIndex(options = {}) { return this.replaceIndex(this.index, options); }
  async getIndex() { return this.index; }

  /** Bind local child inspection; no implicit network access or child initialization is permitted. */
  setSubmoduleAdapter(adapter) {
    this.check();
    if (adapter !== undefined && adapter !== null && typeof adapter.state !== 'function') {
      throw new GitError('Corrupt', 'Submodule adapter must expose an asynchronous state function');
    }
    this.submoduleAdapter = adapter ?? null;
    return this;
  }

  async loadRules(options = {}, snapshot, indexState) {
    this.check(options);
    this.ignore = new IgnoreMatcher();
    this.attributes = new AttributesMatcher();
    if (this.globalExcludes) this.ignore.add(this.globalExcludes, { source: 'global-excludes', priority: -20 });
    if (this.globalAttributes) this.attributes.add(this.globalAttributes, { source: 'global-attributes', priority: -20 });
    const exclude = await this.store.get('info/exclude', options);
    const sources = [this.globalExcludes, this.globalAttributes, this.config.toString(), exclude ? decoder.decode(exclude) : ''];
    if (exclude) this.ignore.add(decoder.decode(exclude), { source: '.git/info/exclude', priority: -10 });
    const gitlinks = indexState?.gitlinks ?? gitlinkPaths(this.index);
    const paths = (snapshot ? [...snapshot.keys()] : await this.worktree.list(options)).filter(path =>
      /(?:^|\/)\.git(?:ignore|attributes)$/u.test(path) && !gitlinkAncestor(path, gitlinks)).sort();
    for (const path of paths) {
      const file = await this.worktree.read(path, options);
      if (!file) continue;
      const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const matcher = path.endsWith('.gitignore') ? this.ignore : this.attributes;
      const text = decoder.decode(file.data);
      sources.push(path, text);
      matcher.add(text, { base, source: path });
    }
    const attributes = await this.store.get('info/attributes', options);
    if (attributes) this.attributes.add(decoder.decode(attributes), { source: '.git/info/attributes', priority: 1000 });
    sources.push(attributes ? decoder.decode(attributes) : '');
    const fingerprint = JSON.stringify(sources);
    if (fingerprint !== this.rulesFingerprint) this.statCache.clear();
    this.rulesFingerprint = fingerprint;
    this.policy.inspect(this.config);
  }

  eolOptions(path) {
    return { attributes: this.attributes.get(path), autocrlf: this.config.get('core.autocrlf', false),
      safecrlf: this.config.get('core.safecrlf', false), nativeEol: this.config.get('core.eol', 'lf'), notice: this.policy.notice };
  }

  async clean(path, bytes, options = {}) {
    return cleanWorktreeBytes(this, path, bytes, options);
  }

  /** Avoid an extra continuation for ordinary status files while preserving custom clean overrides. */
  cleanForStatus(path, bytes, options = {}) {
    return this.clean === GitRepository.prototype.clean
      ? cleanWorktreeBytes(this, path, bytes, options) : this.clean(path, bytes, options);
  }

  async smudge(path, bytes, options = {}) {
    this.check(options);
    const settings = this.eolOptions(path);
    const data = smudgeEol(bytes, settings);
    const name = settings.attributes.filter;
    const filter = typeof name === 'string' ? this.policy.filter(name) : null;
    return filter?.smudge ? filter.smudge(data, { path, ...options }) : data;
  }

  async snapshot(paths, options = {}) {
    this.check(options);
    const indexOid = await this.odb.write('blob', await encodeIndex(this.index, { algorithm: this.algorithm }), options);
    const files = [];
    for (const path of new Set(paths)) {
      const file = await this.worktree.read(path, options);
      files.push(file ? { path, mode: file.mode, oid: await this.odb.write('blob', file.data, options) } : { path, mode: null, oid: null });
    }
    return { indexOid, indexExists: this.indexBytes !== undefined, files,
      head: await this.refs.read('HEAD', { deref: false }), oid: await this.refs.read('HEAD') };
  }

  async restoreSnapshot(snapshot) {
    const failures = [];
    const removals = snapshot.files.filter(file => file.oid === null).sort((left, right) => right.path.length - left.path.length);
    for (const file of removals) {
      try { await this.worktree.remove(file.path); } catch (error) { failures.push({ path: file.path, message: error.message }); }
    }
    for (const file of snapshot.files.filter(entry => entry.oid !== null)) {
      try {
        await this.worktree.write(file.path, (await this.odb.read(file.oid)).data, { mode: file.mode });
      } catch (error) { failures.push({ path: file.path, message: error.message }); }
    }
    const bytes = (await this.odb.read(snapshot.indexOid)).data;
    if (snapshot.indexExists) await this.store.set('index', bytes);
    else await this.store.delete('index');
    this.index = await decodeIndex(bytes, { algorithm: this.algorithm });
    this.indexBytes = snapshot.indexExists ? bytes : undefined;
    this.statCache.clear();
    if (failures.length) throw new GitError('Conflict', 'Worktree rollback could not restore every file', { failures });
  }

  statePath(name) {
    if (!/^[a-zA-Z0-9_-]+$/u.test(name)) throw new GitError('Unsafe', 'Invalid repository operation state name');
    return ['MERGE_HEAD', 'MERGE_MSG', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].includes(name) ? name : `sharpforge/state/${name}.json`;
  }

  async readState(name) {
    const bytes = await this.store.get(this.statePath(name));
    if (!bytes) return null;
    const text = decoder.decode(bytes);
    if (name === 'MERGE_HEAD') return { oids: text.trim().split('\n') };
    if (name === 'MERGE_MSG') return { message: text };
    if (name === 'CHERRY_PICK_HEAD' || name === 'REVERT_HEAD') return { oid: text.trim() };
    try { return JSON.parse(text); } catch { throw new GitError('Corrupt', 'Malformed persisted operation state', { name }); }
  }

  async writeState(name, value) {
    let text;
    if (name === 'MERGE_HEAD') text = `${value.oids.join('\n')}\n`;
    else if (name === 'MERGE_MSG') text = value.message;
    else if (name === 'CHERRY_PICK_HEAD' || name === 'REVERT_HEAD') text = `${value.oid}\n`;
    else text = JSON.stringify(value);
    await this.store.set(this.statePath(name), encoder.encode(text));
  }

  async deleteState(name) { await this.store.delete(this.statePath(name)); }

  /** Serialize mutating facade calls; failures do not poison the operation queue. */
  mutate(operation, options = {}) {
    const result = this.pendingWrite.then(() => { this.check(options); return operation(); });
    this.pendingWrite = result.catch(() => {});
    return result;
  }

  readCommit(oid, options) { return this.graph.read(oid, options); }
  readTree(revision, options) { return readTree(this, revision, options); }
  revParse(expression, options) { return revParse(this, expression, options); }
  writeTree(options) { return writeTree(this, options); }
  status(options) { return status(this, options); }
  log(options) { return log(this, options); }
  blame(path, options) { return blame(this, path, options); }
  add(paths, options) { return this.mutate(() => addPaths(this, paths, options), options); }
  remove(paths, options) { return this.mutate(() => removePaths(this, paths, options), options); }
  move(source, target, options) { return this.mutate(() => movePath(this, source, target, options), options); }
  unstage(paths, options) { return this.mutate(() => unstagePaths(this, paths, options), options); }
  stagePatch(path, patch, options) { return this.mutate(() => stagePatch(this, path, patch, options), options); }
  commit(options) { return this.mutate(() => createCommit(this, options), options); }
  checkout(revision, options) { return this.mutate(() => checkout(this, revision, options), options); }
  merge(revision, options) { return this.mutate(() => merge(this, revision, options), options); }
  rebase(onto, options) { return this.mutate(() => rebase(this, onto, options), options); }
  cherryPick(revisions, options) { return this.mutate(() => sequence(this, 'cherry-pick', revisions, options), options); }
  revert(revisions, options) { return this.mutate(() => sequence(this, 'revert', revisions, options), options); }
  stash(action = 'push', options) { return this.mutate(() => stash(this, action, options), options); }
  reset(revision, options) { return this.mutate(() => reset(this, revision, options), options); }
  restore(paths, options) { return this.mutate(() => restore(this, paths, options), options); }

  branch(name, options = {}) {
    if (!name || options.list) return this.refs.list('refs/heads/', options);
    return this.mutate(() => options.delete ? deleteBranch(this, name, options)
      : options.rename ? renameBranch(this, name, options.rename, options) : createBranch(this, name, options), options);
  }

  tag(name, options = {}) {
    if (!name || options.list) return this.refs.list('refs/tags/', options);
    return this.mutate(() => options.delete ? deleteTag(this, name, options) : createTag(this, name, options), options);
  }

  async diff(options = {}) {
    await this.loadRules(options);
    const before = options.from ? await this.readTree(options.from, options)
      : options.staged ? await this.readTree('HEAD', options) : indexTree(this.index);
    const after = options.to ? await this.readTree(options.to, options)
      : options.staged ? indexTree(this.index) : await worktreeTree(this, options);
    if (!options.from && !options.to && !options.staged && !options.untracked) {
      const tracked = new Set(this.index.entries.map(entry => entry.path));
      for (const path of after.keys()) if (!tracked.has(path)) after.delete(path);
    }
    return treeDiff(this, before, after, options);
  }

  /** Replace a transport-aware object wrapper while retaining ownership of the original store. */
  replaceObjectDatabase(odb) {
    this.check();
    if (!odb || typeof odb.read !== 'function' || typeof odb.write !== 'function' || odb.algorithm !== this.algorithm) {
      throw new GitError('Corrupt', 'Replacement object database must use this repository object format');
    }
    this.odb = odb;
    this.graph.odb = odb;
    this.graph.cache.clear();
    this.graph.generations.clear();
    this.statCache.clear();
    this.treeCache.clear();
    this.history?.dispose();
    this.views?.dispose();
    return this;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.statCache.clear();
    this.treeCache.clear();
    this.graph.cache.clear();
    this.graph.generations.clear();
    this.history?.dispose();
    this.views?.dispose();
    this.odb.dispose?.();
  }
}
