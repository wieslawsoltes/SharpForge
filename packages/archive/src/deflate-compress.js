import { lengthBase, lengthExtra, distanceBase, distanceExtra } from './deflate-codebook.js';

function reverse(value, width) {
  let reversed = 0;
  for (let bit = 0; bit < width; bit++) {
    reversed = (reversed << 1) | (value & 1);
    value >>>= 1;
  }
  return reversed;
}

class BitWriter {
  constructor(length) {
    // A literal is at most 9 bits; every selected match is cheaper than its literals.
    this.bytes = new Uint8Array(Math.ceil(length * 9 / 8) + 6);
    this.offset = 0;
    this.buffer = 0;
    this.bits = 0;
  }
  write(value, width) {
    this.buffer |= value << this.bits;
    this.bits += width;
    while (this.bits >= 8) {
      this.bytes[this.offset++] = this.buffer & 255;
      this.buffer >>>= 8;
      this.bits -= 8;
    }
  }
  literal(symbol) {
    let value;
    let width;
    if (symbol < 144) { value = symbol + 48; width = 8; }
    else if (symbol < 256) { value = symbol + 256; width = 9; }
    else if (symbol < 280) { value = symbol - 256; width = 7; }
    else { value = symbol - 88; width = 8; }
    this.write(reverse(value, width), width);
  }
  finish() {
    if (this.bits) this.bytes[this.offset++] = this.buffer & 255;
    return this.bytes.slice(0, this.offset);
  }
}

function codeFor(value, bases) {
  let code = 0;
  while (code + 1 < bases.length && bases[code + 1] <= value) code++;
  return code;
}

function writeMatch(writer, length, distance) {
  const lengthCode = codeFor(length, lengthBase);
  const distanceCode = codeFor(distance, distanceBase);
  writer.literal(257 + lengthCode);
  writer.write(length - lengthBase[lengthCode], lengthExtra[lengthCode]);
  writer.write(reverse(distanceCode, 5), 5);
  writer.write(distance - distanceBase[distanceCode], distanceExtra[distanceCode]);
}

function hash(bytes, offset) {
  return ((bytes[offset] * 251 + bytes[offset + 1]) * 251 + bytes[offset + 2]) & 65535;
}

export class MatchWindow {
  constructor(bytes, maxChain) {
    this.bytes = bytes;
    this.maxChain = maxChain;
    this.heads = new Int32Array(65536).fill(-1);
    this.previous = new Int32Array(32768).fill(-1);
    this.length = 0;
    this.distance = 0;
  }
  insert(offset) {
    if (offset + 2 >= this.bytes.length) return;
    const key = hash(this.bytes, offset);
    this.previous[offset & 32767] = this.heads[key];
    this.heads[key] = offset;
  }
  find(offset) {
    this.length = 0;
    this.distance = 0;
    if (offset + 2 >= this.bytes.length) return;
    const bytes = this.bytes;
    let candidate = this.heads[hash(bytes, offset)];
    const maximumLength = Math.min(258, bytes.length - offset);
    const minimumCandidate = Math.max(0, offset - 32768);
    for (let chain = 0; chain < this.maxChain && candidate >= minimumCandidate; chain++) {
      let length = 0;
      while (length < maximumLength && bytes[candidate + length] === bytes[offset + length]) length++;
      if (length > this.length) {
        this.length = length;
        this.distance = offset - candidate;
        if (length === maximumLength) break;
      }
      const previous = this.previous[candidate & 32767];
      if (previous >= candidate) break;
      candidate = previous;
    }
  }
}

/**
 * Encode raw RFC 1951 DEFLATE with fixed Huffman codes and a 32 KiB LZ77 window.
 * Work is O(input length * maxChain * 258), with maxChain in [1,64] (default 16).
 * Scratch memory is 384 KiB plus at most ceil(9 * inputBytes / 8) + 6 output bytes.
 * Input is never mutated. Invalid options and oversized input throw RangeError.
 */
function compressBlock(bytes, { maxBytes = 64 * 1024 * 1024, maxChain = 16, signal, final = true } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('DEFLATE input must be Uint8Array');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 64 * 1024 * 1024 || bytes.length > maxBytes) {
    throw new RangeError('Invalid or oversized DEFLATE input');
  }
  if (!Number.isInteger(maxChain) || maxChain < 1 || maxChain > 64) throw new RangeError('Invalid DEFLATE search budget');
  signal?.throwIfAborted();
  const writer = new BitWriter(bytes.length);
  const window = new MatchWindow(bytes, maxChain);
  writer.write(final ? 3 : 2, 3); // Fixed Huffman block; streaming callers control the final bit.
  let offset = 0;
  let nextCancellationCheck = 0;
  while (offset < bytes.length) {
    if (offset >= nextCancellationCheck) {
      signal?.throwIfAborted();
      nextCancellationCheck = offset + 4096;
    }
    window.find(offset);
    // Three-byte matches at very long distances can cost more than literal bytes.
    const length = window.length;
    const profitable = length >= 4 || length === 3 && window.distance <= 16384;
    if (profitable) {
      writeMatch(writer, length, window.distance);
      const end = offset + length;
      while (offset < end) window.insert(offset++);
    } else {
      writer.literal(bytes[offset]);
      window.insert(offset++);
    }
  }
  writer.literal(256);
  const bitLength = writer.offset * 8 + writer.bits;
  return { bytes: writer.finish(), bitLength };
}

/** Fixed Huffman RFC 1951 stream, retaining the original public byte-array contract. */
export function deflateRaw(bytes, options = {}) {
  return compressBlock(bytes, options).bytes;
}

/** A bounded fixed block plus exact bit length for concatenating streaming blocks without padding. */
export function deflateFixedBlock(bytes, options = {}) {
  return compressBlock(bytes, options);
}
