import {PathPolicy} from '@sharpforge/archive';

function cancelled(signal) { if (signal?.aborted) throw new DOMException('Explorer expansion cancelled', 'AbortError'); }

/** Preindexed folder children: O(total path components) construction, O(page size) node materialization. */
export class LazyExplorerTree {
  constructor({files = [], folders = [], name = 'Workspace', pageSize = 100, caseSensitive = true,
    maxEntries = 100000, deferIndex = false} = {}) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new RangeError('Explorer page size must be 1–1000');
    this.policy = new PathPolicy({caseSensitive});
    this.pageSize = pageSize;
    this.name = name;
    this.maxEntries = maxEntries;
    this.directories = new Map([['', {path: '', children: new Map(), ordered: null}]]);
    this.files = new Map();
    this.disposed = false;
    this.pendingInput = deferIndex ? {files: files.slice(), folders: folders.slice()} : null;
    this.preparing = null;
    if (!deferIndex) {
      for (const folder of folders) this.addDirectory(folder);
      for (const file of files) this.addFile(file);
    }
    this.root = this.folderNode('', name);
    this.root.id = 'workspace:' + name;
    this.root.kind = 'workspace';
    this.root.defaultExpanded = true;
    if (deferIndex) this.root.childCount = null;
  }

  addDirectory(path) {
    path = this.policy.normalize(path);
    const existing = this.directories.get(path);
    if (existing) return existing;
    const parts = path.split('/');
    let parent = this.directories.get('');
    let current = '';
    for (const name of parts) {
      current = current ? current + '/' + name : name;
      let entry = this.directories.get(current);
      if (!entry) {
        if (parent.children.has(this.identity(name))) throw new Error('Explorer path identity collision: ' + current);
        if (this.directories.size + this.files.size >= this.maxEntries) throw new RangeError('Explorer entry budget exceeded');
        entry = {path: current, children: new Map(), ordered: null};
        this.directories.set(current, entry);
        parent.children.set(this.identity(name), {path: current, name, type: 'directory', orderKey: this.identity(current)});
        parent.ordered = null;
      }
      parent = entry;
    }
    return parent;
  }

  addFile(file) {
    const path = this.policy.normalize(file.path ?? file.uri);
    const slash = path.lastIndexOf('/');
    const parentPath = slash < 0 ? '' : path.slice(0, slash);
    const parent = this.directories.get(parentPath) ?? this.addDirectory(parentPath);
    const name = path.slice(slash + 1);
    const key = this.identity(name);
    if (parent.children.has(key)) throw new Error('Explorer path identity collision: ' + path);
    if (this.directories.size + this.files.size >= this.maxEntries) throw new RangeError('Explorer entry budget exceeded');
    this.files.set(path, file);
    parent.children.set(key, {path, name, type: 'file', orderKey: this.identity(path)});
    parent.ordered = null;
  }

  identity(path) {
    const normalized = path.normalize(this.policy.unicodeNormalization);
    return this.policy.caseSensitive ? normalized : normalized.toLowerCase();
  }

  folderNode(path, label = path.slice(path.lastIndexOf('/') + 1)) {
    const tree = this;
    return {id: 'folder:' + path, path, label, kind: 'folder', branch: true, children: [], lazy: true, icon: '▰',
      childCount: this.directories.get(path).children.size,
      loadChildren: options => tree.loadChildren(path, options)};
  }

  fileNode(entry) {
    const file = this.files.get(entry.path);
    const kind = file.kind ?? (/\.(cs|vb|fs)$/i.test(entry.path) ? 'source' : /\.(dll|exe)$/i.test(entry.path) ? 'assembly' : 'file');
    return {id: 'file:' + entry.path, path: entry.path, label: entry.name, kind, searchText: entry.path,
      icon: kind === 'source' ? 'C#' : '≡', size: file.size, unloaded: !!file.lazy};
  }

  async loadChildren(path, {offset = 0, limit = this.pageSize, signal} = {}) {
    cancelled(signal);
    if (this.disposed) throw new Error('Explorer tree is disposed');
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError('Invalid explorer page');
    }
    await this.prepare(signal);
    const directory = this.directories.get(path);
    if (!directory) throw new Error('Explorer directory not found: ' + path);
    if (!directory.ordered) {
      directory.ordered = [...directory.children.values()].sort((left, right) =>
        (left.type === 'directory' ? 0 : 1) - (right.type === 'directory' ? 0 : 1)
        || (left.orderKey < right.orderKey ? -1 : left.orderKey > right.orderKey ? 1 : 0));
    }
    const nodes = directory.ordered.slice(offset, offset + limit).map(entry =>
      entry.type === 'directory' ? this.folderNode(entry.path, entry.name) : this.fileNode(entry));
    cancelled(signal);
    return {nodes, total: directory.ordered.length, offset, hasMore: offset + nodes.length < directory.ordered.length};
  }

  async prepare(signal) {
    if (!this.pendingInput) return;
    if (this.preparing) return this.preparing;
    this.preparing = this.buildIndex(signal);
    try { await this.preparing; }
    finally { this.preparing = null; }
  }

  async buildIndex(signal) {
    const input = this.pendingInput;
    let work = 0;
    let yieldedAt = performance.now();
    try {
      for (const [records, add] of [[input.folders, path => this.addDirectory(path)], [input.files, file => this.addFile(file)]]) {
        for (const record of records) {
          cancelled(signal);
          if (this.disposed) throw new Error('Explorer tree is disposed');
          add(record);
          if (++work % 128 === 0 && performance.now() - yieldedAt >= 8) {
            await new Promise(resolve => setTimeout(resolve, 0));
            yieldedAt = performance.now();
          }
        }
      }
      this.pendingInput = null;
      this.root.childCount = this.directories.get('').children.size;
    } catch (error) {
      this.files.clear();
      this.directories = new Map([['', {path: '', children: new Map(), ordered: null}]]);
      throw error;
    }
  }

  /** Fixed-height viewport calculation bounds DOM row count independently of directory size. */
  window({count, scrollTop = 0, viewportHeight, rowHeight = 24, overscan = 6}) {
    if (![count, scrollTop, viewportHeight, rowHeight, overscan].every(Number.isFinite) || rowHeight <= 0) throw new RangeError('Invalid viewport');
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(count, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    return {start, end, count: Math.max(0, end - start), before: start * rowHeight, after: Math.max(0, count - end) * rowHeight};
  }

  dispose() { this.disposed = true; this.pendingInput = null; this.files.clear(); this.directories.clear(); }
}

export function buildLazyFolderTree(options) {
  const model = new LazyExplorerTree(options);
  return {roots: [model.root], model};
}
