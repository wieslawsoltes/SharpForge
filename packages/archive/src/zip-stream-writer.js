import { Crc32 } from './zip-crc.js';
import { deflateFixedBlock } from './deflate-compress.js';
import { ZipBudget, zipLimits, zipError, verifyZipNames, checkedAdd } from './zip-budgets.js';
import { zipEntry, compressionMethod } from './zip-writer.js';
import { localHeader, centralHeader, dataDescriptor } from './zip-headers.js';
import { writeZipEnd } from './zip64.js';

const encoder = new TextEncoder();

async function* sourceChunks(file, limits) {
  if (file.directory) return;
  const bytes = file.bytes ?? (typeof file.text === 'string' ? encoder.encode(file.text) : null);
  if (bytes) {
    if (!(bytes instanceof Uint8Array)) zipError('SFZIP001', 'ZIP input must contain byte arrays');
    for (let offset = 0; offset < bytes.length; offset += limits.chunkSize) yield bytes.subarray(offset, offset + limits.chunkSize);
    return;
  }
  const stream = typeof file.stream === 'function' ? file.stream() : file.stream ?? file.source;
  if (!stream) zipError('SFZIP001', 'Missing ZIP stream: ' + file.path);
  const reader = stream.getReader?.();
  if (reader) {
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        if (!(next.value instanceof Uint8Array)) zipError('SFZIP001', 'ZIP stream must yield bytes');
        for (let offset = 0; offset < next.value.length; offset += limits.chunkSize) yield next.value.subarray(offset, offset + limits.chunkSize);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  } else {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) zipError('SFZIP001', 'ZIP stream must yield bytes');
      for (let offset = 0; offset < chunk.length; offset += limits.chunkSize) yield chunk.subarray(offset, offset + limits.chunkSize);
    }
  }
}

class BitJoiner {
  constructor() { this.buffer = 0; this.bits = 0; }
  append({ bytes, bitLength }, final = false) {
    const output = new Uint8Array(bytes.length + 1);
    let offset = 0;
    for (let index = 0; index < bytes.length; index++) {
      const width = Math.min(8, bitLength - index * 8);
      this.buffer |= (bytes[index] & ((1 << width) - 1)) << this.bits;
      this.bits += width;
      while (this.bits >= 8) { output[offset++] = this.buffer & 255; this.buffer >>>= 8; this.bits -= 8; }
    }
    if (final && this.bits) { output[offset++] = this.buffer & 255; this.buffer = 0; this.bits = 0; }
    return output.subarray(0, offset);
  }
}

/** Streaming fixed-Huffman compression retains at most one input block and one output block. */
async function* compressedChunks(chunks, limits) {
  const joiner = new BitJoiner();
  for await (const bytes of chunks) {
    limits.signal?.throwIfAborted();
    const block = deflateFixedBlock(bytes, { final: false, maxChain: limits.level === 'fast' ? 4 : 16, signal: limits.signal });
    yield joiner.append(block);
  }
  yield joiner.append(deflateFixedBlock(new Uint8Array(), { final: true }), true);
}

/**
 * Stream ZIP entries with backpressure, CRC descriptors and automatic ZIP64.
 * Input arrays are sorted; async iterables preserve producer order. Sink closes only on complete success.
 */
export async function writeZipTo(files, sink, options = {}) {
  const limits = zipLimits(options);
  const budget = new ZipBudget(limits);
  const method = compressionMethod(options);
  const writer = sink.getWriter ? sink.getWriter() : sink;
  if (!writer || typeof writer.write !== 'function') zipError('SFZIP001', 'A writable ZIP destination is required');
  const entries = [];
  const input = Array.isArray(files) ? [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) : files;
  if (Array.isArray(input)) verifyZipNames(input.map(file => zipEntry(file, limits)), limits);
  let offset = 0;
  let totalInput = 0;
  async function write(bytes) {
    limits.signal?.throwIfAborted();
    offset = checkedAdd(offset, bytes.length, 'ZIP stream offset');
    if (offset > limits.maxArchiveBytes) zipError('SFZIP004', 'ZIP streaming archive budget exceeded');
    await writer.write(bytes);
    limits.signal?.throwIfAborted();
  }
  try {
    for await (const file of input) {
      limits.signal?.throwIfAborted();
      if (entries.length === limits.maxEntries) zipError('SFZIP003', 'Archive entry limit exceeded');
      const entry = { ...zipEntry(file, limits), local: offset, length: 0, compressed: 0, crc: 0, method: file.directory ? 0 : method };
      const zip64 = options.forceZip64 !== false;
      entries.push(entry);
      await write(localHeader(entry, { descriptor: true, forceZip64: zip64 }));
      const crc = new Crc32();
      async function* tracked() {
        for await (const bytes of sourceChunks(file, limits)) {
          entry.length += bytes.length;
          totalInput += bytes.length;
          if (entry.length > limits.maxFileBytes || totalInput > limits.maxTotalBytes) zipError('SFZIP004', 'ZIP streaming byte budget exceeded');
          if (!zip64 && entry.length >= 0xffffffff) zipError('SFZIP004', 'ZIP64 must be enabled before streaming large entries');
          crc.update(bytes);
          yield bytes;
        }
      }
      const chunks = entry.method === 8 ? compressedChunks(tracked(), limits) : tracked();
      for await (const bytes of chunks) {
        entry.compressed += bytes.length;
        if (!zip64 && entry.compressed >= 0xffffffff) zipError('SFZIP004', 'ZIP64 must be enabled before streaming large compressed entries');
        await write(bytes);
      }
      entry.crc = crc.value;
      budget.entry(entry.length, entry.compressed, entry.directory);
      await write(dataDescriptor(entry, zip64));
      await options.onProgress?.({ files: entries.length, inputBytes: totalInput, outputBytes: offset });
    }
    budget.finish();
    verifyZipNames(entries, limits);
    const start = offset;
    for (const entry of entries) {
      await write(centralHeader(entry, { descriptor: true, forceZip64: options.forceZip64 !== false }));
      if (offset - start > limits.maxCentralBytes) zipError('SFZIP004', 'ZIP central-directory budget exceeded');
    }
    const size = offset - start;
    await write(writeZipEnd({ count: entries.length, size, start, forceZip64: options.forceZip64 !== false }));
    await writer.close?.();
    return { entries: entries.length, inputBytes: totalInput, outputBytes: offset, compressionBackend: method === 8 ? 'portable-fixed' : 'stored' };
  } catch (error) {
    try { await writer.abort?.(error); } catch (abortError) { error.abortError = abortError; }
    throw error;
  } finally {
    writer.releaseLock?.();
  }
}
