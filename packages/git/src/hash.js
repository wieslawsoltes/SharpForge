import { GitError, checkCancelled, checkLimit } from './errors.js';
import { bytesToHex, getObjectFormat } from './object-format.js';
import { objectHeader } from './objects/framing.js';
import { asBytes, concatenateBytes } from './hash/bytes.js';
import { Sha1CollisionDetecting } from './hash/sha1dc.js';
import { Sha256 } from './hash/sha256.js';

const engines = Object.freeze({ sha1: Sha1CollisionDetecting, sha256: Sha256 });

/** Incremental O(n) hashing with constant scratch memory; digest finalizes and is repeatable. */
export class IncrementalHash {
  constructor(options = {}) {
    if (typeof options === 'string') options = { algorithm: options };
    this.algorithm = getObjectFormat(options.algorithm).name;
    this.engine = new engines[this.algorithm]();
    this.buffer = new Uint8Array(64);
    this.bufferLength = 0;
    this.totalBytes = 0;
    this.maxBytes = options.maxBytes ?? Number.MAX_SAFE_INTEGER;
    this.signal = options.signal;
    this.result = null;
    this.failure = null;
    checkLimit(this.maxBytes, Number.MAX_SAFE_INTEGER, 'Hash input limit');
  }

  /** Consume bytes immediately without retaining the caller's input buffers. */
  update(input) {
    if (this.failure) throw this.failure;
    if (this.result) throw new GitError('Conflict', 'Cannot update a finalized hash');
    checkCancelled(this.signal);
    const bytes = asBytes(input);
    this.totalBytes = checkLimit(this.totalBytes + bytes.length, this.maxBytes, 'Hash input size');
    let offset = 0;
    try {
      if (this.bufferLength) {
        const take = Math.min(64 - this.bufferLength, bytes.length);
        this.buffer.set(bytes.subarray(0, take), this.bufferLength);
        this.bufferLength += take;
        offset += take;
        if (this.bufferLength === 64) {
          this.engine.processBlock(this.buffer, 0);
          this.bufferLength = 0;
        }
      }
      let nextCancellationCheck = offset;
      while (offset + 64 <= bytes.length) {
        if (offset >= nextCancellationCheck) {
          checkCancelled(this.signal);
          nextCancellationCheck = offset + 65536;
        }
        this.engine.processBlock(bytes, offset);
        offset += 64;
      }
      this.buffer.set(bytes.subarray(offset), this.bufferLength);
      this.bufferLength += bytes.length - offset;
    } catch (error) {
      this.failure = error;
      throw error;
    }
    return this;
  }

  /** Return lowercase hex (default) or an owned byte array; never publish a collision digest. */
  digest(encoding = 'hex') {
    if (!['hex', 'bytes'].includes(encoding)) throw new TypeError('Hash encoding must be hex or bytes');
    if (this.failure) throw this.failure;
    checkCancelled(this.signal);
    if (!this.result) this.finalize();
    return encoding === 'hex' ? bytesToHex(this.result) : this.result.slice();
  }

  finalize() {
    if (this.result) return;
    const padding = new Uint8Array(this.bufferLength < 56 ? 64 : 128);
    padding.set(this.buffer.subarray(0, this.bufferLength));
    padding[this.bufferLength] = 128;
    const view = new DataView(padding.buffer);
    view.setUint32(padding.length - 8, Math.floor(this.totalBytes / 0x20000000));
    view.setUint32(padding.length - 4, (this.totalBytes % 0x20000000) * 8);
    try {
      for (let offset = 0; offset < padding.length; offset += 64) this.engine.processBlock(padding, offset);
    } catch (error) {
      this.failure = error;
      throw error;
    }
    this.result = new Uint8Array(this.engine.state.length * 4);
    const output = new DataView(this.result.buffer);
    for (let index = 0; index < this.engine.state.length; index++) output.setUint32(index * 4, this.engine.state[index]);
    this.buffer.fill(0);
  }
}

/** Hash bytes; SHA-256 uses WebCrypto when available, SHA-1 always uses collision detection. */
export async function hashBytes(input, options = {}) {
  const bytes = asBytes(input);
  const format = getObjectFormat(options.algorithm);
  checkCancelled(options.signal);
  checkLimit(bytes.length, options.maxBytes ?? Number.MAX_SAFE_INTEGER, 'Hash input size');
  const subtle = options.subtle === undefined ? globalThis.crypto?.subtle : options.subtle;
  if (format.name === 'sha256' && subtle) {
    try {
      const result = new Uint8Array(await subtle.digest('SHA-256', bytes));
      checkCancelled(options.signal);
      return bytesToHex(result);
    } catch (error) {
      if (error?.name !== 'NotSupportedError') throw error;
      // An engine exposing subtle without SHA-256 support uses the explicit portable backend.
    }
  }
  return new IncrementalHash(options).update(bytes).digest();
}

/** Hash a stored Git object; WebCrypto SHA-256 uses a contiguous buffer, portable engines consume two chunks. */
export async function hashObject(type, input, options = {}) {
  const data = asBytes(input);
  const header = objectHeader(type, data.length, options.maxObjectBytes);
  const format = getObjectFormat(options.algorithm);
  const subtle = options.subtle === undefined ? globalThis.crypto?.subtle : options.subtle;
  if (format.name === 'sha256' && subtle) {
    checkCancelled(options.signal);
    checkLimit(header.length + data.length, options.maxBytes ?? Number.MAX_SAFE_INTEGER, 'Hash input size');
    return hashBytes(concatenateBytes([header, data]), options);
  }
  const hash = new IncrementalHash(options);
  hash.update(header);
  hash.update(data);
  return hash.digest();
}
