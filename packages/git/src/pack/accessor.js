import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { hashBytes, hashObject } from '../hash.js';
import { bytesToHex, getObjectFormat } from '../object-format.js';
import { inflateZlibSync } from '../zlib.js';
import { applyDelta } from './delta.js';
import { Crc32, PACK_TYPE_NAMES, readUint32 } from './binary.js';
import { readPackIndex } from './index.js';

function entryHeader(pack, offset, algorithm) {
  const start = offset;
  let byte = pack[offset++];
  const code = (byte >>> 4) & 7;
  let size = byte & 15;
  let multiplier = 16;
  let count = 0;
  while (byte & 128) {
    if (++count > 8 || offset >= pack.length) throw new GitError('Corrupt', 'Truncated pack object header');
    byte = pack[offset++];
    size += (byte & 127) * multiplier;
    multiplier *= 128;
  }
  const entry = { type: PACK_TYPE_NAMES[code], size, start, offset };
  if (code === 6) {
    byte = pack[offset++];
    let distance = byte & 127;
    count = 0;
    while (byte & 128) {
      if (++count > 8 || offset >= pack.length) throw new GitError('Corrupt', 'Truncated delta offset');
      byte = pack[offset++];
      distance = (distance + 1) * 128 + (byte & 127);
    }
    if (!distance || distance > start - 12) throw new GitError('Corrupt', 'Pack delta offset is outside the pack');
    entry.baseOffset = start - distance;
  } else if (code === 7) {
    const length = getObjectFormat(algorithm).oidBytes;
    if (offset + length > pack.length) throw new GitError('Corrupt', 'Truncated reference delta base');
    entry.baseOid = bytesToHex(pack.subarray(offset, offset + length));
    offset += length;
  } else if (!entry.type) throw new GitError('Corrupt', 'Invalid packed object type');
  entry.offset = offset;
  return entry;
}

/** Random access to a verified pack with bounded decoded-object caching and delta-depth protection. */
export class IndexedPackReader {
  constructor({ pack, index, odb, algorithm = 'sha1', maxObjectBytes = 64 * 1024 * 1024, maxDepth = 128, cacheBytes = 8 * 1024 * 1024 }) {
    this.pack = pack;
    this.index = index;
    this.odb = odb;
    this.algorithm = algorithm;
    this.maxObjectBytes = maxObjectBytes;
    this.maxDepth = maxDepth;
    this.maxCacheBytes = cacheBytes;
    this.cache = new Map();
    this.cacheBytes = 0;
    this.offsets = new Map(index.entries().map(entry => [Number(entry.offset), entry]));
  }

  async has(oid) { return !!this.index.lookup(oid); }
  async list() { return this.index.entries().map(entry => entry.oid); }

  async read(oid, { signal } = {}) {
    const location = this.index.lookup(oid);
    if (!location) throw new GitError('NotFound', 'Object is not in the pack', { oid });
    return this.readAt(location, { signal, depth: 0, visiting: new Set() });
  }

  async readAt(location, context) {
    checkCancelled(context.signal);
    checkLimit(context.depth, this.maxDepth, 'Pack delta chain');
    const offset = Number(location.offset);
    checkLimit(offset, this.pack.length - getObjectFormat(this.algorithm).oidBytes - 1, 'Pack object offset');
    if (context.visiting.has(offset)) throw new GitError('Corrupt', 'Cyclic pack delta chain');
    if (this.cache.has(location.oid)) {
      const cached = this.cache.get(location.oid);
      this.cache.delete(location.oid);
      this.cache.set(location.oid, cached);
      return { ...cached, data: cached.data.slice() };
    }
    context.visiting.add(offset);
    try {
      const header = entryHeader(this.pack, offset, this.algorithm);
      checkLimit(header.size, this.maxObjectBytes, 'Packed object size');
      const limit = Math.min(this.pack.length - getObjectFormat(this.algorithm).oidBytes, header.offset + 72 * 1024 * 1024);
      const inflated = inflateZlibSync(this.pack.subarray(header.offset, limit), {
        maxOutputBytes: header.size, allowTrailing: true, signal: context.signal
      });
      if (inflated.data.length !== header.size) throw new GitError('Corrupt', 'Packed object size does not match');
      const crc = new Crc32().update(this.pack.subarray(offset, header.offset + inflated.bytesRead)).digest();
      if (crc !== location.crc) throw new GitError('Corrupt', 'Packed object CRC32 does not match');
      const result = await this.materialize(header, inflated.data, { ...context, depth: context.depth + 1 });
      const oid = await hashObject(result.type, result.data, { algorithm: this.algorithm });
      if (oid !== location.oid) throw new GitError('Corrupt', 'Packed object content does not match its index ID');
      const object = { ...result, oid, size: result.data.length };
      this.remember(object);
      return object;
    } finally { context.visiting.delete(offset); }
  }

  async materialize(header, bytes, context) {
    if (header.type) return { type: header.type, data: bytes };
    const location = header.baseOffset !== undefined ? this.offsets.get(header.baseOffset) : this.index.lookup(header.baseOid);
    const base = location ? await this.readAt(location, context) : await this.odb?.read(header.baseOid, { signal: context.signal });
    if (!base) throw new GitError('Corrupt', 'Pack delta base is missing');
    return { type: base.type, data: applyDelta(base.data, bytes, { maxObjectBytes: this.maxObjectBytes, signal: context.signal }) };
  }

  remember(object) {
    if (object.size > this.maxCacheBytes) return;
    this.cache.set(object.oid, { ...object, data: object.data.slice() });
    this.cacheBytes += object.size;
    while (this.cacheBytes > this.maxCacheBytes) {
      const key = this.cache.keys().next().value;
      this.cacheBytes -= this.cache.get(key).size;
      this.cache.delete(key);
    }
  }
}

export async function createPackReader(options) {
  const { pack, algorithm = 'sha1' } = options;
  const format = getObjectFormat(algorithm);
  if (pack.length < 12 + format.oidBytes || readUint32(pack, 0) !== 0x5041434b || ![2, 3].includes(readUint32(pack, 4))) {
    throw new GitError('Corrupt', 'Invalid pack header');
  }
  const index = options.index instanceof Uint8Array ? await readPackIndex(options.index, options) : options.index;
  if (index.count !== readUint32(pack, 8)) throw new GitError('Corrupt', 'Pack and index object counts differ');
  const checksum = bytesToHex(pack.subarray(pack.length - format.oidBytes));
  if (checksum !== index.packChecksum || await hashBytes(pack.subarray(0, pack.length - format.oidBytes), { algorithm }) !== checksum) {
    throw new GitError('Corrupt', 'Pack checksum does not match its index');
  }
  return new IndexedPackReader({ ...options, index });
}
