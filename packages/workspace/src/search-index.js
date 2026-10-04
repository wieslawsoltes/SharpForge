import {decodeWorkspaceFile, isWorkspaceTextPath} from '@sharpforge/archive';
import {FileSystemError, throwIfCancelled} from './vfs/provider.js';

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

function fuzzyScore(text, query) {
  let cursor = 0;
  let gaps = 0;
  let previous = -1;
  for (const character of query) {
    const position = text.indexOf(character, cursor);
    if (position < 0) return null;
    gaps += previous < 0 ? position : position - previous - 1;
    previous = position;
    cursor = position + 1;
  }
  return query.length * 10 - gaps - (text.length - query.length) / 100;
}

/** Incremental path postings with bounded decoded-text LRU. Content results stream without loading every closed file. */
export class WorkspaceSearchIndex {
  constructor(provider, {maxEntries = 100000, maxIndexBytes = 32 * 1024 * 1024, maxContentBytes = 16 * 1024 * 1024,
    maxFileBytes = 8 * 1024 * 1024, yieldEvery = 128, onDiagnostic = () => {}} = {}) {
    this.provider = provider;
    this.maxEntries = maxEntries;
    this.maxIndexBytes = maxIndexBytes;
    this.maxContentBytes = maxContentBytes;
    this.maxFileBytes = maxFileBytes;
    this.yieldEvery = yieldEvery;
    this.onDiagnostic = onDiagnostic;
    this.entries = new Map();
    this.postings = new Map();
    this.contents = new Map();
    this.indexBytes = 0;
    this.contentBytes = 0;
    this.disposed = false;
    this.subscription = null;
    this.watchGeneration = 0;
    this.pendingStats = new Map();
    this.abort = new AbortController();
    this.metrics = {contentReads: 0, contentHits: 0, searchedFiles: 0};
  }

  check(signal) {
    throwIfCancelled(signal);
    if (this.disposed) throw new FileSystemError('Disposed', '', 'Search index is disposed');
  }

  upsert(record) {
    this.check();
    const path = this.provider.check(record.path ?? record.uri, {allowRoot: false});
    this.pendingStats.delete(path);
    const folded = path.normalize('NFC').toLowerCase();
    const characters = new Set(folded);
    const cost = path.length * 4 + characters.size * 16 + 128;
    const previous = this.entries.get(path);
    if (!previous && this.entries.size >= this.maxEntries || this.indexBytes - (previous?.cost ?? 0) + cost > this.maxIndexBytes) {
      throw new FileSystemError('QuotaExceeded', path, 'Search path index byte/entry budget exceeded');
    }
    if (previous) this.remove(path);
    const entry = {path, size: record.size ?? record.bytes?.length, mtime: record.mtime, version: record.version,
      generation: 0, folded, characters, cost};
    this.entries.set(path, entry);
    this.indexBytes += cost;
    for (const character of characters) {
      let paths = this.postings.get(character);
      if (!paths) this.postings.set(character, paths = new Set());
      paths.add(path);
    }
  }

  remove(path) {
    this.pendingStats.delete(path);
    const entry = this.entries.get(path);
    if (!entry) return false;
    this.entries.delete(path);
    this.indexBytes -= entry.cost;
    for (const character of entry.characters) {
      const paths = this.postings.get(character);
      paths.delete(path);
      if (!paths.size) this.postings.delete(character);
    }
    this.invalidate(path);
    return true;
  }

  invalidate(path) {
    this.pendingStats.delete(path);
    const entry = this.entries.get(path);
    if (entry) entry.generation++;
    const content = this.contents.get(path);
    if (content) { this.contents.delete(path); this.contentBytes -= content.cost; }
  }

  async addFiles(records, {signal} = {}) {
    let count = 0;
    for (const record of records) {
      this.check(signal);
      this.upsert(record);
      if (++count % this.yieldEvery === 0) await nextTurn();
    }
  }

  candidates(query) {
    if (!query) return this.entries.keys();
    const lists = [...new Set(query)].map(character => this.postings.get(character));
    if (lists.some(list => !list)) return [];
    lists.sort((left, right) => left.size - right.size);
    return lists[0] ?? [];
  }

  async *findPaths(query, {signal, limit = 100} = {}) {
    this.check(signal);
    query = String(query).normalize('NFC').toLowerCase();
    if (query.length > 1024 || !Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid search query or result limit');
    let visited = 0;
    let found = 0;
    let yieldedAt = performance.now();
    for (const path of this.candidates(query)) {
      this.check(signal);
      const entry = this.entries.get(path);
      if (!entry) continue;
      const score = fuzzyScore(entry.folded, query);
      if (score !== null) { yield {path, score}; if (++found >= limit) return; }
      if (++visited % this.yieldEvery === 0 && performance.now() - yieldedAt >= 8) {
        await nextTurn();
        yieldedAt = performance.now();
      }
    }
  }

  async searchPaths(query, options) {
    const results = [];
    for await (const result of this.findPaths(query, options)) results.push(result);
    return results.sort((left, right) => right.score - left.score || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  }

  #cachedText(path) {
    const cached = this.contents.get(path);
    if (!cached) return undefined;
    this.metrics.contentHits++;
    this.contents.delete(path);
    this.contents.set(path, cached);
    return cached.text;
  }

  async text(path, signal) {
    this.check(signal);
    const cached = this.#cachedText(path);
    if (cached !== undefined) return cached;
    const entry = this.entries.get(path);
    const generation = entry?.generation;
    if (!isWorkspaceTextPath(path) || entry?.size > this.maxFileBytes) return null;
    const bytes = await this.provider.readFile(path, {signal});
    this.check(signal);
    if (this.entries.get(path) !== entry || entry?.generation !== generation) {
      throw new FileSystemError('Conflict', path, 'File changed while its search contents were loading');
    }
    if (bytes.length > this.maxFileBytes) return null;
    this.metrics.contentReads++;
    const current = this.#cachedText(path);
    if (current !== undefined) return current;
    const text = decodeWorkspaceFile(path, bytes).text;
    if (typeof text !== 'string') return null;
    const cost = text.length * 2;
    if (cost <= this.maxContentBytes) {
      for (const [candidate, value] of this.contents) {
        if (this.contentBytes + cost <= this.maxContentBytes) break;
        this.contents.delete(candidate);
        this.contentBytes -= value.cost;
      }
      this.contents.set(path, {text, cost});
      this.contentBytes += cost;
    }
    return text;
  }

  async *findText(query, {signal, limit = 1000, caseSensitive = false, wholeWord = false, paths = null} = {}) {
    this.check(signal);
    if (typeof query !== 'string' || !query || query.length > 4096) throw new TypeError('Content search requires a nonempty bounded literal');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Invalid search result limit');
    const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
    let results = 0;
    let count = 0;
    for (const path of paths ?? [...this.entries.keys()]) {
      this.check(signal);
      const entry = this.entries.get(path);
      const generation = entry?.generation;
      const version = entry?.version;
      let text;
      try { text = await this.text(path, signal); }
      catch (error) {
        if (error.code === 'Cancelled' || error.code === 'Disposed' || error.name === 'AbortError') throw error;
        this.onDiagnostic({path, code: 'SFSEARCH001', severity: 'warning', message: error.message});
        continue;
      }
      this.check(signal);
      if (!this.#currentSearchRevision(path, entry, generation)) continue;
      if (text !== null) {
        this.metrics.searchedFiles++;
        expression.lastIndex = 0;
        let match;
        let line = 1;
        let lineStart = 0;
        let previous = 0;
        while ((match = expression.exec(text))) {
          this.check(signal);
          if (!this.#currentSearchRevision(path, entry, generation)) break;
          const offset = match.index;
          const end = expression.lastIndex;
          let before = offset - 1;
          if (before > 0 && text.charCodeAt(before) >= 0xdc00 && text.charCodeAt(before) <= 0xdfff) before--;
          const previousCharacter = text.slice(Math.max(0, before), offset);
          const nextCharacter = end < text.length ? String.fromCodePoint(text.codePointAt(end)) : '';
          const boundary = !wholeWord || !/[\p{L}\p{N}\p{M}_]/u.test(previousCharacter) && !/[\p{L}\p{N}\p{M}_]/u.test(nextCharacter);
          if (boundary) {
            for (let index = previous; index < offset; index++) if (text[index] === '\n') { line++; lineStart = index + 1; }
            previous = offset;
            const lineEnd = text.indexOf('\n', end);
            yield {path, version, offset, length: match[0].length, line, column: offset - lineStart + 1,
              preview: text.slice(lineStart, Math.min(lineEnd < 0 ? text.length : lineEnd, lineStart + 400)).replace(/\r$/, '')};
            if (++results >= limit) return;
          }
        }
      }
      if (++count % this.yieldEvery === 0) await nextTurn();
    }
  }

  #currentSearchRevision(path, entry, generation) {
    if (this.entries.get(path) === entry && entry?.generation === generation) return true;
    this.onDiagnostic({path, code: 'SFSEARCH001', severity: 'warning', message: 'File changed while its search results were streaming'});
    return false;
  }

  /** LanguageService.findInFiles result shape; offsets and columns are UTF-16 and lines are zero based. */
  async findInFiles(query, {matchCase = false, wholeWord = false, maxMatches = 2000, signal, paths} = {}) {
    if (typeof query !== 'string' || query.length > 1024) throw new RangeError('Search text must be a string of at most 1024 characters');
    if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 10000) throw new RangeError('Match limit must be between 1 and 10000');
    this.check(signal);
    const matches = [];
    let truncated = false;
    const started = this.metrics.searchedFiles;
    if (!query) return {matches, truncated, scannedFiles: 0};
    for await (const match of this.findText(query, {caseSensitive: matchCase, wholeWord, limit: maxMatches + 1, signal, paths})) {
      if (matches.length === maxMatches) { truncated = true; break; }
      matches.push({uri: match.path, start: match.offset, end: match.offset + match.length,
        version: match.version, line: match.line - 1, character: match.column - 1, preview: match.preview.slice(0, 240)});
    }
    return {matches, truncated, scannedFiles: this.metrics.searchedFiles - started};
  }

  async onWatchEvent(event) {
    if (this.disposed) return;
    const removedPath = event.oldPath ?? (event.type === 'deleted' ? event.path : null);
    if (removedPath) for (const path of this.pendingStats.keys()) {
      if (path === removedPath || path.startsWith(removedPath + '/')) this.pendingStats.delete(path);
    }
    if (event.oldPath) {
      for (const path of [...this.entries.keys()]) if (path === event.oldPath || path.startsWith(event.oldPath + '/')) {
        const entry = this.entries.get(path);
        this.remove(path);
        this.upsert({...entry, path: event.path + path.slice(event.oldPath.length)});
      }
    }
    if (event.type === 'deleted') {
      for (const path of this.entries.keys()) if (path === event.path || path.startsWith(event.path + '/')) this.remove(path);
      return;
    }
    this.invalidate(event.path);
    if (this.pendingStats.size >= this.maxEntries) throw new FileSystemError('QuotaExceeded', event.path, 'Pending search metadata budget exceeded');
    const token = {};
    this.pendingStats.set(event.path, token);
    try {
      const metadata = await this.provider.stat(event.path, {signal: this.abort.signal});
      this.check();
      if (this.pendingStats.get(event.path) !== token) {
        throw new FileSystemError('Conflict', event.path, 'Search metadata changed while its file status was loading');
      }
      if (metadata.type === 'file') this.upsert(metadata);
    } finally {
      if (this.pendingStats.get(event.path) === token) this.pendingStats.delete(event.path);
    }
  }

  async watch(options = {}) {
    this.check(options.signal);
    const generation = ++this.watchGeneration;
    this.subscription?.dispose();
    this.subscription = null;
    const subscription = await this.provider.watch('', event => {
      if (this.disposed || generation !== this.watchGeneration) return;
      void this.onWatchEvent(event).catch(error => {
        if (!this.disposed) this.onDiagnostic({code: 'SFSEARCH002', severity: 'warning', message: error.message});
      });
    }, options);
    try {
      this.check(options.signal);
      if (generation !== this.watchGeneration) throw new FileSystemError('Conflict', '', 'Search watcher was replaced during setup');
      this.subscription = subscription;
      return subscription;
    } catch (error) { subscription?.dispose(); throw error; }
  }

  dispose() {
    this.disposed = true;
    this.watchGeneration++;
    this.abort.abort();
    this.subscription?.dispose();
    this.subscription = null;
    this.entries.clear();
    this.postings.clear();
    this.contents.clear();
    this.pendingStats.clear();
    this.indexBytes = 0;
    this.contentBytes = 0;
  }
}
