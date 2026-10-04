import { MatchWindow, deflateRaw } from './deflate-compress.js';
import { platformDeflate } from './deflate-platform.js';
import { lengthBase, lengthExtra, distanceBase, distanceExtra } from './deflate-codebook.js';

function reverse(value, width) {
  let result = 0;
  for (let bit = 0; bit < width; bit++) { result = result << 1 | value & 1; value >>>= 1; }
  return result;
}

function codebook(lengths) {
  const counts = new Uint16Array(16);
  const next = new Uint16Array(16);
  const codes = new Uint16Array(lengths.length);
  for (const width of lengths) if (width) counts[width]++;
  let code = 0;
  for (let width = 1; width <= 15; width++) { code = (code + counts[width - 1]) << 1; next[width] = code; }
  lengths.forEach((width, symbol) => { if (width) codes[symbol] = reverse(next[width]++, width); });
  return { lengths, codes };
}

function tree(frequencies) {
  const nodes = [];
  frequencies.forEach((weight, symbol) => { if (weight) nodes.push({ weight, symbol }); });
  if (nodes.length === 1) nodes.push({ weight: 1, symbol: nodes[0].symbol === 0 ? 1 : 0 });
  while (nodes.length > 1) {
    nodes.sort((left, right) => left.weight - right.weight || left.symbol - right.symbol);
    const left = nodes.shift();
    const right = nodes.shift();
    nodes.push({ weight: left.weight + right.weight, symbol: Math.min(left.symbol, right.symbol), left, right });
  }
  const lengths = new Uint8Array(frequencies.length);
  function visit(node, depth) {
    if (!node.left) { lengths[node.symbol] = depth; return; }
    visit(node.left, depth + 1);
    visit(node.right, depth + 1);
  }
  if (nodes.length) visit(nodes[0], 0);
  return lengths;
}

function codeFor(value, bases) {
  let code = 0;
  while (code + 1 < bases.length && bases[code + 1] <= value) code++;
  return code;
}

class Writer {
  constructor(capacity) { this.bytes = new Uint8Array(capacity); this.offset = 0; this.buffer = 0; this.bits = 0; }
  write(value, width) {
    this.buffer |= value << this.bits;
    this.bits += width;
    while (this.bits >= 8) { this.bytes[this.offset++] = this.buffer & 255; this.buffer >>>= 8; this.bits -= 8; }
  }
  symbol(symbol, book) { this.write(book.codes[symbol], book.lengths[symbol]); }
  finish() { if (this.bits) this.bytes[this.offset++] = this.buffer & 255; return this.bytes.slice(0, this.offset); }
}

function tokensFor(bytes, start, end, window) {
  const tokens = new Uint32Array(end - start);
  const literals = new Uint32Array(286);
  const distances = new Uint32Array(30);
  let count = 0;
  let offset = start;
  while (offset < end) {
    window.find(offset);
    const length = Math.min(window.length, end - offset);
    if (length >= 4 || length === 3 && window.distance <= 16384) {
      tokens[count++] = 256 + ((length - 3) << 15) + window.distance - 1;
      literals[257 + codeFor(length, lengthBase)]++;
      distances[codeFor(window.distance, distanceBase)]++;
      const last = offset + length;
      while (offset < last) window.insert(offset++);
    } else {
      tokens[count++] = bytes[offset];
      literals[bytes[offset]]++;
      window.insert(offset++);
    }
  }
  literals[256]++;
  if (!distances.some(value => value)) distances[0] = 1;
  return { tokens: tokens.subarray(0, count), literals, distances };
}

function emitDynamic(writer, block, final) {
  const literalLengths = tree(block.literals);
  const distanceLengths = tree(block.distances);
  if (literalLengths.some(width => width > 15) || distanceLengths.some(width => width > 15)) return false;
  let literalCount = literalLengths.length;
  let distanceCount = distanceLengths.length;
  while (literalCount > 257 && !literalLengths[literalCount - 1]) literalCount--;
  while (distanceCount > 1 && !distanceLengths[distanceCount - 1]) distanceCount--;
  const literalBook = codebook(literalLengths);
  const distanceBook = codebook(distanceLengths);
  // A complete, deterministic 19-symbol code-length tree; no run-length extensions are needed.
  const lengthBook = codebook(Uint8Array.from({ length: 19 }, (_, index) => index < 13 ? 4 : 5));
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  writer.write((final ? 1 : 0) | 4, 3);
  writer.write(literalCount - 257, 5);
  writer.write(distanceCount - 1, 5);
  writer.write(15, 4);
  for (const symbol of order) writer.write(lengthBook.lengths[symbol], 3);
  for (const width of literalLengths.subarray(0, literalCount)) writer.symbol(width, lengthBook);
  for (const width of distanceLengths.subarray(0, distanceCount)) writer.symbol(width, lengthBook);
  for (const token of block.tokens) {
    if (token < 256) { writer.symbol(token, literalBook); continue; }
    const match = token - 256;
    const length = (match >>> 15) + 3;
    const distance = (match & 32767) + 1;
    const lengthCode = codeFor(length, lengthBase);
    const distanceCode = codeFor(distance, distanceBase);
    writer.symbol(257 + lengthCode, literalBook);
    writer.write(length - lengthBase[lengthCode], lengthExtra[lengthCode]);
    writer.symbol(distanceCode, distanceBook);
    writer.write(distance - distanceBase[distanceCode], distanceExtra[distanceCode]);
  }
  writer.symbol(256, literalBook);
  return true;
}

/** RFC 1951 dynamic blocks with a shared 32 KiB dictionary and bounded block scratch memory. */
export function deflateDynamic(bytes, { maxBytes = 64 * 1024 * 1024, maxChain = 32, signal } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > maxBytes || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError('Invalid or oversized DEFLATE input');
  }
  if (!Number.isInteger(maxChain) || maxChain < 1 || maxChain > 64) throw new RangeError('Invalid DEFLATE search budget');
  signal?.throwIfAborted();
  if (bytes.length < 1024) return deflateRaw(bytes, { maxBytes, maxChain, signal });
  const writer = new Writer(bytes.length * 2 + Math.ceil(bytes.length / 32768) * 512);
  const window = new MatchWindow(bytes, maxChain);
  for (let start = 0; start < bytes.length; start += 32768) {
    signal?.throwIfAborted();
    const end = Math.min(start + 32768, bytes.length);
    if (!emitDynamic(writer, tokensFor(bytes, start, end, window), end === bytes.length)) {
      return deflateRaw(bytes, { maxBytes, maxChain, signal });
    }
  }
  return writer.finish();
}

/** Uses the platform raw DEFLATE stream only when explicitly available; reports the selected backend. */
export async function compressDeflate(bytes, options = {}) {
  options.signal?.throwIfAborted();
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxBytes) || maxBytes < 0 || bytes.length > maxBytes) {
    throw new RangeError('Invalid or oversized DEFLATE input');
  }
  if (!['portable', 'platform', 'auto'].includes(options.backend ?? 'portable')) throw new RangeError('Unknown DEFLATE backend');
  if (options.backend === 'platform' || options.backend === 'auto') {
    const compressed = await platformDeflate(bytes, options);
    if (compressed) return { bytes: compressed, backend: 'CompressionStream' };
    if (options.backend === 'platform') throw new RangeError('Raw CompressionStream is unavailable');
  }
  return { bytes: options.level === 'fast' ? deflateRaw(bytes, options) : deflateDynamic(bytes, options), backend: 'portable' };
}
