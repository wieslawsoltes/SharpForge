import { CilOpcodes, decodeInstructions } from '../opcodes.js';
import { CilError } from '../binary.js';
import { checkRegionCancellation, regionFailure } from './contracts.js';

/** A compact bitmap avoids retaining decoded instructions or a Set entry for every byte boundary. */
export function instructionBoundaries(code, options) {
  let instructions;
  try {
    instructions = decodeInstructions(code, options);
  } catch (error) {
    checkRegionCancellation(options.signal);
    if (!(error instanceof CilError)) throw error;
    regionFailure('CILR0029', error.message);
  }
  return decodedInstructionBoundaries(code.length, instructions, options.signal);
}

/** Reuse instruction-group boundaries when another validator already owns the decoded instruction array. */
export function decodedInstructionBoundaries(codeSize, instructions, signal) {
  const bits = new Uint8Array(Math.floor(codeSize / 8) + 1);
  let prefix = false;
  for (const instruction of instructions) {
    checkRegionCancellation(signal);
    if (!prefix) bits[instruction.offset >> 3] |= 1 << (instruction.offset & 7);
    prefix = CilOpcodes[instruction.name].opCodeType === 'Prefix';
  }
  if (prefix) regionFailure('CILR0030');
  bits[codeSize >> 3] |= 1 << (codeSize & 7);
  return offset => Boolean(bits[offset >> 3] & (1 << (offset & 7)));
}
