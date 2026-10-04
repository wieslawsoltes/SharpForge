import { CilError } from './binary.js';
import { CilOpcodes } from './opcodes/catalog.js';
import { decodeInstructionBytes } from './opcodes/decoder.js';

function prefixOpcode(name) {
  return typeof name === 'string' && Object.hasOwn(CilOpcodes, name) && CilOpcodes[name].opCodeType === 'Prefix';
}

function validatePrefix(prefix) {
  const { name, operand, offset } = prefix ?? {};
  if (!prefixOpcode(name)) throw new CilError('Expected a CIL instruction prefix', offset);
  if (name === 'unaligned.') {
    if (operand !== 1 && operand !== 2 && operand !== 4) throw new CilError('Invalid unaligned prefix operand', offset);
  } else if (name === 'no.') {
    if (!Number.isInteger(operand) || operand < 0 || operand > 7) throw new CilError('Invalid no. prefix flags', offset);
  } else if (name === 'constrained.') {
    const table = Number.isInteger(operand) ? operand >>> 24 : -1;
    if (!Number.isInteger(operand) || operand < 0 || operand > 0xffffffff ||
        (table !== 1 && table !== 2 && table !== 27) || !(operand & 0xffffff)) {
      throw new CilError('Constrained prefix requires a TypeDefOrRef token', offset);
    }
  } else if (operand !== undefined) throw new CilError('Operand supplied to an operand-free prefix', offset);
}

function checkCancellation(signal) {
  if (signal?.aborted) throw new CilError('CIL prefix grouping cancelled');
}

function prefixLimit(offset) {
  const error = new CilError('CIL prefix chain limit exceeded', offset);
  error.limitKind = 'prefix-count';
  throw error;
}

/** Decode bounded prefix groups. Offsets/targets use original byte positions; flat decoding remains separate. */
export function decodeInstructionGroups(bytes, { maxInstructions = 1_000_000, maxPrefixes = 64, signal } = {}) {
  checkCancellation(signal);
  if (!Number.isInteger(maxInstructions) || maxInstructions < 0 || maxInstructions > 1_000_000 ||
      !Number.isInteger(maxPrefixes) || maxPrefixes < 0 || maxPrefixes > 64) {
    throw new CilError('Invalid CIL prefix grouping limit');
  }
  if (!(bytes instanceof Uint8Array) || bytes.length > 16 * 1024 * 1024) throw new CilError('CIL prefix input limit exceeded');
  const instructions = decodeInstructionBytes(bytes, maxInstructions, 1_000_000), groups = [];
  let prefixes = [];
  for (const instruction of instructions) {
    checkCancellation(signal);
    if (prefixOpcode(instruction.name)) {
      if (prefixes.length >= maxPrefixes) prefixLimit(instruction.offset);
      validatePrefix(instruction);
      prefixes.push(instruction);
      continue;
    }
    const offset = prefixes[0]?.offset ?? instruction.offset;
    groups.push({ ...instruction, offset, opcodeOffset: instruction.offset,
      size: instruction.offset + instruction.size - offset, prefixes });
    prefixes = [];
  }
  if (prefixes.length) throw new CilError('Dangling CIL prefix chain', prefixes[0].offset);
  const starts = new Set();
  for (const group of groups) starts.add(group.offset);
  for (const group of groups) {
    checkCancellation(signal);
    const targets = group.operandKind === 'switch' ? group.operand
      : group.operandKind.startsWith('br') ? [group.operand] : [];
    for (const target of targets) {
      if (!starts.has(target)) throw new CilError('Branch target is not an instruction-group boundary', group.offset);
    }
  }
  return groups;
}

/** Internal writer seam; validate the entire prefix sequence before emitting any bytes. */
export function emitInstructionGroup(writer, name, operand, prefixes = []) {
  if (typeof name !== 'string' || !Object.hasOwn(CilOpcodes, name) || prefixOpcode(name)) {
    throw new CilError('Expected a CIL group target instruction');
  }
  if (!Array.isArray(prefixes) || prefixes.length > 64) throw new CilError('CIL prefix chain limit exceeded');
  for (const prefix of prefixes) validatePrefix(prefix);
  for (const prefix of prefixes) writer.op(prefix.name, prefix.operand);
  return writer.op(name, operand);
}
