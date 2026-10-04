import { zipError } from './zip-budgets.js';

export const ZIP64_SENTINEL = 0xffffffff;
export const ZIP64_COUNT = 0xffff;
export const zipView = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export function readUint64(view, offset) {
  if (offset < 0 || offset + 8 > view.byteLength) zipError('SFZIP008', 'Truncated ZIP64 integer');
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) zipError('SFZIP002', 'ZIP64 integer exceeds safe precision');
  return Number(value);
}

export function writeUint64(view, offset, value) {
  if (!Number.isSafeInteger(value) || value < 0) zipError('SFZIP002', 'Invalid ZIP64 integer');
  view.setBigUint64(offset, BigInt(value), true);
}

export function parseExtraFields(bytes) {
  const fields = new Map();
  const view = zipView(bytes);
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) zipError('SFZIP008', 'Truncated ZIP extra field');
    const id = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    offset += 4;
    if (offset + length > bytes.length || fields.has(id)) zipError('SFZIP008', 'Invalid or duplicate ZIP extra field');
    fields.set(id, bytes.subarray(offset, offset + length));
    offset += length;
  }
  return fields;
}

/** APPNOTE 6.3.10 section 4.5.3: fields appear only for saturated header values. */
export function resolveZip64(fields, header) {
  const result = { ...header };
  const needed = ['length', 'compressed', 'local'].filter(key => header[key] === ZIP64_SENTINEL);
  const hasDisk = header.disk === ZIP64_COUNT;
  if (!needed.length && !hasDisk) return result;
  const bytes = fields.get(1);
  if (!bytes || bytes.length !== needed.length * 8 + (hasDisk ? 4 : 0)) {
    zipError('SFZIP008', 'Missing or malformed ZIP64 extra field');
  }
  const view = zipView(bytes);
  needed.forEach((key, index) => { result[key] = readUint64(view, index * 8); });
  if (hasDisk) result.disk = view.getUint32(needed.length * 8, true);
  result.zip64 = true;
  return result;
}

export function zip64Extra(values) {
  if (!values.length) return new Uint8Array();
  const bytes = new Uint8Array(4 + values.length * 8);
  const view = zipView(bytes);
  view.setUint16(0, 1, true);
  view.setUint16(2, values.length * 8, true);
  values.forEach((value, index) => writeUint64(view, 4 + index * 8, value));
  return bytes;
}

export function findZipEnd(bytes, archiveSize = bytes.length) {
  const view = zipView(bytes);
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      if (view.getUint16(offset + 4, true) || view.getUint16(offset + 6, true)) {
        zipError('SFZIP009', 'Multi-disk ZIP archives are not supported');
      }
      const count = view.getUint16(offset + 10, true);
      if (view.getUint16(offset + 8, true) !== count) zipError('SFZIP009', 'ZIP disk entry count mismatch');
      return {
        offset: archiveSize - bytes.length + offset,
        count,
        size: view.getUint32(offset + 12, true),
        start: view.getUint32(offset + 16, true)
      };
    }
  }
  zipError('SFZIP008', 'ZIP end directory was not found');
}

export function needsZip64(end) {
  return end.count === ZIP64_COUNT || end.size === ZIP64_SENTINEL || end.start === ZIP64_SENTINEL;
}

export function readZip64Locator(bytes, endOffset) {
  const view = zipView(bytes);
  if (bytes.length !== 20 || view.getUint32(0, true) !== 0x07064b50) zipError('SFZIP008', 'Missing ZIP64 locator');
  if (view.getUint32(4, true) || view.getUint32(16, true) !== 1) zipError('SFZIP009', 'Multi-disk ZIP64 is not supported');
  const offset = readUint64(view, 8);
  if (offset + 56 > endOffset - 20) zipError('SFZIP008', 'ZIP64 end record overlaps locator');
  return offset;
}

export function readZip64End(bytes, offset, endOffset) {
  const view = zipView(bytes);
  if (bytes.length < 56 || view.getUint32(0, true) !== 0x06064b50) zipError('SFZIP008', 'Invalid ZIP64 end record');
  const length = readUint64(view, 4);
  if (length < 44 || offset + 12 + length !== endOffset - 20) zipError('SFZIP008', 'Invalid ZIP64 end record length');
  if (view.getUint16(14, true) > 45 || view.getUint32(16, true) || view.getUint32(20, true)) {
    zipError('SFZIP009', 'Unsupported or multi-disk ZIP64 record');
  }
  const count = readUint64(view, 32);
  if (readUint64(view, 24) !== count) zipError('SFZIP009', 'ZIP64 disk entry count mismatch');
  return { count, size: readUint64(view, 40), start: readUint64(view, 48), offset, zip64: true };
}

export function writeZipEnd({ count, size, start, forceZip64 = false }) {
  const large = forceZip64 || count >= ZIP64_COUNT || size >= ZIP64_SENTINEL || start >= ZIP64_SENTINEL;
  const bytes = new Uint8Array(large ? 98 : 22);
  const view = zipView(bytes);
  let offset = 0;
  if (large) {
    view.setUint32(0, 0x06064b50, true);
    writeUint64(view, 4, 44);
    view.setUint16(12, 0x32d, true);
    view.setUint16(14, 45, true);
    writeUint64(view, 24, count);
    writeUint64(view, 32, count);
    writeUint64(view, 40, size);
    writeUint64(view, 48, start);
    view.setUint32(56, 0x07064b50, true);
    writeUint64(view, 64, start + size);
    view.setUint32(72, 1, true);
    offset = 76;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 8, Math.min(count, ZIP64_COUNT), true);
  view.setUint16(offset + 10, Math.min(count, ZIP64_COUNT), true);
  view.setUint32(offset + 12, Math.min(size, ZIP64_SENTINEL), true);
  view.setUint32(offset + 16, Math.min(start, ZIP64_SENTINEL), true);
  return bytes;
}
