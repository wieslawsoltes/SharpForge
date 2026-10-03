import { deflateRaw } from '@sharpforge/archive';
import { GitError, checkCancelled, checkLimit } from './errors.js';
import { asBytes } from './hash/bytes.js';
import { adler32 } from './zlib/adler32.js';
import { inflateRawBounded, truncated } from './zlib/inflate.js';
import { nativeCodec, transformBytes } from './zlib/native.js';

export { adler32 } from './zlib/adler32.js';
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

function optionsFor(options = {}) {
  const maximum = options.maxOutputBytes ?? MAX_INFLATED_BYTES;
  checkLimit(maximum, MAX_INFLATED_BYTES, 'Inflated output limit');
  const maxInputBytes = options.maxInputBytes ?? Math.ceil(MAX_INFLATED_BYTES * 9 / 8) + 1024;
  const maxBlocks = options.maxBlocks ?? 1_000_000;
  checkLimit(maxInputBytes, 128 * 1024 * 1024, 'Compressed input limit');
  checkLimit(maxBlocks, 1_000_000, 'DEFLATE block limit');
  return { ...options, maxOutputBytes: maximum, maxInputBytes, maxBlocks };
}

function readHeader(bytes) {
  if (bytes.length < 2) throw truncated('Truncated zlib header');
  const header = bytes[0] * 256 + bytes[1];
  if ((bytes[0] & 15) !== 8 || bytes[0] >>> 4 > 7 || header % 31) throw new GitError('Corrupt', 'Invalid zlib header');
  if (bytes[1] & 32) throw new GitError('Unsupported', 'Preset zlib dictionaries are not supported by Git');
  return 1 << ((bytes[0] >>> 4) + 8);
}

/** Strict zlib framing with exact consumption for concatenated Git pack streams. */
export function inflateZlibSync(input, options = {}) {
  const bytes = asBytes(input);
  const limits = optionsFor(options);
  checkCancelled(limits.signal);
  const windowBytes = readHeader(bytes);
  const result = inflateRawBounded(bytes.subarray(2), { ...limits, windowBytes });
  const trailer = result.bytesRead + 2;
  if (trailer + 4 > bytes.length) throw truncated('Truncated zlib checksum');
  const expected = new DataView(bytes.buffer, bytes.byteOffset + trailer, 4).getUint32(0);
  if (adler32(result.data) !== expected) throw new GitError('Corrupt', 'Zlib Adler-32 checksum mismatch');
  const bytesRead = trailer + 4;
  if (!options.allowTrailing && bytesRead !== bytes.length) throw new GitError('Corrupt', 'Trailing data after zlib stream');
  return { data: result.data, bytesRead };
}

/** Inflate one zlib stream with a hard 64 MiB cap, using platform streams when available. */
export async function inflateZlib(input, options = {}) {
  const bytes = asBytes(input);
  const limits = optionsFor(options);
  checkCancelled(limits.signal);
  checkLimit(bytes.length, limits.maxInputBytes, 'Compressed input size');
  readHeader(bytes);
  const codec = nativeCodec('inflate', options.backend ?? 'auto');
  if (!codec) return inflateZlibSync(bytes, limits).data;
  const output = await transformBytes(bytes, codec, limits);
  if (bytes.length < 6) throw truncated('Truncated zlib checksum');
  const expected = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 4, 4).getUint32(0);
  if (adler32(output) !== expected) throw new GitError('Corrupt', 'Zlib Adler-32 checksum mismatch');
  return output;
}

/** Compress with platform zlib or the archive package's real 32 KiB LZ77/fixed-Huffman encoder. */
export async function deflateZlib(input, options = {}) {
  const bytes = asBytes(input);
  checkCancelled(options.signal);
  checkLimit(bytes.length, Math.min(options.maxInputBytes ?? MAX_INFLATED_BYTES, MAX_INFLATED_BYTES), 'Deflate input size');
  const maxOutputBytes = options.maxOutputBytes ?? Math.ceil(bytes.length * 9 / 8) + 64;
  checkLimit(maxOutputBytes, 128 * 1024 * 1024, 'Deflate output limit');
  const codec = nativeCodec('deflate', options.backend ?? 'auto');
  if (codec) return transformBytes(bytes, codec, { ...options, maxOutputBytes });
  let compressed;
  try {
    compressed = deflateRaw(bytes, { signal: options.signal, maxChain: options.maxChain ?? 16 });
  } catch (error) {
    checkCancelled(options.signal);
    if (error instanceof RangeError) throw new GitError('Limit', error.message);
    throw error;
  }
  checkLimit(compressed.length + 6, maxOutputBytes, 'Deflate output size');
  const output = new Uint8Array(compressed.length + 6);
  output.set([0x78, 0x01]);
  output.set(compressed, 2);
  new DataView(output.buffer).setUint32(output.length - 4, adler32(bytes));
  return output;
}
