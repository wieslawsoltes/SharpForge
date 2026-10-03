import { Reader, CilError } from '../binary.js';

/** Locate a PE optional-header checksum without requiring managed metadata. */
export function peChecksumOffset(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 128 * 1024 * 1024) throw new CilError('Invalid PE checksum input');
  const reader = new Reader(bytes);
  if (reader.u16() !== 0x5a4d) throw new CilError('Missing PE checksum input MZ header');
  reader.position = 0x3c;
  reader.position = reader.u32();
  if (reader.u32() !== 0x4550) throw new CilError('Invalid PE checksum input signature');
  reader.take(16);
  const optionalSize = reader.u16();
  reader.u16();
  if (optionalSize < 68) throw new CilError('PE checksum optional header is too short');
  const start = reader.position;
  const magic = reader.u16();
  if (magic !== 0x10b && magic !== 0x20b) throw new CilError('Invalid PE checksum optional header');
  reader.position = start;
  reader.need(optionalSize);
  return start + 64;
}

/** Compute the PE one's-complement checksum, ignoring its current four-byte field. */
export function peChecksum(bytes) {
  const checksumOffset = peChecksumOffset(bytes);
  const checksumEnd = checksumOffset + 4;
  let sum = 0;
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const low = offset >= checksumOffset && offset < checksumEnd ? 0 : bytes[offset];
    const highOffset = offset + 1;
    const high = highOffset >= checksumOffset && highOffset < checksumEnd ? 0 : bytes[highOffset] ?? 0;
    sum += low | (high << 8);
    sum = (sum & 65535) + (sum >>> 16);
  }
  return ((sum & 65535) + (sum >>> 16) + bytes.length) >>> 0;
}
