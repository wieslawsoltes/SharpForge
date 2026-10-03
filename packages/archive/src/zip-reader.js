import { inflateRaw } from './deflate.js';
import { crc32 } from './zip-crc.js';
import { zipLimits, zipError, verifyZipRanges } from './zip-budgets.js';
import { findZipEnd, needsZip64, readZip64Locator, readZip64End, zipView } from './zip64.js';
import { parseZipDirectory, parseZipLocal, zipDescriptorLength } from './zip-directory.js';
import { sameZipBytes, checkNestedZip, rejectZipQuine } from './zip-content-policy.js';

function directoryEnd(bytes) {
  let end = findZipEnd(bytes);
  const hasLocator = end.offset >= 20 && zipView(bytes).getUint32(end.offset - 20, true) === 0x07064b50;
  if (needsZip64(end) || hasLocator) {
    const offset = readZip64Locator(bytes.subarray(end.offset - 20, end.offset), end.offset);
    end = readZip64End(bytes.subarray(offset, offset + 56), offset, end.offset);
  }
  return end;
}

/** Validates all headers, overlap ranges and CRCs before returning any file. */
export function readZip(input, options = {}) {
  const limits = zipLimits(options);
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.length < 22 || bytes.length > limits.maxArchiveBytes) zipError('SFZIP004', 'Invalid or oversized ZIP archive');
  limits.signal?.throwIfAborted();
  const end = directoryEnd(bytes);
  const entries = parseZipDirectory(bytes.subarray(end.start, end.start + end.size), end, limits);
  const ranges = [];
  for (const entry of entries) {
    Object.assign(entry, parseZipLocal(bytes.subarray(entry.local, Math.min(end.start, entry.local + 131100)), entry, end.start));
    let last = entry.data + entry.compressed;
    if (entry.flags & 8) last += zipDescriptorLength(bytes.subarray(last, Math.min(last + 24, end.start)), entry, entry.descriptorZip64);
    ranges.push([entry.local, last]);
  }
  verifyZipRanges(ranges, end.start);
  return entries.map(entry => {
    limits.signal?.throwIfAborted();
    const data = bytes.subarray(entry.data, entry.data + entry.compressed);
    const output = entry.method === 0 ? data.slice() : inflateRaw(data, entry.length, limits.maxFileBytes);
    if (output.length !== entry.length || crc32(output) !== entry.crc) zipError('SFZIP011', 'ZIP data CRC/length mismatch: ' + entry.path);
    rejectZipQuine(output.length === bytes.length && sameZipBytes(output, bytes), entry.path);
    checkNestedZip(output, entry.path, limits.nestedArchives);
    const result = { path: entry.path, directory: entry.directory, bytes: output };
    if (options.preserveMetadata) Object.assign(result, { mtime: entry.mtime, mode: entry.mode });
    return result;
  });
}
