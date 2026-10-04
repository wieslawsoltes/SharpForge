import { TextVersionError } from './buffer.js';
import { checkpointBefore, scanColumnChunk, columnResult } from './visual-columns/state.js';
import { columnOptions, createColumnEntry, entryKey, rebaseColumnEntries, visualColumnError, positiveLimit } from './visual-columns/cache.js';

/** Exact Unicode visual columns over indexed snapshots. Initial scans yield; cached lookups never scan an unbounded prefix. */
export class VisualColumnIndex {
  #source;
  #snapshot;
  #entries = new Map();
  #metrics = new Map();
  #requests = new Set();
  #unsubscribe;
  #disposed = false;
  #counters = { scannedCodeUnits: 0, chunks: 0, yields: 0, cacheHits: 0 };
  constructor(source, {
    checkpointInterval = 8192, chunkSize = 4096, maxLines = 32, maxCheckpoints = 32768,
    maxResults = 256, maxPending = 64, yieldAfterUnits = 65536, yieldAfterMs = 8,
    schedule = () => new Promise(resolve => setTimeout(resolve, 0)), now = () => performance.now()
  } = {}) {
    if (!source || typeof source.snapshot !== 'function') throw new TypeError('Visual columns require an indexed snapshot source');
    this.#source = source;
    this.#snapshot = source.snapshot();
    this.options = Object.freeze({
      checkpointInterval: positiveLimit('checkpoint interval', checkpointInterval, 1048576),
      chunkSize: positiveLimit('chunk size', chunkSize, 16384),
      maxLines: positiveLimit('line limit', maxLines, 1024),
      maxCheckpoints: positiveLimit('checkpoint limit', maxCheckpoints, 1048576),
      maxResults: positiveLimit('result limit', maxResults, 4096),
      maxPending: positiveLimit('pending limit', maxPending, 1024),
      yieldAfterUnits: positiveLimit('yield interval', yieldAfterUnits, 1048576),
      yieldAfterMs: positiveLimit('yield time', yieldAfterMs, 16), schedule, now
    });
    if (typeof schedule !== 'function' || typeof now !== 'function') throw new TypeError('Expected visual column scheduling functions');
    this.#unsubscribe = source.onDidChange?.(event => this.#changed(event));
  }
  get statistics() {
    return Object.freeze({ ...this.#counters, checkpoints: this.#checkpointCount(), lines: this.#entries.size, pending: this.#requests.size });
  }
  /** Return an exact zero-based column, or null when more than one bounded chunk must be scanned. */
  getCached(offset, options = {}) {
    this.#sync();
    const location = this.#locate(offset, options, false);
    if (!location.target) return 0;
    const entry = location.entry;
    if (!entry) return null;
    if (entry.results.has(location.target)) {
      this.#counters.cacheHits++;
      return entry.results.get(location.target);
    }
    const state = entry.checkpoints[checkpointBefore(entry.checkpoints, location.target)].clone();
    if (location.target - state.offset > this.options.chunkSize) return null;
    if (state.offset < location.target) this.#scanChunk(entry, state, location.target, this.#snapshot);
    const result = columnResult(this.#snapshot, entry, state, location.target);
    this.#remember(entry, location.target, result);
    return result;
  }
  /** Resolve an exact column; reject cancelled, stale, disposed or over-capacity requests explicitly. */
  async get(offset, options = {}) {
    if (options.signal?.aborted) throw visualColumnError('VISUAL_COLUMN_CANCELLED', 'Visual column lookup was cancelled');
    const cached = this.getCached(offset, options);
    if (cached !== null) return cached;
    if (this.#requests.size >= this.options.maxPending) throw visualColumnError('VISUAL_COLUMN_LIMIT', 'Too many pending visual column lookups');
    const { entry, target } = this.#locate(offset, options, true);
    const snapshot = this.#snapshot;
    return new Promise((resolve, reject) => {
      const request = { entry, reject, cancelled: false };
      const abort = () => this.#cancel(request, visualColumnError('VISUAL_COLUMN_CANCELLED', 'Visual column lookup was cancelled'));
      options.signal?.addEventListener('abort', abort, { once: true });
      this.#requests.add(request);
      this.#scan(request, snapshot, target).then(resolve, reject).finally(() => {
        options.signal?.removeEventListener('abort', abort);
        this.#requests.delete(request);
      });
    });
  }
  #locate(offset, options, create) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > this.#snapshot.length) throw new RangeError('Visual column offset outside document');
    const metrics = columnOptions(options);
    const line = this.#snapshot.positionAt(offset).line;
    const start = this.#snapshot.lineStart(line);
    const target = Math.min(offset, this.#snapshot.lineEnd(line)) - start;
    const key = entryKey(start, metrics);
    let entry = this.#entries.get(key);
    if (!entry && create) {
      if (this.#entries.size >= this.options.maxLines || this.#checkpointCount() >= this.options.maxCheckpoints) {
        this.#evict(this.#entries.values().next().value);
      }
      entry = createColumnEntry(this.#snapshot, line, metrics, this.options.checkpointInterval);
      this.#entries.set(key, entry);
    } else if (entry) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    return { entry, target };
  }
  async #scan(request, snapshot, target) {
    const entry = request.entry;
    let state = entry.checkpoints[checkpointBefore(entry.checkpoints, target)].clone();
    let units = 0;
    let started = this.options.now();
    while (state.offset < target) {
      this.#sync();
      if (request.cancelled || !entry.valid) throw visualColumnError('VISUAL_COLUMN_CANCELLED', 'Visual column lookup was superseded');
      if (snapshot !== this.#snapshot) throw new TextVersionError(snapshot.version, this.#snapshot.version);
      const checkpoint = entry.checkpoints[checkpointBefore(entry.checkpoints, target)];
      if (checkpoint.offset > state.offset) state = checkpoint.clone();
      units += this.#scanChunk(entry, state, target, snapshot);
      this.#storeCheckpoint(entry, state);
      if (state.offset < target && (units >= this.options.yieldAfterUnits || this.options.now() - started >= this.options.yieldAfterMs)) {
        this.#counters.yields++;
        await this.options.schedule();
        units = 0;
        started = this.options.now();
      }
    }
    this.#sync();
    if (request.cancelled || snapshot !== this.#snapshot) throw visualColumnError('VISUAL_COLUMN_CANCELLED', 'Visual column lookup was superseded');
    const result = columnResult(snapshot, entry, state, target);
    this.#remember(entry, target, result);
    return result;
  }
  #scanChunk(entry, state, target, snapshot) {
    const units = scanColumnChunk(snapshot, entry, state, target, this.options.chunkSize, this.#metrics);
    this.#counters.scannedCodeUnits += units;
    this.#counters.chunks++;
    return units;
  }
  #remember(entry, offset, result) {
    if (entry.results.size >= this.options.maxResults) entry.results.delete(entry.results.keys().next().value);
    entry.results.set(offset, result);
  }
  #checkpointCount() {
    let count = 0;
    for (const entry of this.#entries.values()) count += entry.checkpoints.length;
    return count;
  }
  #storeCheckpoint(entry, state) {
    if (this.options.maxCheckpoints === 1) return;
    if (state.offset < entry.checkpoints.at(-1).offset + entry.stride) return;
    if (this.#checkpointCount() >= this.options.maxCheckpoints) {
      const candidate = [...this.#entries.values()].find(value => value !== entry);
      if (candidate) this.#evict(candidate);
      else {
        entry.checkpoints = entry.checkpoints.filter((_, index) => index % 2 === 0);
        entry.stride *= 2;
      }
    }
    if (state.offset >= entry.checkpoints.at(-1).offset + entry.stride) entry.checkpoints.push(state.clone());
  }
  #evict(entry) {
    entry.valid = false;
    entry.checkpoints.length = 1;
    entry.results.clear();
    this.#entries.delete(entryKey(entry.start, entry.options));
    for (const request of this.#requests) {
      if (request.entry === entry) this.#cancel(request, visualColumnError('VISUAL_COLUMN_LIMIT', 'Visual column cache capacity changed'));
    }
  }
  #cancel(request, error) {
    request.cancelled = true;
    request.reject(error);
  }
  #changed(event) {
    const snapshot = this.#source.snapshot();
    if (snapshot === this.#snapshot) return;
    for (const request of this.#requests) this.#cancel(request, new TextVersionError(this.#snapshot.version, snapshot.version));
    if (event.before === this.#snapshot && event.after === snapshot) this.#entries = rebaseColumnEntries(this.#entries, event, snapshot);
    else this.#clearEntries();
    this.#snapshot = snapshot;
  }
  #sync() {
    if (this.#disposed) throw visualColumnError('VISUAL_COLUMN_DISPOSED', 'Visual column index is disposed');
    if (this.#source.snapshot() !== this.#snapshot) this.#changed({});
  }
  #clearEntries() {
    for (const entry of this.#entries.values()) {
      entry.valid = false;
      entry.checkpoints.length = 1;
      entry.results.clear();
    }
    this.#entries.clear();
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    for (const request of this.#requests) this.#cancel(request, visualColumnError('VISUAL_COLUMN_DISPOSED', 'Visual column index is disposed'));
    this.#clearEntries();
    this.#metrics.clear();
  }
}
