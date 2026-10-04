import { CilError } from '../binary.js';
import { decodedExceptionRegions } from '../eh-regions/build.js';
import { validateDecodedExceptionControlFlow } from '../eh-regions/control-flow.js';

/** Admit lexical EH flow before stack propagation, reusing the inspector's decoded method. */
export function executionHandlerOffsets(method, options, issue) {
  if (method.handlers.length) {
    try {
      const { tree, boundaries, limits } = decodedExceptionRegions(method.codeSize, method.instructions, method.handlers, options);
      validateDecodedExceptionControlFlow(method.instructions, tree, limits, boundaries);
    } catch (error) {
      if (!(error instanceof CilError)) throw error;
      issue(method, Number.isInteger(error.offset) && error.offset >= 0 ? { offset: error.offset } : null,
        'IL_EH_FLOW', error.message, { diagnostic: error.code });
      return null;
    }
    for (const handler of method.handlers) {
      if (handler.flags === 1) issue(method, null, 'IL_FILTER', 'Exception filters are inspection-only');
    }
  }
  return new Map(method.instructions.map((instruction, index) => [instruction.offset, index]));
}
