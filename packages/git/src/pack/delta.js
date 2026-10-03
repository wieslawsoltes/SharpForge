import { GitError, checkCancelled, checkLimit } from '../errors.js';

function readSize(bytes, cursor) {
  let size = 0;
  let multiplier = 1;
  for (let count = 0; count < 8; count++) {
    if (cursor.offset >= bytes.length) throw new GitError('Corrupt', 'Truncated delta size');
    const value = bytes[cursor.offset++];
    size += (value & 127) * multiplier;
    checkLimit(size, Number.MAX_SAFE_INTEGER, 'Delta size');
    if (!(value & 128)) return size;
    multiplier *= 128;
  }
  throw new GitError('Corrupt', 'Overlong delta size');
}

/** Apply Git copy/insert bytecode in O(base + result + instructions), rejecting malformed ranges. */
export function applyDelta(base, delta, { maxObjectBytes = 64 * 1024 * 1024, signal } = {}) {
  const cursor = { offset: 0 };
  const baseSize = readSize(delta, cursor);
  if (baseSize !== base.length) throw new GitError('Corrupt', 'Delta base size does not match', { expected: baseSize, actual: base.length });
  const size = checkLimit(readSize(delta, cursor), maxObjectBytes, 'Delta result');
  const result = new Uint8Array(size);
  let written = 0;
  while (cursor.offset < delta.length) {
    checkCancelled(signal);
    const opcode = delta[cursor.offset++];
    if (!opcode) throw new GitError('Corrupt', 'Delta opcode zero is reserved');
    if (!(opcode & 128)) {
      if (cursor.offset + opcode > delta.length || written + opcode > size) throw new GitError('Corrupt', 'Delta insertion exceeds bounds');
      result.set(delta.subarray(cursor.offset, cursor.offset + opcode), written);
      cursor.offset += opcode;
      written += opcode;
      continue;
    }
    let offset = 0;
    let length = 0;
    for (let index = 0; index < 7; index++) {
      if (!(opcode & (1 << index))) continue;
      if (cursor.offset >= delta.length) throw new GitError('Corrupt', 'Truncated delta copy operand');
      const value = delta[cursor.offset++];
      if (index < 4) offset += value * 2 ** (index * 8);
      else length += value * 2 ** ((index - 4) * 8);
    }
    if (!length) length = 0x10000;
    if (offset + length > base.length || written + length > size) throw new GitError('Corrupt', 'Delta copy exceeds bounds');
    result.set(base.subarray(offset, offset + length), written);
    written += length;
  }
  if (written !== size) throw new GitError('Corrupt', 'Delta output size does not match', { expected: size, actual: written });
  return result;
}

export function encodeDeltaSize(size) {
  checkLimit(size, Number.MAX_SAFE_INTEGER, 'Delta size');
  const bytes = [];
  do {
    const byte = size % 128;
    size = Math.floor(size / 128);
    bytes.push(byte | (size ? 128 : 0));
  } while (size);
  return bytes;
}

function copyInstruction(offset, length) {
  const bytes = [128];
  for (let index = 0; index < 7; index++) {
    const value = index < 4 ? Math.floor(offset / 2 ** (index * 8)) % 256 : Math.floor(length / 2 ** ((index - 4) * 8)) % 256;
    if (!value) continue;
    bytes[0] |= 1 << index;
    bytes.push(value);
  }
  return bytes;
}

function hashBlock(bytes, start, length = 16) {
  let hash = 2166136261;
  for (let index = start; index < start + length; index++) hash = Math.imul(hash ^ bytes[index], 16777619);
  return hash >>> 0;
}

/** Create a bounded block-match delta; candidate chains are capped to avoid adversarial quadratic search. */
export function createDelta(base, target, { blockSize = 16, maxCandidates = 8, maxIndexEntries = 65536, signal } = {}) {
  if (blockSize < 4 || blockSize > 128 || maxCandidates < 1 || maxCandidates > 32) throw new GitError('Limit', 'Invalid delta matcher bounds');
  const blocks = new Map();
  const stride = Math.max(blockSize, Math.ceil(base.length / maxIndexEntries));
  for (let offset = 0; offset + blockSize <= base.length; offset += stride) {
    const key = hashBlock(base, offset, blockSize);
    const positions = blocks.get(key) ?? [];
    if (positions.length < maxCandidates) positions.push(offset);
    blocks.set(key, positions);
  }
  const output = new Uint8Array(target.length + Math.ceil(target.length / 127) + 32);
  let outputSize = 0;
  const append = bytes => { output.set(bytes, outputSize); outputSize += bytes.length; };
  append(encodeDeltaSize(base.length));
  append(encodeDeltaSize(target.length));
  let literalStart = 0;
  let cursor = 0;
  const flushLiterals = end => {
    while (literalStart < end) {
      const length = Math.min(127, end - literalStart);
      output[outputSize++] = length;
      output.set(target.subarray(literalStart, literalStart + length), outputSize);
      outputSize += length;
      literalStart += length;
    }
  };
  while (cursor + blockSize <= target.length) {
    if (!(cursor & 4095)) checkCancelled(signal);
    const candidates = blocks.get(hashBlock(target, cursor, blockSize)) ?? [];
    let bestOffset = 0;
    let bestLength = 0;
    for (const offset of candidates) {
      let length = 0;
      const maximum = Math.min(base.length - offset, target.length - cursor, 0xffffff);
      while (length < maximum && base[offset + length] === target[cursor + length]) length++;
      if (length > bestLength) { bestOffset = offset; bestLength = length; }
    }
    if (bestLength < blockSize) { cursor++; continue; }
    flushLiterals(cursor);
    append(copyInstruction(bestOffset, bestLength));
    cursor += bestLength;
    literalStart = cursor;
  }
  flushLiterals(target.length);
  return output.slice(0, outputSize);
}
