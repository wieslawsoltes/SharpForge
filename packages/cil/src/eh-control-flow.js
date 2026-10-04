import { CilError } from './binary.js';
import { decodeInstructions } from './opcodes.js';
import { buildExceptionRegionTree } from './eh-regions.js';
import { ExceptionRegionCursor } from './eh-regions/cursor.js';
import { checkRegionCancellation } from './eh-regions/contracts.js';

export const exceptionPlacementDiagnosticCatalog = Object.freeze({
  CILCF0001: 'Rethrow requires an enclosing catch or filtered handler',
  CILCF0002: 'Ret is forbidden inside exception regions',
  CILCF0003: 'Jmp is forbidden inside exception regions',
  CILCF0004: 'Endfinally requires an innermost finally or fault handler',
  CILCF0005: 'Endfilter must be the last instruction of a filter',
  CILCF0006: 'Tail calls are forbidden inside exception regions',
  CILCF0007: 'Every filter must end with endfilter',
});

function reject(code, offset) {
  const error = new CilError(exceptionPlacementDiagnosticCatalog[code], offset);
  error.code = code;
  throw error;
}

function rethrow(instruction, cursor) {
  if (!cursor.catches) reject('CILCF0001', instruction.offset);
}
function returnInstruction(instruction, cursor) {
  if (cursor.region) reject('CILCF0002', instruction.offset);
}
function jump(instruction, cursor) {
  if (cursor.region) reject('CILCF0003', instruction.offset);
}
function endFinally(instruction, cursor) {
  if (cursor.region?.kind !== 'finally' && cursor.region?.kind !== 'fault') reject('CILCF0004', instruction.offset);
}
function endFilter(instruction, cursor) {
  if (cursor.region?.kind !== 'filter' || instruction.offset + instruction.size !== cursor.region.end) {
    reject('CILCF0005', instruction.offset);
  }
}
function tail(instruction, cursor) {
  if (cursor.region) reject('CILCF0006', instruction.offset);
}

const placementChecks = Object.freeze({ rethrow, ret: returnInstruction, jmp: jump, endfinally: endFinally,
  endfilter: endFilter, 'tail.': tail });

/** Check EH-sensitive instruction placement, returning an immutable lexical tree; branch/leave edges are separate. */
export function validateExceptionInstructionPlacement(code, handlers, options = {}) {
  const tree = buildExceptionRegionTree(code, handlers, options);
  // Keep the tree builder's bounded decoding contract independent; this second pass supplies opcode records only.
  const instructions = decodeInstructions(code, options);
  const cursor = new ExceptionRegionCursor(tree);
  for (const instruction of instructions) {
    checkRegionCancellation(options.signal);
    cursor.advance(instruction.offset);
    if (Object.hasOwn(placementChecks, instruction.name)) placementChecks[instruction.name](instruction, cursor);
    if (cursor.region?.kind === 'filter' && instruction.offset + instruction.size === cursor.region.end &&
        instruction.name !== 'endfilter') reject('CILCF0007', instruction.offset);
  }
  checkRegionCancellation(options.signal);
  return tree;
}
