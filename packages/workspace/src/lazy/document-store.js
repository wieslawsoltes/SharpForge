import {decodeWorkspaceFile, encodeWorkspaceFile} from '@sharpforge/archive';
import {FileSystemError, hashFileBytes, throwIfCancelled} from '../vfs/provider.js';

/** Metadata costs are independent of text admission. Loaded text/bytes use an explicit LRU byte budget. */
export class LazyDocumentStore {
  constructor(provider, {maxLoadedBytes = 64 * 1024 * 1024, maxFileBytes = 8 * 1024 * 1024,
    maxEntries = 100000, onEvict = () => {}} = {}) {
    this.provider = provider;
    this.maxLoadedBytes = maxLoadedBytes;
    this.maxFileBytes = maxFileBytes;
    this.maxEntries = maxEntries;
    this.onEvict = onEvict;
    this.evictionListeners = new Set();
    this.entries = new Map();
    this.loaded = new Map();
    this.loadedBytes = 0;
    this.disposed = false;
    this.metrics = {reads: 0, hits: 0, evictions: 0, loadedBytes: 0};
  }

  check(signal) {
    throwIfCancelled(signal);
    if (this.disposed) throw new FileSystemError('Disposed', '', 'Document store is disposed');
  }

  register(record) {
    this.check();
    if (record.text !== undefined || record.bytes !== undefined) throw new TypeError('Register metadata only; admit contents through the byte budget');
    const path = this.provider.check(record.path ?? record.uri, {allowRoot: false});
    if (!this.entries.has(path) && this.entries.size >= this.maxEntries) throw new FileSystemError('QuotaExceeded', path);
    const previous = this.entries.get(path);
    this.entries.set(path, {...record, path, generation: (previous?.generation ?? 0) + 1});
    if (previous) this.unload(path, {force: true});
    return this.entries.get(path);
  }

  registerAll(records) {
    this.check();
    const next = new Map(this.entries);
    for (const record of records) {
      if (record.text !== undefined || record.bytes !== undefined) throw new TypeError('Register metadata only; admit contents through the byte budget');
      const path = this.provider.check(record.path ?? record.uri, {allowRoot: false});
      if (next.has(path)) throw new FileSystemError('AlreadyExists', path, 'Duplicate document metadata');
      if (next.size >= this.maxEntries) throw new FileSystemError('QuotaExceeded', path);
      next.set(path, {...record, path, generation: 1});
    }
    this.entries = next;
  }

  metadata(path) { return this.entries.get(path); }
  get size() { return this.entries.size; }
  subscribeEviction(listener) {
    if (typeof listener !== 'function') throw new TypeError('An eviction listener is required');
    this.evictionListeners.add(listener);
    return () => this.evictionListeners.delete(listener);
  }

  admit(path, record, {pin = false, dirty = false} = {}) {
    this.check();
    const cost = (record.bytes?.length ?? 0) + (record.text?.length ?? 0) * 2;
    if (cost > this.maxLoadedBytes) throw new FileSystemError('QuotaExceeded', path, 'Document exceeds the loaded byte budget');
    const oldCost = this.loaded.get(path)?.cost ?? 0;
    let reclaimable = 0;
    for (const [candidate, value] of this.loaded) {
      if (candidate !== path && !value.pinned && !value.dirty) reclaimable += value.cost;
    }
    if (this.loadedBytes - oldCost - reclaimable + cost > this.maxLoadedBytes) {
      throw new FileSystemError('QuotaExceeded', path, 'Pinned/dirty documents exhaust the byte budget');
    }
    this.unload(path, {force: true});
    for (const [candidate, value] of this.loaded) {
      if (this.loadedBytes + cost <= this.maxLoadedBytes) break;
      if (!value.pinned && !value.dirty) this.unload(candidate);
    }
    if (this.loadedBytes + cost > this.maxLoadedBytes) throw new FileSystemError('QuotaExceeded', path, 'Pinned/dirty documents exhaust the byte budget');
    this.loaded.set(path, {record, cost, pinned: pin, dirty});
    const metadata = this.entries.get(path);
    if (metadata) metadata.generation++;
    this.loadedBytes += cost;
    this.metrics.loadedBytes = this.loadedBytes;
    return record;
  }

  async load(path, {signal, pin = false} = {}) {
    this.check(signal);
    const metadata = this.entries.get(path);
    if (!metadata) throw new FileSystemError('NotFound', path);
    const cached = this.loaded.get(path);
    if (cached) {
      this.metrics.hits++;
      this.loaded.delete(path);
      cached.pinned ||= pin;
      this.loaded.set(path, cached);
      return cached.record;
    }
    if (metadata.size > this.maxFileBytes) throw new FileSystemError('FileTooLarge', path);
    const generation = metadata.generation;
    const bytes = await this.provider.readFile(path, {signal});
    this.check(signal);
    if (bytes.length > this.maxFileBytes) throw new FileSystemError('FileTooLarge', path);
    const hash = await hashFileBytes(bytes, {signal});
    this.check(signal);
    if (this.entries.get(path) !== metadata || metadata.generation !== generation) {
      throw new FileSystemError('Conflict', path, 'Document changed while its contents were loading');
    }
    this.metrics.reads++;
    return this.admit(path, {...decodeWorkspaceFile(path, bytes), hash}, {pin});
  }

  update(path, text) {
    this.check();
    const previous = this.loaded.get(path);
    if (!previous) throw new FileSystemError('NotFound', path, 'Load a document before editing');
    const bytes = encodeWorkspaceFile({...previous.record, text});
    if (bytes.length > this.maxFileBytes) throw new FileSystemError('FileTooLarge', path);
    return this.admit(path, {...previous.record, text}, {pin: previous.pinned, dirty: true});
  }

  markClean(path, record) {
    const previous = this.loaded.get(path);
    if (previous) this.admit(path, record ?? previous.record, {pin: previous.pinned, dirty: false});
  }

  pin(path, value = true) { const entry = this.loaded.get(path); if (entry) entry.pinned = value; }

  unload(path, {force = false} = {}) {
    const entry = this.loaded.get(path);
    if (!entry || !force && (entry.dirty || entry.pinned)) return false;
    this.loaded.delete(path);
    const metadata = this.entries.get(path);
    if (metadata) metadata.generation++;
    this.loadedBytes -= entry.cost;
    this.metrics.loadedBytes = this.loadedBytes;
    this.metrics.evictions++;
    this.onEvict(path, entry.record);
    for (const listener of this.evictionListeners) listener(path, entry.record);
    return true;
  }

  invalidate(path) {
    const metadata = this.entries.get(path);
    if (metadata) metadata.generation++;
    const entry = this.loaded.get(path);
    if (entry?.dirty) return false;
    return this.unload(path, {force: true});
  }

  remove(path) { this.unload(path, {force: true}); return this.entries.delete(path); }
  dispose() { this.disposed = true; this.loaded.clear(); this.entries.clear(); this.evictionListeners.clear(); this.loadedBytes = 0; }
}
