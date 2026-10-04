import { Reader, Writer, readPE, text } from '@sharpforge/cil';
import { fail } from './contracts.js';
import { inflateRaw } from './deflate.js';
import { rejectUnsupportedSymbolFormat } from './symbol-format.js';
import { checksumSizes } from './pdb-checksum.js';

function decodeCodeView(entry) {
  const bytes = entry.bytes;
  rejectUnsupportedSymbolFormat(bytes);
  if (bytes.length < 25 || text(bytes.subarray(0, 4)) !== 'RSDS') fail('Invalid CodeView record');
  entry.guid = new Uint8Array(bytes.subarray(4, 20));
  entry.age = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(20, true);
  const zero = bytes.indexOf(0, 24);
  if (zero < 0) fail('Unterminated PDB path');
  entry.path = text(bytes.subarray(24, zero));
  entry.id = new Writer().bytes(entry.guid).u32(entry.stamp).finish();
}

function decodeEmbedded(entry, maxBytes) {
  const reader = new Reader(entry.bytes);
  if (reader.u32() !== 0x4244504d) fail('Invalid embedded Portable PDB signature');
  const size = reader.u32();
  if (!size || size > maxBytes) fail('Invalid or oversized embedded Portable PDB');
  const compressed = reader.take(reader.end - reader.position);
  let inflated;
  Object.defineProperty(entry, 'pdb', {
    enumerable: true,
    get() {
      if (!inflated) inflated = inflateRaw(compressed, size, maxBytes);
      return inflated;
    },
  });
}

function decodeChecksum(entry) {
  const zero = entry.bytes.indexOf(0);
  if (zero < 1) fail('Invalid PDB checksum');
  entry.algorithm = text(entry.bytes.subarray(0, zero));
  entry.checksum = new Uint8Array(entry.bytes.subarray(zero + 1));
  const size = checksumSizes[entry.algorithm];
  if (size !== undefined && entry.checksum.length !== size) fail('Invalid PDB checksum length');
}

const decoders = new Map([
  [2, decodeCodeView],
  [17, decodeEmbedded],
  [19, decodeChecksum],
]);

/** Inspect PE debug records; embedded data inflates at most once, only when .pdb is read. */
export function readDebugDirectory(assembly, { maxBytes = 64 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('Invalid Portable PDB byte budget');
  const pe = readPE(assembly, { inspection: true });
  const view = new DataView(pe.bytes.buffer, pe.bytes.byteOffset, pe.bytes.byteLength);
  const directory = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112) + 6 * 8;
  const rva = view.getUint32(directory, true);
  const size = view.getUint32(directory + 4, true);
  if (!size) return [];
  if (size % 28 || size > 28 * 1024) fail('Invalid debug directory size');
  const reader = new Reader(pe.bytes, pe.offsetOf(rva, size), size);
  const entries = [];
  while (reader.position < reader.end) {
    const characteristics = reader.u32();
    const stamp = reader.u32();
    const major = reader.u16();
    const minor = reader.u16();
    const kind = reader.u32();
    const length = reader.u32();
    const dataRva = reader.u32();
    const offset = reader.u32();
    if (offset + length > pe.bytes.length) fail('Truncated debug entry');
    const entry = {
      kind,
      stamp,
      major,
      minor,
      bytes: pe.bytes.subarray(offset, offset + length),
      offset,
      characteristics,
      dataRva,
    };
    decoders.get(kind)?.(entry, maxBytes);
    entries.push(entry);
  }
  return entries;
}
