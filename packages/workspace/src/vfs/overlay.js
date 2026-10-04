import {encodeWorkspaceFile, decodeWorkspaceFile} from '@sharpforge/archive';
import {FileSystemProvider, FileSystemError, fileBytes, hashFileBytes, ProviderEvents} from './provider.js';

/** Unsaved buffers and generated documents share a byte-consistent view with the underlying filesystem. */
export class OverlayFileSystemProvider extends FileSystemProvider {
  constructor(base, {maxOverlayBytes = 64 * 1024 * 1024} = {}) {
    super({...base.capabilities, readonly: false});
    this.base = base;
    this.maxOverlayBytes = maxOverlayBytes;
    this.usedBytes = 0;
    this.buffers = new Map();
    this.generated = new Map();
    this.events = new ProviderEvents(this.pathPolicy);
    this.subscriptions = new Set();
    this.publications = new Map();
  }

  generatedUri(path) { return typeof path === 'string' && path.startsWith('generated://'); }

  generatedEntry(path) {
    const entry = this.generated.get(path);
    if (!entry) throw new FileSystemError('NotFound', path);
    return entry;
  }

  ensureWritable(path, options) {
    if (this.generatedUri(path)) throw new FileSystemError('ReadOnly', path, 'Generated documents are read-only');
    return this.check(path, {...options, write: true, allowRoot: false});
  }

  beginPublication(path, generated = false) {
    const entries = generated ? this.generated : this.buffers;
    const key = generated ? path : this.pathPolicy.identity(path);
    const publication = {path, key, entries, previous: entries.get(key)};
    this.publications.set(key, publication);
    return publication;
  }

  checkPublication(publication, options) {
    this.check('', options);
    if (this.publications.get(publication.key) !== publication || publication.entries.get(publication.key) !== publication.previous) {
      throw new FileSystemError('Conflict', publication.path, 'Overlay contents changed while new bytes were being prepared');
    }
  }

  endPublication(publication) {
    if (this.publications.get(publication.key) === publication) this.publications.delete(publication.key);
  }

  invalidatePublications(path) {
    for (const [key, publication] of this.publications) {
      if (!this.generatedUri(publication.path) && this.pathPolicy.contains(path, publication.path)) this.publications.delete(key);
    }
  }

  async setGenerated(uri, value, options = {}) {
    this.check('', options);
    if (!this.generatedUri(uri) || uri.length > 4096) throw new FileSystemError('InvalidPath', uri, 'Expected a generated:// URI');
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : fileBytes(value).slice();
    const publication = this.beginPublication(uri, true);
    try {
      const hash = await hashFileBytes(bytes, options);
      this.checkPublication(publication, options);
      const additional = bytes.length - (publication.previous?.bytes.length ?? 0);
      this.admit(additional, uri);
      this.generated.set(uri, {path: uri, type: 'file', bytes, hash, size: bytes.length, readonly: true});
      this.usedBytes += additional;
    } finally { this.endPublication(publication); }
  }

  admit(additional, path) {
    if (this.usedBytes + additional > this.maxOverlayBytes) throw new FileSystemError('QuotaExceeded', path, 'Unsaved buffer byte budget exceeded');
  }

  async setBuffer(path, text, options = {}) {
    path = this.ensureWritable(path, options);
    const publication = this.beginPublication(path);
    try {
      let baseline = publication.previous;
      if (!baseline) {
        let record = {path};
        try { record = decodeWorkspaceFile(path, await this.base.readFile(path, options)); }
        catch (error) { if (error.code !== 'NotFound') throw error; }
        baseline = {record, baselineHash: record.bytes ? await hashFileBytes(record.bytes, options) : null};
      }
      this.checkPublication(publication, options);
      const bytes = encodeWorkspaceFile({...baseline.record, text});
      return await this.prepareBuffer(path, bytes, {...options, baseline}, publication);
    } finally { this.endPublication(publication); }
  }

  async writeBuffer(path, bytes, options = {}) {
    path = this.ensureWritable(path, options);
    const publication = this.beginPublication(path);
    try { return await this.prepareBuffer(path, bytes, options, publication); }
    finally { this.endPublication(publication); }
  }

  async prepareBuffer(path, bytes, {baseline, ...options}, publication) {
    const {key, previous: old} = publication;
    let baselineHash = old?.baselineHash ?? baseline?.baselineHash;
    if (!old && !baseline) {
      try { baselineHash = await hashFileBytes(await this.base.readFile(path, options), options); }
      catch (error) { if (error.code !== 'NotFound') throw error; baselineHash = null; }
    }
    const content = fileBytes(bytes).slice();
    const hash = await hashFileBytes(content, options);
    this.checkPublication(publication, options);
    this.admit(content.length - (old?.bytes.length ?? 0), path);
    const entry = {path: old?.path ?? path, type: 'file', bytes: content, size: content.length, hash,
      baselineHash, record: decodeWorkspaceFile(path, content), dirty: true};
    this.buffers.set(key, entry);
    this.usedBytes += content.length - (old?.bytes.length ?? 0);
    this.events.emit({type: baselineHash === null ? 'created' : 'changed', path, hash, source: 'overlay'});
    return {path, type: 'file', size: content.length, hash};
  }

  async stat(path, options = {}) {
    this.check('', options);
    if (this.generatedUri(path)) { const {bytes, ...entry} = this.generatedEntry(path); return entry; }
    path = this.check(path, options);
    if (!path) return this.base.stat(path, options);
    const {bytes, record, ...entry} = this.buffers.get(this.pathPolicy.identity(path)) ?? {};
    if (entry.path) return entry;
    return this.base.stat(path, options);
  }

  async readFile(path, options = {}) {
    this.check('', options);
    if (this.generatedUri(path)) return this.generatedEntry(path).bytes.slice();
    path = this.check(path, {...options, allowRoot: false});
    const entry = this.buffers.get(this.pathPolicy.identity(path));
    return entry ? entry.bytes.slice() : this.base.readFile(path, options);
  }

  async readDirectory(path = '', options = {}) {
    path = this.check(path, options);
    const entries = new Map((await this.base.readDirectory(path, options)).map(entry => [this.pathPolicy.identity(entry.path), entry]));
    const prefix = path ? path + '/' : '';
    for (const entry of this.buffers.values()) {
      if (!this.pathPolicy.contains(path, entry.path)) continue;
      const suffix = entry.path.slice(prefix.length);
      if (suffix.includes('/')) continue;
      entries.set(this.pathPolicy.identity(entry.path), {path: entry.path, name: suffix, type: 'file', size: entry.size, hash: entry.hash});
    }
    return [...entries.values()].sort((left, right) => this.pathPolicy.compare(left.path, right.path));
  }

  async writeFile(path, bytes, options = {}) {
    path = this.ensureWritable(path, options);
    const publication = this.beginPublication(path);
    try {
      let existing;
      try { existing = await this.stat(path, options); }
      catch (error) { if (error.code !== 'NotFound') throw error; }
      if (existing?.type === 'directory') throw new FileSystemError('IsDirectory', path);
      if (!existing && options.create === false) throw new FileSystemError('NotFound', path);
      if (existing && options.overwrite === false) throw new FileSystemError('AlreadyExists', path);
      if (options.expectedHash !== undefined) {
        const current = existing ? await hashFileBytes(await this.readFile(path, options), options) : null;
        if (current !== options.expectedHash) throw new FileSystemError('Conflict', path);
      }
      this.checkPublication(publication, options);
      return await this.prepareBuffer(path, bytes, options, publication);
    } finally { this.endPublication(publication); }
  }

  async save(path, options = {}) {
    path = this.ensureWritable(path, options);
    const key = this.pathPolicy.identity(path);
    const entry = this.buffers.get(key);
    if (!entry) return this.base.stat(path, options);
    const result = await this.base.writeFile(path, entry.bytes, {...options, expectedHash: entry.baselineHash});
    const current = this.buffers.get(key);
    if (current === entry) this.discard(path);
    else if (current?.baselineHash === entry.baselineHash) this.buffers.set(key, {...current, baselineHash: result.hash});
    return result;
  }

  discard(path) {
    const key = this.pathPolicy.identity(path);
    this.publications.delete(key);
    const entry = this.buffers.get(key);
    if (!entry) return false;
    this.usedBytes -= entry.bytes.length;
    this.buffers.delete(key);
    return true;
  }

  async createDirectory(path, options = {}) { return this.base.createDirectory(this.ensureWritable(path, options), options); }

  async delete(path, options = {}) {
    path = this.ensureWritable(path, options);
    const affected = [...this.buffers.values()].filter(entry => this.pathPolicy.contains(path, entry.path));
    if (affected.length && options.discardDirty !== true) throw new FileSystemError('Conflict', path, 'Deleting unsaved buffers requires discardDirty');
    this.invalidatePublications(path);
    try { await this.base.delete(path, options); }
    catch (error) { if (error.code !== 'NotFound' || !affected.length) throw error; }
    for (const entry of affected) if (this.buffers.get(this.pathPolicy.identity(entry.path)) === entry) this.discard(entry.path);
  }

  async rename(from, to, options = {}) {
    from = this.ensureWritable(from, options);
    to = this.ensureWritable(to, options);
    const affected = [...this.buffers.values()].filter(entry => this.pathPolicy.contains(from, entry.path));
    const affectedSet = new Set(affected);
    for (const entry of affected) {
      const target = this.buffers.get(this.pathPolicy.identity(to + entry.path.slice(from.length)));
      if (target && !affectedSet.has(target)) throw new FileSystemError('Conflict', to, 'Unsaved destination already exists');
    }
    this.invalidatePublications(from);
    this.invalidatePublications(to);
    try { await this.base.rename(from, to, options); }
    catch (error) { if (error.code !== 'NotFound' || !affected.length) throw error; }
    const current = [...this.buffers.values()].filter(entry => this.pathPolicy.contains(from, entry.path));
    const currentSet = new Set(current);
    const moves = current.map(entry => ({entry, path: to + entry.path.slice(from.length)}));
    for (const move of moves) {
      const target = this.buffers.get(this.pathPolicy.identity(move.path));
      if (target && !currentSet.has(target)) throw new FileSystemError('Conflict', move.path,
        'Disk rename completed, but a new unsaved destination must be reconciled before moving the overlay');
    }
    this.invalidatePublications(from);
    this.invalidatePublications(to);
    for (const {entry, path} of moves) {
      this.buffers.delete(this.pathPolicy.identity(entry.path));
      this.buffers.set(this.pathPolicy.identity(path), {...entry, path});
    }
  }

  async watch(path, listener, options = {}) {
    path = this.check(path, options);
    const overlay = this.events.subscribe(path, listener, options);
    let underlying;
    try {
      underlying = await this.base.watch(path, listener, options);
      this.check(path, options);
    } catch (error) { overlay.dispose(); underlying?.dispose(); throw error; }
    const subscription = {dispose: () => { overlay.dispose(); underlying.dispose(); this.subscriptions.delete(subscription); }};
    this.subscriptions.add(subscription);
    return subscription;
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.events.dispose();
    this.buffers.clear();
    this.generated.clear();
    this.publications.clear();
    this.usedBytes = 0;
    super.dispose();
  }
}
