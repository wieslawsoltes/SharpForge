import { normalizePath, directoryName } from '../paths.js';
import { EvaluationError } from './errors.js';

function globSource(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        index++;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return source + '$';
}

/** Match logical paths with MSBuild *, ? and zero-or-more-directory ** semantics. */
export function matchesGlob(path, pattern, { caseSensitive = true } = {}) {
  if (String(pattern).length > 4096) throw new EvaluationError('Glob pattern limit exceeded.', 'MSB0001');
  return new RegExp(globSource(String(pattern).replaceAll('\\', '/')), caseSensitive ? '' : 'i').test(path);
}

function node() {
  return { children: new Map(), files: new Map() };
}

/** Directory trie: Exists is O(path depth), glob scans only the literal-prefix subtree. */
export class WorkspacePathIndex {
  constructor(paths = [], { caseSensitive = true, maxMatches = 100000 } = {}) {
    this.caseSensitive = caseSensitive;
    this.maxMatches = maxMatches;
    this.root = node();
    this.paths = new Map();
    this.patterns = new Map();
    this.version = 0;
    this.counters = { exists: 0, directorySteps: 0, globCandidates: 0, globQueries: 0 };
    for (const path of paths) this.add(path);
  }

  key(value) {
    return this.caseSensitive ? value : value.toLowerCase();
  }

  add(path) {
    path = normalizePath(path);
    const parts = path.split('/');
    let parent = this.root;
    for (const part of parts.slice(0, -1)) {
      const key = this.key(part);
      if (!parent.children.has(key)) parent.children.set(key, node());
      parent = parent.children.get(key);
    }
    parent.files.set(this.key(parts.at(-1)), path);
    this.paths.set(this.key(path), path);
    this.version++;
  }

  addDirectory(path) {
    let parent = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      const key = this.key(part);
      if (!parent.children.has(key)) parent.children.set(key, node());
      parent = parent.children.get(key);
    }
    this.version++;
  }

  removeDirectory(path) {
    const parent = this.directory(directoryName(path));
    parent?.children.delete(this.key(path.split('/').at(-1)));
    this.version++;
  }

  remove(path) {
    const parent = this.directory(directoryName(path));
    parent?.files.delete(this.key(path.split('/').at(-1)));
    this.paths.delete(this.key(path));
    this.version++;
  }

  directory(path) {
    let parent = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      this.counters.directorySteps++;
      parent = parent.children.get(this.key(part));
      if (!parent) break;
    }
    return parent;
  }

  exists(path) {
    this.counters.exists++;
    return this.paths.has(this.key(path)) || Boolean(this.directory(path));
  }

  canonical(path) {
    return this.paths.get(this.key(path)) ?? path;
  }

  matcher(pattern, { caseSensitive = this.caseSensitive } = {}) {
    if (pattern.length > 4096) throw new EvaluationError('Glob pattern limit exceeded.', 'MSB0001');
    const key = (caseSensitive ? 's:' : 'i:') + (caseSensitive ? pattern : pattern.toLowerCase());
    if (!this.patterns.has(key)) {
      if (this.patterns.size >= 2048) this.patterns.clear();
      this.patterns.set(key, new RegExp(globSource(pattern), caseSensitive ? '' : 'i'));
    }
    return this.patterns.get(key);
  }

  glob(pattern, excludes = []) {
    this.counters.globQueries++;
    const firstWildcard = pattern.search(/[*?]/);
    if (firstWildcard < 0) {
      return this.paths.has(this.key(pattern)) && !excludes.some(value => this.matcher(value).test(pattern))
        ? [this.canonical(pattern)] : [];
    }
    const prefix = pattern.slice(0, firstWildcard);
    const start = this.directory(prefix.slice(0, Math.max(0, prefix.lastIndexOf('/'))));
    if (!start) return [];
    const include = this.matcher(pattern);
    const omit = excludes.map(value => this.matcher(value));
    const output = [];
    const pending = [start];
    while (pending.length) {
      const current = pending.pop();
      for (const path of current.files.values()) {
        this.counters.globCandidates++;
        if (omit.some(regex => regex.test(path)) || !include.test(path)) continue;
        output.push(path);
        if (output.length > this.maxMatches) throw new EvaluationError('Glob result limit exceeded.', 'MSB0001');
      }
      for (const child of current.children.values()) pending.push(child);
    }
    return output.sort();
  }
}
