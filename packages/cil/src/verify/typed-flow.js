import { AssemblyInspector } from '../inspector.js';
import { CilError } from '../binary.js';
import { DataflowWorklist, dataflowCancellation, dataflowLimit, dataflowFailure } from './dataflow.js';
import { dataflowBlocks } from './dataflow-blocks.js';
import { executionHandlerOffsets } from './execution-handlers.js';
import { numericMethodSignature, primitiveRelations } from './typed-signatures.js';
import { typedTransfers, transferTypedInstruction } from './typed-transfers.js';
import { TypedTransferStack } from './typed-stack.js';
import { createTypedFlowState } from './typed-state.js';

const profile = 'SharpForge.TypedCIL.Numeric/1';

function transferBlock(block, incoming, state, options, flow) {
  flow.restore(incoming);
  for (let index = block.start; index < block.end; index++) {
    dataflowCancellation(options.signal);
    const instruction = state.method.instructions[index];
    state.instruction = instruction;
    transferTypedInstruction(instruction, state);
    if (state.ended) return null;
  }
  return flow.snapshot();
}

function preflight(method, state, options) {
  if (!method.hasBody || method.implFlags & 3 || method.flags & 0x2000)
    state.fail('UnsupportedBody', 'Typed verification requires an IL method body', true);
  if (method.handlers.length) state.fail('UnsupportedHandlers', 'Typed exception-state policies are not integrated yet', true);
  if (method.instructions.length > dataflowLimit(options.maxDataflowInstructions, 1000000, 1000000))
    dataflowFailure('Dataflow instruction limit exceeded');
  for (const instruction of method.instructions) {
    dataflowCancellation(options.signal);
    if (!Object.hasOwn(typedTransfers, instruction.name)) {
      state.instruction = instruction;
      state.fail('UnsupportedOpcode', `Typed policy is unavailable for ${instruction.name}`, true);
    }
  }
}

/** Verify one decoded method using registered typed numeric transfers and bounded block propagation.
 * Returns verified/rejected/unknown; unknown never qualifies execution. Broader opcode/EH policies remain pending.
 * The cumulative maxTypedStackSlots budget (default/hard ceiling 1M slots) covers scratch and block-state copies.
 */
export function verifyCilMethodTypes(input, methodToken, options = {}) {
  let state;
  try {
    dataflowCancellation(options.signal);
    const inspector = input instanceof AssemblyInspector ? input : new AssemblyInspector(input, options);
    const method = inspector.getMethod(methodToken);
    if (!Number.isInteger(method.maxStack) || method.maxStack < 0 || method.maxStack > 65535)
      throw new CilError('Invalid maxstack header');
    state = new TypedTransferStack(method, options);
    state.relations = primitiveRelations;
    preflight(method, state, options);
    state.signature = numericMethodSignature(inspector, method, options, state.fail);
    const offsets = executionHandlerOffsets(method, options, (current, instruction, code, message, details) => {
      state.instruction = instruction;
      state.fail(details?.diagnostic ?? code, message);
    });
    if (!offsets) state.fail('InvalidControlFlow');
    const graph = dataflowBlocks(method, offsets, options);
    const flow = createTypedFlowState(state, options);
    const worklist = new DataflowWorklist(graph, {
      emptyState: flow.entry,
      stopped: () => false,
      invalidEdge: () => state.fail('BadJumpTarget'),
      merge(incoming, stored, block) {
        state.instruction = method.instructions[block.start];
        return flow.merge(incoming, stored);
      },
      transfer: (block, incoming) => transferBlock(block, incoming, state, options, flow),
    }, options);
    worklist.enqueue(graph.blocks.length ? 0 : -1, flow.entry);
    worklist.run();
    return { status: 'verified', profile, methodToken, peakStack: state.peak, diagnostics: [] };
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    const unknown = ['CILT0002', 'CILDF0001', 'CILDF0002', 'CILV0003', 'CILV0005'].includes(error.code);
    return { status: unknown ? 'unknown' : 'rejected', profile, methodToken, peakStack: state?.peak ?? 0,
      diagnostics: [{ code: error.code ?? 'CILT0001', diagnostic: error.diagnostic ?? error.code ?? 'InvalidMetadata',
        offset: error.offset ?? state?.instruction?.offset, message: error.message }] };
  }
}
