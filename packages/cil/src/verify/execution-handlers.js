import { CilError } from '../binary.js';
import { validateInstructionOutsideRegions } from '../eh-control-flow.js';
import { decodedExceptionRegions } from '../eh-regions/build.js';
import { validateDecodedExceptionControlFlow } from '../eh-regions/control-flow.js';

/** Admit lexical EH flow before stack propagation, reusing the inspector's decoded method. */
export function executionHandlerOffsets(method, options, issue) {
  try {
    if (method.handlers.length) {
      const { tree, boundaries, limits } = decodedExceptionRegions(method.codeSize, method.instructions, method.handlers, options);
      validateDecodedExceptionControlFlow(method.instructions, tree, limits, boundaries);
      return new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
    }
    // Fold placement into the existing index pass; no additional scan or per-instruction scratch arrays.
    const offsets = new Map();
    for (let index = 0; index < method.instructions.length; index++) {
      const instruction = method.instructions[index];
      validateInstructionOutsideRegions(instruction);
      offsets.set(instruction.offset, index);
    }
    return offsets;
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    issue(method, Number.isInteger(error.offset) && error.offset >= 0 ? { offset: error.offset } : null,
      'IL_EH_FLOW', error.message, { diagnostic: error.code });
    return null;
  }
}
