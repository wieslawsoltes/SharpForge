import { portablePath } from './path-policy.js';
import { deflateRaw } from './deflate.js';
import { deflateDynamic } from './deflate-dynamic.js';
import { crc32 } from './zip-crc.js';
import { ZipBudget, zipLimits, zipError, verifyZipNames, checkedAdd } from './zip-budgets.js';
import { writeZipMetadata } from './zip-metadata.js';
import { localHeader, centralHeader, concatBytes } from './zip-headers.js';
import { writeZipEnd } from './zip64.js';

const encoder = new TextEncoder();

export function zipEntry(file, options) {
  const directory = !!file.directory;
  let path;
  try { path = portablePath(file.path, { ...options, directory }); }
  catch (error) { zipError('SFZIP006', error.message); }
  const name = encoder.encode(path + (directory ? '/' : ''));
  if (name.length > 65535) zipError('SFZIP006', 'ZIP path exceeds encoding limit');
  return { path, directory, name, ...writeZipMetadata({ ...file, directory }, options) };
}

export function compressionMethod(options) {
  const requested = options.method ?? options.compression ?? 'store';
  if ([0, 'store', 'stored'].includes(requested)) return 0;
  if ([8, 'deflate', 'auto'].includes(requested)) return 8;
  zipError('SFZIP009', 'Unsupported ZIP compression option');
}

/** Deterministic ZIP/ZIP64 writer. Compression is opt-in; metadata preservation is opt-in. */
export function writeZip(files, options = {}) {
  const limits = zipLimits(options);
  if (!Array.isArray(files)) zipError('SFZIP001', 'ZIP entries must be an array');
  const method = compressionMethod(options);
  const budget = new ZipBudget(limits);
  const entries = files.map(file => {
    limits.signal?.throwIfAborted();
    const entry = zipEntry(file, limits);
    const bytes = entry.directory ? new Uint8Array() : file.bytes instanceof Uint8Array ? file.bytes :
      typeof file.text === 'string' ? encoder.encode(file.text) : null;
    if (!bytes) zipError('SFZIP001', 'Missing ZIP bytes: ' + entry.path);
    if (bytes.length > limits.maxFileBytes) zipError('SFZIP004', 'Archive file size limit exceeded');
    let data = bytes;
    if (method === 8 && bytes.length) {
      const compress = options.level === 'fast' ? deflateRaw : deflateDynamic;
      const compressed = compress(bytes, { signal: limits.signal, maxChain: options.level === 'fast' ? 4 : 32 });
      if (compressed.length < data.length) data = compressed;
    }
    budget.entry(bytes.length, data.length, entry.directory);
    return { ...entry, data, length: bytes.length, compressed: data.length, crc: crc32(bytes), method: data === bytes ? 0 : 8 };
  }).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  budget.finish();
  verifyZipNames(entries, limits);
  const parts = [];
  let offset = 0;
  for (const entry of entries) {
    entry.local = offset;
    const header = localHeader(entry, options);
    offset = checkedAdd(offset, header.length + entry.data.length, 'ZIP output');
    if (offset > limits.maxArchiveBytes) zipError('SFZIP004', 'ZIP output limit exceeded');
    parts.push(header, entry.data);
  }
  const start = offset;
  const directory = entries.map(entry => centralHeader(entry, options));
  const size = directory.reduce((length, bytes) => length + bytes.length, 0);
  const end = writeZipEnd({ count: entries.length, size, start, forceZip64: options.forceZip64 });
  if (size > limits.maxCentralBytes || start + size + end.length > limits.maxArchiveBytes) zipError('SFZIP004', 'ZIP output limit exceeded');
  return concatBytes([...parts, ...directory, end]);
}
