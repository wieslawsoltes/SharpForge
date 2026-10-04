import { peChecksum } from './checksum.js';
import { equalBytes } from '../binary.js';
import { readPortableExecutable } from './reader.js';

/** Accept only append-only symbol payloads while comparing all executable bytes to canonical emission. */
export function canonicalWithSymbols(canonical, pe) {
  if (equalBytes(canonical, pe.bytes)) return true;
  if (pe.bytes.length <= canonical.length) return false;
  const original = readPortableExecutable(canonical);
  if (original.checksum && pe.checksum !== peChecksum(pe.bytes)) return false;
  if (pe.sections.length !== original.sections.length) return false;
  const section = pe.sections.at(-1);
  const view = new DataView(pe.bytes.buffer, pe.bytes.byteOffset, pe.bytes.byteLength);
  const directory = pe.optionalStart + (pe.magic === 0x10b ? 96 : 112) + 6 * 8;
  const rva = view.getUint32(directory, true), length = view.getUint32(directory + 4, true);
  if (!length || length % 28 || length > 28 * 1024 || rva !== section.rva + canonical.length - section.offset) return false;
  const offset = pe.offsetOf(rva, length);
  if (offset !== canonical.length) return false;
  const ranges = [];
  for (let at = offset; at < offset + length; at += 28) {
    const kind = view.getUint32(at + 12, true), size = view.getUint32(at + 16, true);
    const dataRva = view.getUint32(at + 20, true), start = view.getUint32(at + 24, true);
    if (![2, 16, 17, 19].includes(kind)) return false;
    if (!size) { if (kind !== 16) return false; continue; }
    if (start < offset + length || start + size > pe.bytes.length || dataRva !== section.rva + start - section.offset) return false;
    if (ranges.some(([begin, end]) => begin < start + size && start < end)) return false;
    ranges.push([start, start + size]);
  }
  const clone = new Uint8Array(pe.bytes.subarray(0, canonical.length));
  for (const [at, size] of [[pe.optionalStart + 4, 8], [pe.optionalStart + 56, 4], [pe.optionalStart + 64, 4], [directory, 8],
    [section.headerOffset + 8, 4], [section.headerOffset + 16, 4]]) {
    clone.set(canonical.subarray(at, at + size), at);
  }
  return equalBytes(clone, canonical);
}
