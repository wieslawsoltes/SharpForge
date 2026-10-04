import { Crc32 } from './zip-crc.js';
import { zipLimits, zipError, verifyZipRanges } from './zip-budgets.js';
import { findZipEnd, needsZip64, readZip64Locator, readZip64End, zipView } from './zip64.js';
import { parseZipDirectory, parseZipLocal, zipDescriptorLength } from './zip-directory.js';
import { inflateRawChunks } from './deflate-stream.js';
import { sameZipBytes, checkNestedZip, rejectZipQuine } from './zip-content-policy.js';

async function slice(blob, start, length, signal) {
  signal?.throwIfAborted();
  if (start < 0 || length < 0 || start + length > blob.size) zipError('SFZIP008', 'ZIP slice is outside archive');
  const bytes = new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
  signal?.throwIfAborted();
  if (bytes.length !== length) zipError('SFZIP008', 'Truncated ZIP slice');
  return bytes;
}

async function* payload(blob, entry, limits) {
  for (let offset = 0; offset < entry.compressed; offset += limits.chunkSize) {
    yield await slice(blob, entry.data + offset, Math.min(limits.chunkSize, entry.compressed - offset), limits.signal);
  }
}

/** Open a Blob/File using bounded tail and central-directory reads; does not load payloads. */
export async function openZip(blob, options = {}) {
  const limits = zipLimits(options);
  if (!blob || typeof blob.slice !== 'function' || !Number.isSafeInteger(blob.size) || blob.size < 22 || blob.size > limits.maxArchiveBytes) {
    zipError('SFZIP004', 'Invalid or oversized ZIP Blob');
  }
  const tail = await slice(blob, Math.max(0, blob.size - 65557), Math.min(blob.size, 65557), limits.signal);
  let end = findZipEnd(tail, blob.size);
  const locator = end.offset >= 20 ? await slice(blob, end.offset - 20, 20, limits.signal) : null;
  if (needsZip64(end) || locator && zipView(locator).getUint32(0, true) === 0x07064b50) {
    const offset = readZip64Locator(locator ?? new Uint8Array(), end.offset);
    end = readZip64End(await slice(blob, offset, 56, limits.signal), offset, end.offset);
  }
  if (end.size > limits.maxCentralBytes || end.count > limits.maxEntries) zipError('SFZIP004', 'ZIP central-directory budget exceeded');
  const entries = parseZipDirectory(await slice(blob, end.start, end.size, limits.signal), end, limits);
  // Even before local-header reads, duplicate offsets and overlapping declared payloads are rejected.
  verifyZipRanges(entries.map(entry => [entry.local, entry.local + 30 + entry.rawName.length + entry.compressed]), end.start);
  return new ZipArchive(blob, entries, end.start, limits);
}

export class ZipArchive {
  constructor(blob, entries, centralStart, limits) {
    this.blob = blob;
    this.entries = Object.freeze(entries.map(entry => Object.freeze({ ...entry })));
    this.byPath = new Map(this.entries.map(entry => [entry.path, entry]));
    const ordered = [...this.entries].sort((left, right) => left.local - right.local);
    this.boundaries = new Map(ordered.map((entry, index) => [entry.path, ordered[index + 1]?.local ?? centralStart]));
    this.centralStart = centralStart;
    this.limits = limits;
    this.closed = false;
    this.streams = new Set();
  }
  close() {
    this.closed = true;
    for (const controller of this.streams) controller.abort(new DOMException('ZIP archive closed', 'AbortError'));
    this.streams.clear();
    this.blob = null;
  }
  async *chunks(path, options = {}) {
    if (this.closed) zipError('SFZIP013', 'ZIP archive is closed');
    const entry = typeof path === 'string' ? this.byPath.get(path) : this.byPath.get(path.path);
    if (!entry) zipError('SFZIP001', 'ZIP entry not found');
    const controller = new AbortController();
    this.streams.add(controller);
    const external = options.signal ?? this.limits.signal;
    const cancel = () => controller.abort(external.reason);
    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) cancel();
    const limits = { ...this.limits, signal: controller.signal };
    try {
      const base = await slice(this.blob, entry.local, 30, limits.signal);
      const view = zipView(base);
      const header = await slice(this.blob, entry.local, 30 + view.getUint16(26, true) + view.getUint16(28, true), limits.signal);
      const local = { ...entry, ...parseZipLocal(header, entry, this.centralStart) };
      const last = local.data + local.compressed;
      const descriptor = local.flags & 8 ? zipDescriptorLength(
        await slice(this.blob, last, Math.min(24, this.centralStart - last), limits.signal), local, local.descriptorZip64) : 0;
      if (last + descriptor > this.boundaries.get(entry.path)) zipError('SFZIP007', 'Overlapping ZIP entries');
      const source = payload(this.blob, local, limits);
      const chunks = local.method === 0 ? source : inflateRawChunks(source, { ...local, ...limits });
      const crc = new Crc32();
      let count = 0;
      let matchesArchive = local.length === this.blob.size;
      const signature = limits.nestedArchives === 'reject' ? new Uint8Array(4) : null;
      for await (const bytes of chunks) {
        limits.signal.throwIfAborted();
        if (signature && count < 4) {
          signature.set(bytes.subarray(0, 4 - count), count);
          if (count + bytes.length >= 4) checkNestedZip(signature, local.path, limits.nestedArchives);
        }
        if (matchesArchive) matchesArchive = sameZipBytes(bytes, await slice(this.blob, count, bytes.length, limits.signal));
        count += bytes.length;
        if (count > local.length || count > limits.maxFileBytes) zipError('SFZIP004', 'ZIP streaming byte budget exceeded');
        crc.update(bytes);
        yield bytes;
      }
      if (count !== local.length || crc.value !== local.crc) zipError('SFZIP011', 'ZIP data CRC/length mismatch: ' + local.path);
      rejectZipQuine(matchesArchive, local.path);
    } finally {
      external?.removeEventListener('abort', cancel);
      this.streams.delete(controller);
    }
  }
  stream(path, options = {}) {
    const iterator = this.chunks(path, options);
    return new ReadableStream({
      async pull(controller) {
        try { const next = await iterator.next(); if (next.done) controller.close(); else controller.enqueue(next.value); }
        catch (error) { controller.error(error); }
      },
      async cancel() { await iterator.return(); }
    }, { highWaterMark: 1 });
  }
  async read(path, options = {}) {
    if (this.closed) zipError('SFZIP013', 'ZIP archive is closed');
    const entry = this.byPath.get(typeof path === 'string' ? path : path.path);
    if (!entry) zipError('SFZIP001', 'ZIP entry not found');
    const bytes = new Uint8Array(entry.length);
    let offset = 0;
    for await (const chunk of this.chunks(entry, options)) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }
}
