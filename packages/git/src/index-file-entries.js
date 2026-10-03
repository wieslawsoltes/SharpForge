import { GitError, checkLimit } from './errors.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const statFields = ['ctimeSeconds', 'ctimeNanoseconds', 'mtimeSeconds', 'mtimeNanoseconds', 'dev', 'ino', 'mode', 'uid', 'gid', 'size'];

function readVarint(bytes, cursor, end) {
  let value = 0;
  let count = 0;
  while (cursor.position < end) {
    const byte = bytes[cursor.position++];
    if (++count > 5) throw new GitError('Corrupt', 'Index path prefix integer overflows');
    value = value * 128 + (byte & 127);
    if (!(byte & 128)) return value;
    value++;
  }
  throw new GitError('Corrupt', 'Truncated index path prefix integer');
}

function writeVarint(value) {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.push(128 | (--value & 127));
  return Uint8Array.from(bytes.reverse());
}

function readName(bytes, cursor, options) {
  const { end, version, previous, flags, start } = options;
  const strip = version === 4 ? readVarint(bytes, cursor, end) : 0;
  if (strip > previous.length) throw new GitError('Corrupt', 'Index path prefix exceeds previous path');
  const stop = bytes.indexOf(0, cursor.position);
  if (stop === -1 || stop >= end) throw new GitError('Corrupt', 'Unterminated Git index path');
  const suffix = bytes.subarray(cursor.position, stop);
  const prefixLength = version === 4 ? previous.length - strip : 0;
  checkLimit(prefixLength + suffix.length, 32768, 'Index entry path');
  const name = new Uint8Array(prefixLength + suffix.length);
  name.set(previous.subarray(0, prefixLength));
  name.set(suffix, prefixLength);
  if ((flags & 4095) !== Math.min(name.length, 4095)) throw new GitError('Corrupt', 'Git index path length mismatch');
  cursor.position = stop + 1;
  if (version !== 4) cursor.position = start + Math.ceil((cursor.position - start) / 8) * 8;
  if (cursor.position > end) throw new GitError('Corrupt', 'Truncated index entry padding');
  return name;
}

export function decodeIndexEntries(bytes, { count, version, hashLength, end }) {
  const entries = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cursor = { position: 12 };
  let previous = new Uint8Array();
  for (let index = 0; index < count; index++) {
    const start = cursor.position;
    if (start + 42 + hashLength > end) throw new GitError('Corrupt', 'Truncated Git index entry');
    const stat = {};
    for (let field = 0; field < statFields.length; field++) stat[statFields[field]] = view.getUint32(start + field * 4);
    const oid = Array.from(bytes.subarray(start + 40, start + 40 + hashLength), byte => byte.toString(16).padStart(2, '0')).join('');
    const flags = view.getUint16(start + 40 + hashLength);
    cursor.position += 42 + hashLength;
    let extendedFlags = 0;
    if (flags & 0x4000) {
      if (version === 2 || cursor.position + 2 > end) throw new GitError('Corrupt', 'Invalid extended Git index flags');
      extendedFlags = view.getUint16(cursor.position);
      cursor.position += 2;
    }
    const nameBytes = readName(bytes, cursor, { end, version, previous, flags, start });
    let path;
    try { path = decoder.decode(nameBytes); } catch { throw new GitError('Unsupported', 'Index filename is not UTF-8'); }
    if (!path) throw new GitError('Unsupported', 'Split index entries require expansion');
    entries.push({ path, nameBytes, oid, mode: stat.mode, stat, stage: flags >> 12 & 3,
      assumeValid: !!(flags & 0x8000), extendedFlags, extended: !!(flags & 0x4000),
      intentToAdd: !!(extendedFlags & 0x2000), skipWorktree: !!(extendedFlags & 0x4000) });
    previous = nameBytes;
  }
  return { entries, position: cursor.position };
}

function encodeEntry(entry, { version, hashLength, previous }) {
  const name = encoder.encode(entry.path);
  const extendedFlags = (entry.extendedFlags ?? 0) & ~0x6000
    | (entry.intentToAdd ? 0x2000 : 0) | (entry.skipWorktree ? 0x4000 : 0);
  const extended = version > 2 && (entry.extended || extendedFlags !== 0);
  const fixed = 42 + hashLength + (extended ? 2 : 0);
  let common = 0;
  if (version === 4) while (common < Math.min(name.length, previous.length) && name[common] === previous[common]) common++;
  const prefix = version === 4 ? writeVarint(previous.length - common) : new Uint8Array();
  const unpadded = fixed + prefix.length + name.length - common + 1;
  const result = new Uint8Array(version === 4 ? unpadded : Math.ceil(unpadded / 8) * 8);
  const view = new DataView(result.buffer);
  for (let field = 0; field < statFields.length; field++) {
    const key = statFields[field];
    view.setUint32(field * 4, key === 'mode' ? entry.mode : entry.stat?.[key] ?? 0);
  }
  if (!new RegExp(`^[a-f0-9]{${hashLength * 2}}$`, 'u').test(entry.oid)) throw new GitError('Corrupt', 'Invalid index object id');
  result.set(Uint8Array.from(entry.oid.match(/../gu), part => Number.parseInt(part, 16)), 40);
  const flags = Math.min(name.length, 4095) | (entry.stage ?? 0) << 12 | (extended ? 0x4000 : 0) | (entry.assumeValid ? 0x8000 : 0);
  view.setUint16(40 + hashLength, flags);
  if (extended) view.setUint16(42 + hashLength, extendedFlags);
  result.set(prefix, fixed);
  result.set(name.subarray(common), fixed + prefix.length);
  return { data: result, name };
}

export function encodeIndexEntries(entries, { version, hashLength }) {
  const parts = [];
  let previous = new Uint8Array();
  let length = 0;
  for (const entry of entries) {
    const encoded = encodeEntry(entry, { version, hashLength, previous });
    parts.push(encoded.data);
    length += encoded.data.length;
    previous = encoded.name;
  }
  checkLimit(length, 256 * 1024 * 1024, 'Encoded Git index bytes');
  const result = new Uint8Array(length);
  let position = 0;
  for (const part of parts) {
    result.set(part, position);
    position += part.length;
  }
  return result;
}
