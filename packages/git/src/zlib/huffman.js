import { GitError } from '../errors.js';

/** Canonical RFC 1951 Huffman decoder with bounded storage and complete-tree checks. */
export function huffmanTable(lengths, { allowEmpty = false, allowSingle = true } = {}) {
  const counts = new Uint16Array(16);
  let maximum = 0;
  for (const length of lengths) {
    if (!Number.isInteger(length) || length < 0 || length > 15) throw new GitError('Corrupt', 'Invalid Huffman code length');
    counts[length]++;
    maximum = Math.max(maximum, length);
  }
  if (!maximum) {
    if (!allowEmpty) throw new GitError('Corrupt', 'Empty Huffman alphabet');
    return { counts, symbols: new Uint16Array(), maximum: 0 };
  }
  let remaining = 1;
  for (let bits = 1; bits <= 15; bits++) {
    remaining = remaining * 2 - counts[bits];
    if (remaining < 0) throw new GitError('Corrupt', 'Oversubscribed Huffman alphabet');
  }
  if (remaining && !(allowSingle && maximum === 1 && counts[1] === 1)) {
    throw new GitError('Corrupt', 'Incomplete Huffman alphabet');
  }
  const offsets = new Uint16Array(16);
  for (let bits = 2; bits <= 15; bits++) offsets[bits] = offsets[bits - 1] + counts[bits - 1];
  const symbols = new Uint16Array(lengths.length - counts[0]);
  for (let symbol = 0; symbol < lengths.length; symbol++) {
    const bits = lengths[symbol];
    if (bits) symbols[offsets[bits]++] = symbol;
  }
  return { counts, symbols, maximum };
}

export function decodeSymbol(reader, table) {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let bits = 1; bits <= table.maximum; bits++) {
    code |= reader.read(1);
    const count = table.counts[bits];
    if (code >= first && code < first + count) return table.symbols[index + code - first];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new GitError('Corrupt', 'Invalid Huffman symbol');
}

/** Read a dynamic tree, rejecting repeats which overrun either encoded alphabet. */
export function dynamicTables(reader) {
  const literalCount = reader.read(5) + 257;
  const distanceCount = reader.read(5) + 1;
  const codeCount = reader.read(4) + 4;
  if (literalCount > 286 || distanceCount > 32) throw new GitError('Corrupt', 'Invalid DEFLATE alphabet size');
  const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const codeLengths = new Uint8Array(19);
  for (let index = 0; index < codeCount; index++) codeLengths[order[index]] = reader.read(3);
  const codeTable = huffmanTable(codeLengths, { allowSingle: false });
  const lengths = new Uint8Array(literalCount + distanceCount);
  for (let offset = 0; offset < lengths.length;) {
    const symbol = decodeSymbol(reader, codeTable);
    if (symbol < 16) {
      lengths[offset++] = symbol;
      continue;
    }
    if (symbol === 16 && !offset) throw new GitError('Corrupt', 'Huffman repeat has no preceding length');
    const count = symbol === 16 ? reader.read(2) + 3 : symbol === 17 ? reader.read(3) + 3 : reader.read(7) + 11;
    const value = symbol === 16 ? lengths[offset - 1] : 0;
    if (offset + count > lengths.length) throw new GitError('Corrupt', 'Huffman repeat exceeds alphabet');
    lengths.fill(value, offset, offset + count);
    offset += count;
  }
  if (!lengths[256]) throw new GitError('Corrupt', 'Missing DEFLATE end-of-block symbol');
  return {
    literals: huffmanTable(lengths.subarray(0, literalCount)),
    distances: huffmanTable(lengths.subarray(literalCount), { allowEmpty: true })
  };
}

export function fixedTables() {
  const lengths = Uint8Array.from({ length: 288 }, (_, index) => index < 144 ? 8 : index < 256 ? 9 : index < 280 ? 7 : 8);
  return { literals: huffmanTable(lengths), distances: huffmanTable(new Uint8Array(32).fill(5)) };
}
