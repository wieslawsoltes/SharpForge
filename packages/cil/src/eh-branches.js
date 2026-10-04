import { CilError } from './binary.js';
import { CilOpcodes, decodeInstructions } from './opcodes.js';
import { buildExceptionRegionTree } from './eh-regions.js';
import { validateInstructionPlacement } from './eh-control-flow.js';
import { ExceptionTransferIndex } from './eh-regions/transfer-index.js';
import { checkRegionCancellation } from './eh-regions/contracts.js';
import { decodedInstructionBoundaries } from './eh-regions/boundaries.js';

export const exceptionBranchDiagnosticCatalog = Object.freeze({
  CILCF0008: 'Branch exits an exception region',
  CILCF0009: 'Branch enters an exception region',
  CILCF0010: 'Fall-through exits an exception region',
  CILCF0011: 'Fall-through enters a filter or handler',
  CILCF0012: 'A filter or handler cannot contain method entry',
  CILCF0013: 'Control falls through the end of the method',
  CILCF0014: 'Transfer targets the interior of an instruction prefix group',
});

const contains = (region, offset) => !region || region.start <= offset && offset < region.end;

function reject(code, offset) {
  const error = new CilError(exceptionBranchDiagnosticCatalog[code], offset);
  error.code = code;
  throw error;
}

function branch(index, instruction, target) {
  if (!contains(index.regionAt(instruction.offset), target)) reject('CILCF0008', instruction.offset);
  const required = index.entryRegion(target, index.regionAt(target));
  if (!contains(required, instruction.offset)) reject('CILCF0009', instruction.offset);
}

function transfer(index, boundaries, instruction, target, leave) {
  if (!boundaries(target)) reject('CILCF0014', instruction.offset);
  if (!leave) branch(index, instruction, target);
}

function fallThrough(index, instruction, codeSize) {
  const target = instruction.offset + instruction.size;
  if (!contains(index.regionAt(instruction.offset), target)) reject('CILCF0010', instruction.offset);
  if (target === codeSize) reject('CILCF0013', instruction.offset);
  const required = index.entryRegion(target, index.regionAt(target));
  if (!contains(required, instruction.offset)) reject('CILCF0011', instruction.offset);
}

/** Check placement, ordinary branch/switch edges and lexical fall-through; leave EH targets need a separate check. */
export function validateExceptionBranches(code, handlers, options = {}) {
  const tree = buildExceptionRegionTree(code, handlers, options);
  const instructions = decodeInstructions(code, options);
  validateInstructionPlacement(instructions, tree, options);
  const index = new ExceptionTransferIndex(tree, options.signal);
  const boundaries = decodedInstructionBoundaries(code.length, instructions, options.signal);
  if (index.entryRegion(0, index.regionAt(0))) reject('CILCF0012', 0);
  for (const instruction of instructions) {
    checkRegionCancellation(options.signal);
    const leave = instruction.name === 'leave' || instruction.name === 'leave.s';
    if (instruction.operandKind === 'switch') {
      for (const target of instruction.operand) transfer(index, boundaries, instruction, target, false);
    } else if (instruction.operandKind === 'br8' || instruction.operandKind === 'br32') {
      transfer(index, boundaries, instruction, instruction.operand, leave);
    }
    const flow = CilOpcodes[instruction.name].flowControl;
    if (flow !== 'Branch' && flow !== 'Return' && flow !== 'Throw' && instruction.name !== 'jmp') {
      fallThrough(index, instruction, code.length);
    }
  }
  checkRegionCancellation(options.signal);
  return tree;
}
