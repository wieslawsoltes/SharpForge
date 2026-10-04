import {DrawingError} from '../drawing/commands.js';

async function decodePng(bytes, options) {
  if (typeof globalThis.createImageBitmap !== 'function') throw new DrawingError('SFRENDER147', 'Color glyphs require an image decoder');
  options.signal?.throwIfAborted();
  const source = await globalThis.createImageBitmap(new Blob([bytes], {type: 'image/png'}),
    {premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none'});
  if (options.signal?.aborted) { source.close?.(); options.signal.throwIfAborted(); }
  return source;
}

/** Owned bounded PNG decoding queue. Missing asynchronous images stay uncached in the GPU atlas until invalidation. */
export class DecodedGlyphs {
  constructor({decodeImage = decodePng, onChanged = () => {}, maxBitmapBytes = 67108864, maxPendingGlyphs = 4096, decodeConcurrency = 4} = {}) {
    if (![maxBitmapBytes, maxPendingGlyphs, decodeConcurrency].every(value => Number.isSafeInteger(value) && value > 0)
      || maxBitmapBytes > 268435456 || maxPendingGlyphs > 16384 || decodeConcurrency > 16) {
      throw new DrawingError('SFRENDER147', 'Invalid color glyph decoder budget');
    }
    this.decode = decodeImage;
    this.onChanged = onChanged;
    this.maxBytes = maxBitmapBytes;
    this.maxPending = maxPendingGlyphs;
    this.maxEntries = Math.max(1024, maxPendingGlyphs * 4);
    this.concurrency = decodeConcurrency;
    this.entries = new Map();
    this.queue = [];
    this.active = 0;
    this.bytes = 0;
    this.controller = new AbortController();
  }
  request(bitmap) {
    if (this.closed) throw new DrawingError('SFRENDER081', 'Color glyph decoder is disposed');
    let entry = this.entries.get(bitmap.key);
    if (entry) {
      this.entries.delete(bitmap.key);
      this.entries.set(bitmap.key, entry);
      if (entry.error) throw entry.error;
      return entry;
    }
    const bytes = bitmap.width * bitmap.height * 4;
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.maxBytes) throw new DrawingError('SFRENDER147', 'Color glyph exceeds decoded byte budget');
    if (this.queue.length + this.active >= this.maxPending) throw new DrawingError('SFRENDER147', 'Pending color glyph budget exceeded');
    if (this.entries.size >= this.maxEntries) {
      for (const [key, previous] of this.entries) {
        if (previous.resolve) continue;
        previous.source?.close?.();
        if (previous.source) this.bytes -= previous.bytes;
        this.entries.delete(key);
        break;
      }
    }
    entry = {key: bitmap.key, bitmap, source: null, error: null, bytes, resolve: null, promise: null};
    entry.promise = new Promise(resolve => { entry.resolve = resolve; });
    this.entries.set(entry.key, entry);
    this.queue.push(entry);
    this.drain();
    return entry;
  }
  drain() {
    while (!this.closed && this.active < this.concurrency && this.queue.length) {
      const entry = this.queue.shift();
      this.active++;
      this.decodeEntry(entry);
    }
  }
  async decodeEntry(entry) {
    try {
      const result = await this.decode(entry.bitmap.png, {signal: this.controller.signal, type: 'image/png'});
      const source = result.source ?? result;
      if (this.closed) source.close?.();
      else if (source.width !== entry.bitmap.width || source.height !== entry.bitmap.height) {
        source.close?.();
        entry.error = new DrawingError('SFRENDER147', 'Decoded color glyph dimensions disagree with CBLC metrics');
      } else {
        this.evict(entry.bytes);
        entry.source = source;
        this.bytes += entry.bytes;
      }
    } catch (error) {
      entry.error = error instanceof DrawingError ? error : new DrawingError('SFRENDER147', `Color glyph decode failed: ${error.message}`);
    } finally {
      this.active--;
      entry.bitmap = null;
      entry.resolve(entry);
      entry.resolve = null;
      if (!this.closed) this.onChanged();
      this.drain();
    }
  }
  evict(bytes) {
    for (const [key, entry] of this.entries) {
      if (this.bytes + bytes <= this.maxBytes) break;
      if (!entry.source) continue;
      entry.source.close?.();
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
  async prepare(entries, signal) {
    for (const entry of entries) {
      signal?.throwIfAborted();
      await entry.promise;
      signal?.throwIfAborted();
      if (entry.error) throw entry.error;
      if (this.closed) throw new DrawingError('SFRENDER081', 'Color glyph decoder was disposed');
    }
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    for (const entry of this.entries.values()) entry.source?.close?.();
    for (const entry of this.queue) {
      entry.error = new DrawingError('SFRENDER081', 'Color glyph decode was cancelled by disposal');
      entry.resolve(entry);
    }
    this.queue.length = 0;
    this.entries.clear();
    this.bytes = 0;
  }
}
