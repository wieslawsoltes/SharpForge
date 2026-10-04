import { CilError } from './binary.js';
import { decodeInstructions } from './opcodes.js';
import { buildExceptionRegionTree } from './eh-regions.js';
import { validateInstructionPlacement } from './eh-control-flow.js';
import { validateBranchInstructions } from './eh-branches.js';
import { ExceptionLeaveIndex } from './eh-regions/leave-index.js';
import { checkRegionCancellation } from './eh-regions/contracts.js';

export const exceptionLeaveDiagnosticCatalog = Object.freeze({
  CILCF0015: 'Leave exits a filter, finally or fault handler',
  CILCF0016: 'Leave target violates an enclosing try restriction',
  CILCF0017: 'Leave target violates an enclosing catch restriction',
  CILCF0018: 'Leave enters a filter or handler',
  CILCF0019: 'Leave enters a try interior without an associated catch',
});

/** Validate lexical EH geometry, placement and all ordinary/leave/fall-through edges; evaluation stacks are separate. */
export function validateExceptionControlFlow(code, handlers, options = {}) {
  const tree = buildExceptionRegionTree(code, handlers, options);
  const instructions = decodeInstructions(code, options);
  validateInstructionPlacement(instructions, tree, options);
  const index = new ExceptionLeaveIndex(tree, options.signal);
  validateBranchInstructions(instructions, tree, options, index);
  for (const instruction of instructions) {
    checkRegionCancellation(options.signal);
    if (instruction.name !== 'leave' && instruction.name !== 'leave.s') continue;
    const diagnostic = index.failure(instruction.offset, instruction.operand);
    if (diagnostic) {
      const error = new CilError(exceptionLeaveDiagnosticCatalog[diagnostic], instruction.offset);
      error.code = diagnostic;
      throw error;
    }
  }
  checkRegionCancellation(options.signal);
  return tree;
}
