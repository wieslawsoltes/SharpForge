import { GitError, checkCancelled, checkLimit } from '../errors.js';
import { decodeSymbol, dynamicTables, fixedTables } from './huffman.js';

const lengthBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const lengthExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const distanceBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const distanceExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

export function truncated(message) {
  return new GitError('Corrupt', message, { truncated: true });
}

class BitReader {
  constructor(bytes, maximum) {
    this.bytes = bytes;
    this.offset = 0;
    this.buffer = 0;
    this.bits = 0;
    this.maximum = maximum;
  }

  read(count) {
    while (this.bits < count) {
      if (this.offset >= this.maximum) throw new GitError('Limit', 'Compressed object exceeds input limit');
      if (this.offset >= this.bytes.length) throw truncated('Truncated DEFLATE stream');
      this.buffer |= this.bytes[this.offset++] << this.bits;
      this.bits += 8;
    }
    const value = this.buffer & ((1 << count) - 1);
    this.buffer >>>= count;
    this.bits -= count;
    return value;
  }

  align() {
    this.buffer = 0;
    this.bits = 0;
  }
}

class OutputBuffer {
  constructor(maximum) {
    this.bytes = new Uint8Array(Math.min(4096, maximum));
    this.length = 0;
    this.maximum = maximum;
  }

  ensure(additional) {
    const required = checkLimit(this.length + additional, this.maximum, 'Inflated object size');
    if (required <= this.bytes.length) return;
    const grown = new Uint8Array(Math.min(this.maximum, Math.max(required, this.bytes.length * 2, 4096)));
    grown.set(this.bytes);
    this.bytes = grown;
  }
}

function storedBlock(reader, output) {
  reader.align();
  const length = reader.read(16);
  const inverse = reader.read(16);
  if ((length ^ inverse) !== 65535) throw new GitError('Corrupt', 'Invalid DEFLATE stored-block length');
  const end = reader.offset + length;
  if (end > reader.bytes.length) throw truncated('Truncated DEFLATE stored block');
  if (end > reader.maximum) throw new GitError('Limit', 'Compressed object exceeds input limit');
  output.ensure(length);
  output.bytes.set(reader.bytes.subarray(reader.offset, end), output.length);
  output.length += length;
  reader.offset = end;
}

function compressedBlock(reader, output, tables, options) {
  let symbols = 0;
  for (;;) {
    if (!(symbols++ & 4095)) checkCancelled(options.signal);
    const symbol = decodeSymbol(reader, tables.literals);
    if (symbol === 256) return;
    if (symbol < 256) {
      output.ensure(1);
      output.bytes[output.length++] = symbol;
      continue;
    }
    if (symbol > 285) throw new GitError('Corrupt', 'Reserved DEFLATE length symbol');
    const length = lengthBase[symbol - 257] + reader.read(lengthExtra[symbol - 257]);
    const distanceSymbol = decodeSymbol(reader, tables.distances);
    if (distanceSymbol > 29) throw new GitError('Corrupt', 'Reserved DEFLATE distance symbol');
    const distance = distanceBase[distanceSymbol] + reader.read(distanceExtra[distanceSymbol]);
    if (distance > output.length || distance > options.windowBytes) throw new GitError('Corrupt', 'Invalid DEFLATE back-reference');
    output.ensure(length);
    for (let index = 0; index < length; index++) {
      output.bytes[output.length] = output.bytes[output.length - distance];
      output.length++;
    }
  }
}

/** Unknown-size RFC 1951 decoding for Git pack entries; bytesRead stops at the final compressed byte. */
export function inflateRawBounded(bytes, options) {
  const reader = new BitReader(bytes, options.maxInputBytes);
  const output = new OutputBuffer(options.maxOutputBytes);
  let fixed;
  let blocks = 0;
  let final = false;
  while (!final) {
    checkCancelled(options.signal);
    checkLimit(++blocks, options.maxBlocks, 'DEFLATE block count');
    final = reader.read(1) !== 0;
    const kind = reader.read(2);
    if (kind === 0) {
      storedBlock(reader, output);
      continue;
    }
    if (kind === 3) throw new GitError('Corrupt', 'Reserved DEFLATE block type');
    if (kind === 1) fixed ??= fixedTables();
    const tables = kind === 1 ? fixed : dynamicTables(reader);
    compressedBlock(reader, output, tables, options);
  }
  return { data: output.bytes.slice(0, output.length), bytesRead: reader.offset };
}
