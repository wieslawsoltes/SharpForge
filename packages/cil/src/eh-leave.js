import { decodeInstructions } from './opcodes.js';
import { buildExceptionRegionTree } from './eh-regions.js';
import { validateDecodedExceptionControlFlow } from './eh-regions/control-flow.js';
export { exceptionLeaveDiagnosticCatalog } from './eh-regions/control-flow.js';

/** Validate lexical EH geometry, placement and all ordinary/leave/fall-through edges; evaluation stacks are separate. */
export function validateExceptionControlFlow(code, handlers, options = {}) {
  const tree = buildExceptionRegionTree(code, handlers, options);
  const instructions = decodeInstructions(code, options);
  return validateDecodedExceptionControlFlow(instructions, tree, options);
}
