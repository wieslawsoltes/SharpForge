import { Reader, Writer, CilError, readPE, readPEDebugDirectory, text } from '@sharpforge/cil';
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
  let entries;
  try {
    entries = readPEDebugDirectory(pe);
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    fail(error.message);
  }
  for (const entry of entries) decoders.get(entry.kind)?.(entry, maxBytes);
  return entries;
}
