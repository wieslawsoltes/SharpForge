import { hashObject } from './hash.js';
import { checkLimit } from './errors.js';

function sampleKey(bytes) {
  let value = bytes.length;
  const sample = Math.min(32, bytes.length);
  for (let index = 0; index < sample; index++) {
    value = Math.imul(value ^ bytes[index], 16777619);
    value = Math.imul(value ^ bytes[bytes.length - index - 1], 16777619);
  }
  return value;
}

function equalBytes(before, after) {
  if (before.length !== after.length) return false;
  for (let index = 0; index < before.length; index++) if (before[index] !== after[index]) return false;
  return true;
}

/** Bounded single-scan hash reuse. A sampled key selects one candidate; only exact bytes permit a hit. */
export class StatusContentCache {
  constructor(algorithm, { maxEntries = 256, maxBytes = 1024 * 1024, maxBlobBytes = 64 * 1024 } = {}) {
    this.algorithm = algorithm;
    this.maxEntries = checkLimit(maxEntries, 4096, 'Status content cache entries');
    this.maxBytes = checkLimit(maxBytes, 16 * 1024 * 1024, 'Status content cache bytes');
    this.maxBlobBytes = Math.min(checkLimit(maxBlobBytes, 64 * 1024, 'Status cached blob bytes'), maxBytes);
    this.entries = new Map();
    this.byteLength = 0;
  }

  hash(bytes) {
    if (!this.maxEntries || bytes.length > this.maxBlobBytes) {
      return hashObject('blob', bytes, { algorithm: this.algorithm });
    }
    const key = sampleKey(bytes);
    const previous = this.entries.get(key);
    if (previous && equalBytes(previous.bytes, bytes)) return previous.oid;
    return this.#insert(key, bytes, previous);
  }

  async #insert(key, bytes, previous) {
    const retained = new Uint8Array(bytes);
    const oid = await hashObject('blob', retained, { algorithm: this.algorithm });
    if (previous) {
      this.entries.delete(key);
      this.byteLength -= previous.bytes.length;
    }
    while (this.entries.size >= this.maxEntries || this.byteLength + retained.length > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      this.byteLength -= this.entries.get(oldest).bytes.length;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { oid, bytes: retained });
    this.byteLength += retained.length;
    return oid;
  }
}
