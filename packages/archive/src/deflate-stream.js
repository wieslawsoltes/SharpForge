import { lengthBase, lengthExtra, distanceBase, distanceExtra } from './deflate-codebook.js';
import { zipError } from './zip-budgets.js';

class BitInput {
  constructor() { this.chunk = new Uint8Array(); this.offset = 0; this.buffer = 0; this.bits = 0; this.consumed = 0; }
  *read(width) {
    while (this.bits < width) {
      while (this.offset === this.chunk.length) { this.chunk = yield null; this.offset = 0; }
      this.buffer |= this.chunk[this.offset++] << this.bits;
      this.consumed++;
      this.bits += 8;
    }
    const value = this.buffer & ((1 << width) - 1);
    this.buffer >>>= width;
    this.bits -= width;
    return value;
  }
  align() { this.buffer = 0; this.bits = 0; }
}

function huffman(lengths) {
  const counts = new Uint16Array(16);
  const next = new Uint16Array(16);
  for (const width of lengths) {
    if (width > 15) zipError('SFZIP012', 'Invalid Huffman length');
    if (width) counts[width]++;
  }
  let code = 0;
  let remaining = 1;
  for (let width = 1; width <= 15; width++) {
    remaining = remaining * 2 - counts[width];
    if (remaining < 0) zipError('SFZIP012', 'Oversubscribed Huffman tree');
    code = (code + counts[width - 1]) << 1;
    next[width] = code;
  }
  const map = new Map();
  lengths.forEach((width, symbol) => {
    if (!width) return;
    let code = next[width]++;
    let reversed = 0;
    for (let bit = 0; bit < width; bit++) { reversed = reversed << 1 | code & 1; code >>>= 1; }
    map.set((1 << width) | reversed, symbol);
  });
  return map;
}

function* symbol(input, table) {
  let code = 0;
  for (let width = 1; width <= 15; width++) {
    code |= (yield* input.read(1)) << (width - 1);
    const result = table.get((1 << width) | code);
    if (result !== undefined) return result;
  }
  zipError('SFZIP012', 'Invalid Huffman code');
}

function* dynamicTrees(input) {
  const literalCount = (yield* input.read(5)) + 257;
  const distanceCount = (yield* input.read(5)) + 1;
  const codeCount = (yield* input.read(4)) + 4;
  if (literalCount > 286 || distanceCount > 32) zipError('SFZIP012', 'Invalid DEFLATE alphabet size');
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codes = new Uint8Array(19);
  for (let index = 0; index < codeCount; index++) codes[order[index]] = yield* input.read(3);
  const codeTree = huffman(codes);
  const lengths = [];
  while (lengths.length < literalCount + distanceCount) {
    const value = yield* symbol(input, codeTree);
    if (value < 16) { lengths.push(value); continue; }
    if (value === 16 && !lengths.length) zipError('SFZIP012', 'Invalid DEFLATE repeat');
    const count = value === 16 ? (yield* input.read(2)) + 3 : value === 17 ? (yield* input.read(3)) + 3 : (yield* input.read(7)) + 11;
    if (lengths.length + count > literalCount + distanceCount) zipError('SFZIP012', 'Huffman repeat overflow');
    const repeated = value === 16 ? lengths.at(-1) : 0;
    for (let index = 0; index < count; index++) lengths.push(repeated);
  }
  return [lengths.slice(0, literalCount), lengths.slice(literalCount)];
}

class OutputWindow {
  constructor(expected, chunkSize) {
    this.expected = expected;
    this.ring = new Uint8Array(32768);
    this.page = new Uint8Array(chunkSize);
    this.offset = 0;
    this.total = 0;
  }
  put(byte) {
    if (this.total === this.expected) zipError('SFZIP004', 'DEFLATE output exceeds declared size');
    this.ring[this.total++ & 32767] = byte;
    this.page[this.offset++] = byte;
    if (this.offset !== this.page.length) return null;
    const result = this.page;
    this.page = new Uint8Array(result.length);
    this.offset = 0;
    return result;
  }
}

function* decodeCompressed(input, output, trees) {
  const [literalLengths, distanceLengths] = trees;
  if (!literalLengths[256]) zipError('SFZIP012', 'Missing end-of-block code');
  const literals = huffman(literalLengths);
  const distances = huffman(distanceLengths);
  for (;;) {
    const value = yield* symbol(input, literals);
    if (value < 256) {
      const page = output.put(value);
      if (page) yield page;
      continue;
    }
    if (value === 256) return;
    if (value > 285) zipError('SFZIP012', 'Invalid length code');
    const length = lengthBase[value - 257] + (yield* input.read(lengthExtra[value - 257]));
    const distanceCode = yield* symbol(input, distances);
    if (distanceCode > 29) zipError('SFZIP012', 'Invalid distance code');
    const distance = distanceBase[distanceCode] + (yield* input.read(distanceExtra[distanceCode]));
    if (distance > output.total) zipError('SFZIP012', 'Invalid DEFLATE distance');
    for (let index = 0; index < length; index++) {
      const page = output.put(output.ring[(output.total - distance) & 32767]);
      if (page) yield page;
    }
  }
}

function* decode(expected, compressed, chunkSize) {
  const input = new BitInput();
  const output = new OutputWindow(expected, chunkSize);
  let final = false;
  let blocks = 0;
  while (!final) {
    if (++blocks > Math.max(1024, compressed * 2)) zipError('SFZIP012', 'DEFLATE block limit exceeded');
    final = !!(yield* input.read(1));
    const kind = yield* input.read(2);
    if (kind === 3) zipError('SFZIP012', 'Reserved DEFLATE block');
    if (kind === 0) {
      input.align();
      const length = yield* input.read(16);
      const complement = yield* input.read(16);
      if ((length ^ complement) !== 65535) zipError('SFZIP012', 'Invalid stored DEFLATE block');
      for (let index = 0; index < length; index++) {
        const page = output.put(yield* input.read(8));
        if (page) yield page;
      }
    } else {
      const trees = kind === 1 ? [Array.from({ length: 288 }, (_, index) => index < 144 ? 8 : index < 256 ? 9 : index < 280 ? 7 : 8),
        new Uint8Array(32).fill(5)] : yield* dynamicTrees(input);
      yield* decodeCompressed(input, output, trees);
    }
  }
  if (output.total !== expected || input.consumed !== compressed) zipError('SFZIP012', 'DEFLATE length mismatch or trailing input');
  if (output.offset) yield output.page.slice(0, output.offset);
}

/** Dependency-free incremental decoder. Scratch memory is a 32 KiB window plus one output/input chunk. */
export async function* inflateRawChunks(source, { length, compressed, chunkSize = 65536, signal }) {
  const input = source[Symbol.asyncIterator] ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  const decoder = decode(length, compressed, chunkSize);
  try {
    let state = decoder.next();
    while (!state.done) {
      signal?.throwIfAborted();
      if (state.value === null) {
        const next = await input.next();
        if (next.done) zipError('SFZIP012', 'Truncated DEFLATE stream');
        state = decoder.next(next.value);
      } else {
        yield state.value;
        state = decoder.next();
      }
    }
  } finally {
    decoder.return();
    await input.return?.();
  }
}
