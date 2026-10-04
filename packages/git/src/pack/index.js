import { GitError, checkLimit } from '../errors.js';
import { hashBytes } from '../hash.js';
import { getObjectFormat, bytesToHex, hexToBytes } from '../object-format.js';
import { validateWireOid } from '../protocol/advertisement.js';
import { readUint32, writeUint32 } from './binary.js';

/** Create Git IDX2, including 64-bit offsets and both pack/index checksums. */
export async function writePackIndex(entries, packChecksum, { algorithm = 'sha1', maxObjects = 1_000_000 } = {}) {
  const format = getObjectFormat(algorithm);
  validateWireOid(packChecksum, algorithm);
  checkLimit(entries.length, maxObjects, 'Pack index objects');
  const sorted = [...entries].sort((left, right) => left.oid.localeCompare(right.oid));
  const large = sorted.filter(entry => BigInt(entry.offset) >= 0x80000000n);
  const length = 8 + 1024 + entries.length * (format.oidBytes + 8) + large.length * 8 + format.oidBytes * 2;
  const bytes = new Uint8Array(length);
  bytes.set([255, 116, 79, 99, 0, 0, 0, 2]);
  const fanout = new Uint32Array(256);
  for (const entry of sorted) {
    validateWireOid(entry.oid, algorithm);
    fanout[Number.parseInt(entry.oid.slice(0, 2), 16)]++;
  }
  for (let index = 0, total = 0; index < 256; index++) { total += fanout[index]; writeUint32(bytes, 8 + index * 4, total); }
  const namesOffset = 1032;
  const crcOffset = namesOffset + entries.length * format.oidBytes;
  const offsetsOffset = crcOffset + entries.length * 4;
  const largeOffset = offsetsOffset + entries.length * 4;
  let largeIndex = 0;
  sorted.forEach((entry, index) => {
    if (index && sorted[index - 1].oid === entry.oid) throw new GitError('Corrupt', 'Pack index contains duplicate object IDs');
    bytes.set(hexToBytes(entry.oid), namesOffset + index * format.oidBytes);
    writeUint32(bytes, crcOffset + index * 4, entry.crc);
    const offset = BigInt(entry.offset);
    if (offset < 12n || offset > 0x7fffffffffffffffn) throw new GitError('Corrupt', 'Invalid pack index offset');
    if (offset < 0x80000000n) writeUint32(bytes, offsetsOffset + index * 4, Number(offset));
    else {
      writeUint32(bytes, offsetsOffset + index * 4, (0x80000000 + largeIndex) >>> 0);
      new DataView(bytes.buffer).setBigUint64(largeOffset + largeIndex++ * 8, offset, false);
    }
  });
  const checksumOffset = length - format.oidBytes * 2;
  bytes.set(hexToBytes(packChecksum), checksumOffset);
  const checksum = await hashBytes(bytes.subarray(0, length - format.oidBytes), { algorithm });
  bytes.set(hexToBytes(checksum), length - format.oidBytes);
  return bytes;
}

/** Validate an IDX2 and expose logarithmic object lookup. Offsets above MAX_SAFE_INTEGER are BigInts. */
export async function readPackIndex(bytes, { algorithm = 'sha1', maxObjects = 1_000_000 } = {}) {
  const format = getObjectFormat(algorithm);
  if (bytes.length < 1032 + format.oidBytes * 2 || readUint32(bytes, 0) !== 0xff744f63 || readUint32(bytes, 4) !== 2) {
    throw new GitError('Corrupt', 'Invalid pack index header');
  }
  const count = checkLimit(readUint32(bytes, 1028), maxObjects, 'Pack index objects');
  const namesOffset = 1032;
  const crcOffset = namesOffset + count * format.oidBytes;
  const offsetsOffset = crcOffset + count * 4;
  const largeOffset = offsetsOffset + count * 4;
  const checksumOffset = bytes.length - format.oidBytes * 2;
  if (checksumOffset < largeOffset || (checksumOffset - largeOffset) % 8) throw new GitError('Corrupt', 'Truncated pack index tables');
  const expected = bytesToHex(bytes.subarray(bytes.length - format.oidBytes));
  if (await hashBytes(bytes.subarray(0, bytes.length - format.oidBytes), { algorithm }) !== expected) {
    throw new GitError('Corrupt', 'Pack index checksum does not match');
  }
  const oids = new Array(count);
  const fanout = new Uint32Array(256);
  for (let index = 0; index < count; index++) {
    oids[index] = bytesToHex(bytes.subarray(namesOffset + index * format.oidBytes, namesOffset + (index + 1) * format.oidBytes));
    if (index && oids[index - 1] >= oids[index]) throw new GitError('Corrupt', 'Pack index IDs are not strictly ordered');
    fanout[Number.parseInt(oids[index].slice(0, 2), 16)]++;
  }
  for (let index = 0, total = 0; index < 256; index++) {
    total += fanout[index];
    if (readUint32(bytes, 8 + index * 4) !== total) throw new GitError('Corrupt', 'Pack index fanout does not match object IDs');
  }
  function entry(index) {
    let offset = BigInt(readUint32(bytes, offsetsOffset + index * 4));
    if (offset & 0x80000000n) {
      const position = largeOffset + Number(offset & 0x7fffffffn) * 8;
      if (position + 8 > checksumOffset) throw new GitError('Corrupt', 'Pack index large offset exceeds its table');
      offset = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(position, false);
    }
    if (offset < 12n) throw new GitError('Corrupt', 'Pack index offset points into its header');
    return { oid: oids[index], crc: readUint32(bytes, crcOffset + index * 4),
      offset: offset <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(offset) : offset };
  }
  for (let index = 0; index < count; index++) entry(index);
  return {
    version: 2, count, packChecksum: bytesToHex(bytes.subarray(checksumOffset, checksumOffset + format.oidBytes)),
    lookup(oid) {
      validateWireOid(oid, algorithm);
      const first = Number.parseInt(oid.slice(0, 2), 16);
      let low = first ? readUint32(bytes, 8 + (first - 1) * 4) : 0;
      let high = readUint32(bytes, 8 + first * 4) - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (oids[middle] === oid) return entry(middle);
        if (oids[middle] < oid) low = middle + 1;
        else high = middle - 1;
      }
      return null;
    },
    entries() { return oids.map((_, index) => entry(index)); }
  };
}

/** Explicit registration keeps multi-pack lookup separate from storage and pack decompression. */
export class MultiPackIndex {
  constructor() { this.packs = new Map(); this.locations = new Map(); }
  add(id, index, reader) {
    if (this.packs.has(id)) throw new GitError('Conflict', 'Pack is already registered', { id });
    this.packs.set(id, { index, reader });
    for (const entry of index.entries()) if (!this.locations.has(entry.oid)) this.locations.set(entry.oid, { id, ...entry });
  }
  has(oid) { return this.locations.has(oid); }
  list() { return [...this.locations.keys()].sort(); }
  async read(oid, options) {
    const location = this.locations.get(oid);
    if (!location) throw new GitError('NotFound', 'Object does not exist in registered packs', { oid });
    return this.packs.get(location.id).reader.read(oid, { ...options, offset: location.offset });
  }
  remove(id) {
    if (!this.packs.delete(id)) return false;
    this.locations.clear();
    for (const [packId, pack] of this.packs) {
      for (const entry of pack.index.entries()) if (!this.locations.has(entry.oid)) this.locations.set(entry.oid, { id: packId, ...entry });
    }
    return true;
  }
}
