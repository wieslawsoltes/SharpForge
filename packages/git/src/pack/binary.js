import { GitError, checkLimit } from '../errors.js';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  return value >>> 0;
});

/** Incremental CRC is needed because a pack entry can span many network chunks. */
export class Crc32 {
  constructor() { this.value = 0xffffffff; }
  update(bytes) {
    let value = this.value;
    for (let index = 0; index < bytes.length; index++) value = crcTable[(value ^ bytes[index]) & 255] ^ (value >>> 8);
    this.value = value;
    return this;
  }
  digest() { return (this.value ^ 0xffffffff) >>> 0; }
}

export const PACK_TYPES = Object.freeze({ commit: 1, tree: 2, blob: 3, tag: 4, ofs: 6, ref: 7 });
export const PACK_TYPE_NAMES = Object.freeze({ 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' });

export function encodeObjectHeader(type, length) {
  checkLimit(length, Number.MAX_SAFE_INTEGER, 'Packed object size');
  if (![1, 2, 3, 4, 6, 7].includes(type)) throw new GitError('Corrupt', 'Invalid pack object type');
  const bytes = [(type << 4) | (length % 16)];
  length = Math.floor(length / 16);
  while (length) {
    bytes[bytes.length - 1] |= 128;
    bytes.push(length % 128);
    length = Math.floor(length / 128);
  }
  return Uint8Array.from(bytes);
}

export function encodeOffsetDelta(distance) {
  checkLimit(distance, Number.MAX_SAFE_INTEGER, 'Delta offset');
  if (!distance) throw new GitError('Corrupt', 'Delta offset must point backwards');
  const bytes = [distance % 128];
  while ((distance = Math.floor(distance / 128)) > 0) {
    distance--;
    bytes.unshift(128 | (distance % 128));
  }
  return Uint8Array.from(bytes);
}

export function writeUint32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, false);
}

export function readUint32(bytes, offset) {
  if (offset + 4 > bytes.length) throw new GitError('Corrupt', 'Truncated 32-bit field');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}
