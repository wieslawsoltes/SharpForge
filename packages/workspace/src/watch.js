import {FileSystemError, asFileSystemError, hashFileBytes, throwIfCancelled} from './vfs/provider.js';

const keyOf = entry => `${entry.type}:${entry.size ?? 0}:${entry.mtime ?? entry.lastModified ?? 0}:${entry.hash ?? ''}`;
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

/** Bounded round-robin metadata polling; visible documents get first priority every interval. */
export class PollingFileWatcher {
  constructor(provider, listener, {path = '', intervalMs = 1000, maxStatsPerTick = 256, maxDirectoryEntriesPerTick = 256,
    maxEntries = 100000, watchedPaths = [], signal, onError = () => {}, scheduler = globalThis, hash = false} = {}) {
    if (typeof listener !== 'function') throw new TypeError('A watcher listener is required');
    for (const value of [intervalMs, maxStatsPerTick, maxDirectoryEntriesPerTick, maxEntries]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Watcher budgets must be positive integers');
    }
    this.provider = provider;
    this.listener = listener;
    this.path = provider.check(path, {signal});
    this.intervalMs = intervalMs;
    this.maxStatsPerTick = maxStatsPerTick;
    this.maxDirectoryEntriesPerTick = maxDirectoryEntriesPerTick;
    this.maxEntries = maxEntries;
    this.signal = signal;
    this.onError = onError;
    this.scheduler = scheduler;
    this.hash = hash;
    this.priority = new Set(watchedPaths);
    this.priorityPaths = [...this.priority];
    this.priorityCursor = 0;
    this.known = new Map();
    this.files = [];
    this.directories = [this.path];
    this.cursor = 0;
    this.directoryCursor = 0;
    this.disposed = false;
    this.running = null;
    this.scan = null;
    this.abort = () => this.dispose();
    this.metrics = {statCalls: 0, directoryEntries: 0, ticks: 0};
  }

  async signature(entry, {hash = this.hash || this.priority.has(entry.path)} = {}) {
    if (hash && entry.type === 'file' && entry.hash == null) return {...entry, hash: await hashFileBytes(await this.provider.readFile(entry.path,
      {signal: this.signal}), {signal: this.signal})};
    return {...entry};
  }

  async start({schedule = true} = {}) {
    throwIfCancelled(this.signal);
    const folders = [this.path];
    let work = 0;
    for (let index = 0; index < folders.length; index++) {
      for await (const entry of this.iterate(folders[index], true)) {
        throwIfCancelled(this.signal);
        if (this.known.size >= this.maxEntries) throw new FileSystemError('QuotaExceeded', this.path, 'Watcher entry budget exceeded');
        this.known.set(entry.path, await this.signature(entry));
        if (entry.type === 'directory') folders.push(entry.path);
        if (++work % this.maxStatsPerTick === 0) await nextTurn();
      }
    }
    this.reindex();
    this.signal?.addEventListener('abort', this.abort, {once: true});
    if (schedule) this.schedule();
    return this;
  }

  async *iterate(path, metadata) {
    if (typeof this.provider.iterateDirectory === 'function') {
      yield* this.provider.iterateDirectory(path, {signal: this.signal, metadata});
    } else yield* await this.provider.readDirectory(path, {signal: this.signal, metadata});
  }

  reindex() {
    this.files = [];
    this.directories = [this.path];
    for (const entry of this.known.values()) {
      if (entry.type === 'directory') this.directories.push(entry.path);
      else this.files.push(entry.path);
    }
    this.cursor %= Math.max(1, this.files.length);
    this.directoryCursor %= this.directories.length;
  }

  setWatchedPaths(paths) {
    this.priority = new Set(paths);
    this.priorityPaths = [...this.priority];
    this.priorityCursor %= Math.max(1, this.priorityPaths.length);
  }

  schedule() {
    if (this.disposed) return;
    this.timer = this.scheduler.setTimeout(async () => {
      try { await this.poll(); }
      catch (error) { if (!this.disposed) this.onError(asFileSystemError(error, this.path)); }
      this.schedule();
    }, this.intervalMs);
  }

  async poll() {
    if (this.disposed) return [];
    if (this.running) return this.running;
    this.running = this.tick();
    try { return await this.running; } finally { this.running = null; }
  }

  async tick() {
    throwIfCancelled(this.signal);
    this.metrics.ticks++;
    const events = [];
    const paths = new Set();
    let priorityCount = Math.min(this.priorityPaths.length, this.maxStatsPerTick);
    if (priorityCount === this.maxStatsPerTick && this.files.length) {
      priorityCount = this.maxStatsPerTick === 1 ? this.metrics.ticks % 2 : this.maxStatsPerTick - 1;
    }
    for (let index = 0; index < priorityCount; index++) {
      paths.add(this.priorityPaths[this.priorityCursor++ % this.priorityPaths.length]);
    }
    const count = Math.min(this.files.length, this.maxStatsPerTick);
    for (let index = 0; index < count && paths.size < this.maxStatsPerTick; index++) {
      paths.add(this.files[this.cursor++ % this.files.length]);
    }
    for (const path of paths) {
      if (this.disposed) return [];
      const previous = this.known.get(path);
      let next;
      try {
        const metadata = await this.provider.stat(path, {signal: this.signal});
        const changed = previous && (metadata.size !== previous.size || metadata.mtime !== previous.mtime);
        const hash = this.hash || this.priority.has(path) || !!changed;
        next = await this.signature(metadata, {hash});
        if (!hash && next.hash == null && previous?.hash) next.hash = previous.hash;
      }
      catch (error) { if (error.code !== 'NotFound') throw error; }
      this.metrics.statCalls++;
      if (!next && previous) { this.known.delete(path); events.push({type: 'deleted', path, previous}); }
      else if (next && !previous) { this.known.set(path, next); events.push({...next, kind: next.type, type: 'created'}); }
      else if (next && keyOf(next) !== keyOf(previous)) {
        this.known.set(path, next);
        events.push({...next, kind: next.type, type: 'changed', previous});
      }
    }
    await this.scanDirectory(events);
    if (events.some(event => event.type !== 'changed')) this.reindex();
    const coalesced = this.renames(events);
    for (const event of coalesced) if (!this.disposed) this.listener(event);
    return coalesced;
  }

  renames(events) {
    const removed = new Map();
    for (const event of events) if (event.type === 'deleted' && event.previous?.hash) {
      const hash = event.previous.hash;
      removed.set(hash, removed.has(hash) ? null : event);
    }
    const consumed = new Set();
    const result = [];
    for (const event of events) {
      const prior = event.type === 'created' && event.hash ? removed.get(event.hash) : null;
      if (prior) {
        consumed.add(prior);
        result.push({...event, type: 'renamed', oldPath: prior.path});
        removed.delete(event.hash);
      } else result.push(event);
    }
    return result.filter(event => !consumed.has(event));
  }

  async scanDirectory(events) {
    if (!this.scan) {
      const path = this.directories[this.directoryCursor++ % this.directories.length];
      this.scan = {path, iterator: this.iterate(path, false)[Symbol.asyncIterator](), seen: new Set()};
    }
    const scan = this.scan;
    for (let count = 0; count < this.maxDirectoryEntriesPerTick; count++) {
      let result;
      try { result = await scan.iterator.next(); }
      catch (error) { this.scan = null; if (error.code !== 'NotFound') throw error; return; }
      if (result.done) {
        const prefix = scan.path ? scan.path + '/' : '';
        for (const path of this.known.keys()) {
          if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && !scan.seen.has(path)) {
            const previous = this.known.get(path);
            this.known.delete(path);
            events.push({type: 'deleted', path, previous});
          }
        }
        this.scan = null;
        return;
      }
      const entry = result.value;
      this.metrics.directoryEntries++;
      scan.seen.add(entry.path);
      if (!this.known.has(entry.path)) {
        if (this.known.size >= this.maxEntries) throw new FileSystemError('QuotaExceeded', entry.path, 'Watcher entry budget exceeded');
        const metadata = await this.signature(entry);
        this.known.set(entry.path, metadata);
        events.push({...metadata, kind: metadata.type, type: 'created'});
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.scheduler.clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    this.scan?.iterator.return?.();
    this.scan = null;
  }
}

/** Prefer FileSystemObserver; unavailable/unsupported observation selects the explicit polling fallback. */
export async function observeFileSystemHandle(handle, listener, {path = '', signal, recursive = true,
  FileSystemObserver = globalThis.FileSystemObserver, file = false} = {}) {
  throwIfCancelled(signal);
  if (typeof FileSystemObserver !== 'function') return null;
  let disposed = false;
  const observer = new FileSystemObserver(records => {
    if (disposed) return;
    for (const record of records) {
      const relative = record.relativePathComponents?.join('/') ?? record.changedHandle?.name ?? '';
      const target = file ? path : path && relative ? path + '/' + relative : path || relative;
      const kinds = {appeared: 'created', disappeared: 'deleted', modified: 'changed', moved: 'renamed'};
      const type = kinds[record.type];
      if (!type) { listener({type: 'rescan', path, reason: record.type}); continue; }
      const oldRelative = record.relativePathMovedFrom?.join('/');
      listener({type, path: target, ...(oldRelative ? {oldPath: path ? path + '/' + oldRelative : oldRelative} : {})});
    }
  });
  const dispose = () => { disposed = true; observer.disconnect(); signal?.removeEventListener('abort', dispose); };
  try { await observer.observe(handle, {recursive}); throwIfCancelled(signal); }
  catch (error) {
    dispose();
    if (error.name === 'NotSupportedError') return null;
    throw asFileSystemError(error, path);
  }
  signal?.addEventListener('abort', dispose, {once: true});
  return {dispose};
}
