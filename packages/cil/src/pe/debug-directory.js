import { Reader, CilError } from '../binary.js';

function limit(value, fallback, maximum, name) {
  value ??= fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new CilError(`Invalid PE debug ${name} limit`);
  return value;
}

function cancelled(signal) {
  if (signal?.aborted) throw new CilError('PE debug directory inspection cancelled');
}

/** Read raw IMAGE_DEBUG_DIRECTORY records from a parsed PE. Payloads are owned copies; no symbols are decoded.
 * File offsets select payloads, including overlays. AddressOfRawData is retained independently.
 * Limits bound record count and aggregate copied payload bytes; cancellation and malformed ranges throw CilError. */
export function readPEDebugDirectory(pe, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new CilError('Invalid PE debug options');
  const maxEntries = limit(options.maxEntries, 1024, 65536, 'entry');
  const maxDataBytes = limit(options.maxDataBytes, 64 * 1024 * 1024, 256 * 1024 * 1024, 'data byte');
  const signal = options.signal;
  cancelled(signal);
  if (!(pe?.bytes instanceof Uint8Array) || typeof pe.offsetOf !== 'function' || !pe.directories?.debug) {
    throw new CilError('Expected a parsed PE image');
  }
  const { rva, size } = pe.directories.debug;
  if (!Number.isInteger(size) || size < 0 || size % 28 || size / 28 > maxEntries) {
    throw new CilError('Invalid debug directory size or entry limit exceeded');
  }
  if (!size) return [];
  const reader = new Reader(pe.bytes, pe.offsetOf(rva, size), size);
  const entries = [];
  let totalBytes = 0;
  while (reader.position < reader.end) {
    cancelled(signal);
    const characteristics = reader.u32();
    const stamp = reader.u32();
    const major = reader.u16();
    const minor = reader.u16();
    const kind = reader.u32();
    const length = reader.u32();
    const dataRva = reader.u32();
    const offset = reader.u32();
    if (offset > pe.bytes.length || length > pe.bytes.length - offset) throw new CilError('Truncated debug entry');
    totalBytes += length;
    if (totalBytes > maxDataBytes) throw new CilError('PE debug payload byte limit exceeded');
    entries.push({ kind, stamp, major, minor, bytes: new Uint8Array(pe.bytes.subarray(offset, offset + length)),
      offset, characteristics, dataRva });
  }
  cancelled(signal);
  return entries;
}
