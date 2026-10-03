import { Writer, CilError, utf8, equalBytes } from '../binary.js';

function byteHash(bytes) {
  let hash = 2166136261;
  for (const value of bytes) hash = Math.imul(hash ^ value, 16777619);
  return hash >>> 0;
}

/** Hashes bytes without serializing them; collision buckets compare the owned bytes. */
class ByteEntries {
  constructor(writer, guid = false) {
    this.writer = writer;
    this.guid = guid;
    this.buckets = new Map();
  }

  intern(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new CilError('Metadata heap value must be Uint8Array');
    const hash = byteHash(bytes);
    const entries = this.buckets.get(hash) ?? [];
    for (const entry of entries) if (equalBytes(entry.bytes, bytes)) return entry.index;
    const index = this.guid ? this.writer.length / 16 + 1 : this.writer.length;
    if (!this.guid) this.writer.compressed(bytes.length);
    this.writer.bytes(bytes);
    entries.push({ bytes: new Uint8Array(bytes), index });
    this.buckets.set(hash, entries);
    return index;
  }
}

/** Mutable heap builders. GUID indexes are one based; byte heap indexes are offsets. */
export class MetadataHeaps {
  constructor() {
    this.strings = new Writer().u8(0);
    this.blobs = new Writer().u8(0);
    this.userStrings = new Writer().u8(0);
    // Entry one is the module MVID, finalized from the emitted content.
    this.guids = new Writer().zero(16);
    this.stringMap = new Map([['', 0]]);
    this.userStringMap = new Map();
    this.blobEntries = new ByteEntries(this.blobs);
    this.guidEntries = new ByteEntries(this.guids, true);
  }

  string(value) {
    value = String(value);
    if (value.includes('\0')) throw new CilError('Metadata identifiers cannot contain NUL');
    if (this.stringMap.has(value)) return this.stringMap.get(value);
    const index = this.strings.length;
    this.strings.bytes(utf8(value)).u8(0);
    this.stringMap.set(value, index);
    return index;
  }

  blob(bytes) {
    return this.blobEntries.intern(bytes);
  }

  guid(bytes) {
    if (bytes?.length !== 16) throw new CilError('Metadata GUID must contain 16 bytes');
    return this.guidEntries.intern(bytes);
  }

  userString(value) {
    if (typeof value !== 'string') throw new CilError('User string must be a string');
    if (this.userStringMap.has(value)) return this.userStringMap.get(value);
    const index = this.userStrings.length;
    if (index > 0xffffff) throw new CilError('User-string heap exceeds CLI token range');
    const bytes = new Writer();
    let special = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      bytes.u16(code);
      if (code > 0xff || (code >= 1 && code <= 8) || (code >= 14 && code <= 31) || (code === 39 || code === 45 || code === 127)) special = 1;
    }
    bytes.u8(special);
    this.userStrings.compressed(bytes.length).bytes(bytes.finish());
    this.userStringMap.set(value, index);
    return index;
  }

  get flags() {
    return (this.strings.length >= 65536 ? 1 : 0)
      | (this.guids.length >= 65536 ? 2 : 0)
      | (this.blobs.length >= 65536 ? 4 : 0);
  }

  finish(mvid) {
    const guids = this.guids.finish();
    guids.set(mvid, 0);
    return [['#Strings', this.strings.finish()], ['#US', this.userStrings.finish()],
      ['#GUID', guids], ['#Blob', this.blobs.finish()]];
  }
}
