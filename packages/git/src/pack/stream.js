import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { byteChunks } from '../protocol/bytes.js';
import { inflateZlibSync } from '../zlib.js';
import { IncrementalHash } from '../hash.js';
import { Crc32 } from './binary.js';

/** A growable bounded read window. Consumed bytes are hashed once and discarded on compaction. */
export class PackByteReader {
  constructor(source, { algorithm = 'sha1', signal, maxBufferedBytes = 72 * 1024 * 1024, maxPackBytes = 4 * 1024 ** 3 } = {}) {
    this.iterator = byteChunks(source, { signal })[Symbol.asyncIterator]();
    this.signal = signal;
    this.maximum = maxBufferedBytes;
    this.maxPackBytes = maxPackBytes;
    this.buffer = new Uint8Array(Math.min(65536, maxBufferedBytes));
    this.start = 0;
    this.end = 0;
    this.offset = 0;
    this.chunk = null;
    this.chunkOffset = 0;
    this.done = false;
    this.hash = new IncrementalHash({ algorithm });
    this.crc = null;
  }

  get available() { return this.end - this.start; }

  async ensure(minimum, allowEnd = false) {
    checkLimit(minimum, this.maximum, 'Pack read window');
    while (this.available < minimum && !this.done) {
      checkCancelled(this.signal);
      if (!this.chunk || this.chunkOffset === this.chunk.length) {
        const next = await this.iterator.next();
        if (next.done) { this.done = true; break; }
        this.chunk = next.value;
        this.chunkOffset = 0;
        if (!this.chunk.length) continue;
      }
      this.reserve(minimum);
      const length = Math.min(this.buffer.length - this.end, this.chunk.length - this.chunkOffset);
      this.buffer.set(this.chunk.subarray(this.chunkOffset, this.chunkOffset + length), this.end);
      this.end += length;
      this.chunkOffset += length;
    }
    if (this.available < minimum && !allowEnd) throw new GitError('Corrupt', 'Truncated packfile', { offset: this.offset });
    return this.available;
  }

  reserve(minimum) {
    if (this.start && (this.end === this.buffer.length || this.buffer.length < minimum)) {
      this.buffer.copyWithin(0, this.start, this.end);
      this.end -= this.start;
      this.start = 0;
    }
    if (this.buffer.length >= minimum && this.end < this.buffer.length) return;
    const capacity = Math.min(this.maximum, Math.max(minimum, this.buffer.length * 2));
    if (capacity <= this.buffer.length) throw new GitError('Limit', 'Pack read window exhausted');
    const buffer = new Uint8Array(capacity);
    buffer.set(this.buffer.subarray(this.start, this.end));
    this.end -= this.start;
    this.start = 0;
    this.buffer = buffer;
  }

  consume(length, hash = true) {
    if (length > this.available) throw new GitError('Corrupt', 'Pack reader exceeded its buffer');
    const bytes = this.buffer.subarray(this.start, this.start + length);
    if (hash) { this.hash.update(bytes); this.crc?.update(bytes); }
    this.start += length;
    this.offset = checkLimit(this.offset + length, this.maxPackBytes, 'Packfile bytes');
    return bytes;
  }

  async read(length, hash = true) { await this.ensure(length); return this.consume(length, hash); }
  async byte() { return (await this.read(1))[0]; }
  beginEntry() { this.crc = new Crc32(); }
  endEntry() { const value = this.crc.digest(); this.crc = null; return value; }

  async inflate(size, { maxObjectBytes = 64 * 1024 * 1024 } = {}) {
    checkLimit(size, maxObjectBytes, 'Inflated pack object');
    await this.ensure(Math.min(64, this.maximum), true);
    while (true) {
      checkCancelled(this.signal);
      try {
        const result = inflateZlibSync(this.buffer.subarray(this.start, this.end), {
          maxOutputBytes: size, allowTrailing: true, signal: this.signal
        });
        if (result.data.length !== size) throw new GitError('Corrupt', 'Packed object size differs from its header');
        this.consume(result.bytesRead);
        return result.data;
      } catch (error) {
        if (!error.details?.truncated || this.done) throw error;
        const previous = this.available;
        const wanted = Math.min(this.maximum, Math.max(previous + 1, previous * 2, 1024));
        if (wanted <= previous) throw new GitError('Limit', 'Compressed pack object exceeds the read window');
        await this.ensure(wanted, true);
        if (this.available === previous && this.done) throw error;
      }
    }
  }

  async finish() {
    await this.ensure(1, true);
    if (this.available) throw new GitError('Corrupt', 'Unexpected data after pack checksum');
  }

  async close() { await this.iterator.return?.(); }
}
