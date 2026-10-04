import { zipView, zip64Extra, ZIP64_SENTINEL, writeUint64 } from './zip64.js';

export function concatBytes(parts) {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export function localHeader(entry, { descriptor = false, forceZip64 = false } = {}) {
  const zip64 = forceZip64 || entry.length >= ZIP64_SENTINEL || entry.compressed >= ZIP64_SENTINEL;
  const extra = concatBytes([zip64Extra(zip64 ? [entry.length, entry.compressed] : []), entry.extra]);
  const bytes = new Uint8Array(30 + entry.name.length + extra.length);
  const view = zipView(bytes);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, zip64 ? 45 : 20, true);
  view.setUint16(6, 0x800 | (descriptor ? 8 : 0), true);
  view.setUint16(8, entry.method, true);
  view.setUint16(10, entry.dosTime, true);
  view.setUint16(12, entry.dosDate, true);
  view.setUint32(14, descriptor ? 0 : entry.crc, true);
  view.setUint32(18, zip64 ? ZIP64_SENTINEL : descriptor ? 0 : entry.compressed, true);
  view.setUint32(22, zip64 ? ZIP64_SENTINEL : descriptor ? 0 : entry.length, true);
  view.setUint16(26, entry.name.length, true);
  view.setUint16(28, extra.length, true);
  bytes.set(entry.name, 30);
  bytes.set(extra, 30 + entry.name.length);
  return bytes;
}

export function centralHeader(entry, { descriptor = false, forceZip64 = false } = {}) {
  const largeSize = forceZip64 || entry.length >= ZIP64_SENTINEL || entry.compressed >= ZIP64_SENTINEL;
  const largeOffset = entry.local >= ZIP64_SENTINEL;
  const values = [...(largeSize ? [entry.length, entry.compressed] : []), ...(largeOffset ? [entry.local] : [])];
  const extra = concatBytes([zip64Extra(values), entry.extra]);
  const bytes = new Uint8Array(46 + entry.name.length + extra.length);
  const view = zipView(bytes);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 0x32d, true);
  view.setUint16(6, values.length ? 45 : 20, true);
  view.setUint16(8, 0x800 | (descriptor ? 8 : 0), true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, entry.dosTime, true);
  view.setUint16(14, entry.dosDate, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, largeSize ? ZIP64_SENTINEL : entry.compressed, true);
  view.setUint32(24, largeSize ? ZIP64_SENTINEL : entry.length, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint16(30, extra.length, true);
  view.setUint32(38, ((entry.mode << 16) | (entry.directory ? 16 : 0)) >>> 0, true);
  view.setUint32(42, largeOffset ? ZIP64_SENTINEL : entry.local, true);
  bytes.set(entry.name, 46);
  bytes.set(extra, 46 + entry.name.length);
  return bytes;
}

export function dataDescriptor(entry, zip64) {
  const bytes = new Uint8Array(zip64 ? 24 : 16);
  const view = zipView(bytes);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, entry.crc, true);
  if (zip64) {
    writeUint64(view, 8, entry.compressed);
    writeUint64(view, 16, entry.length);
  } else {
    view.setUint32(8, entry.compressed, true);
    view.setUint32(12, entry.length, true);
  }
  return bytes;
}
