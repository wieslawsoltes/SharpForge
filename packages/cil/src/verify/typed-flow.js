import { AssemblyInspector } from '../inspector.js';
import { CilError } from '../binary.js';
import { DataflowWorklist, dataflowCancellation, dataflowLimit, dataflowFailure } from './dataflow.js';
import { dataflowBlocks } from './dataflow-blocks.js';
import { executionHandlerOffsets } from './execution-handlers.js';
import { mergeVerificationStacks } from './type-relations.js';
import { sameVerificationType } from './types.js';
import { numericMethodSignature, primitiveRelations } from './typed-signatures.js';
import { numericTransfers } from './numeric-tables.js';
import { transferNumericInstruction } from './ops-numeric.js';
import { TypedTransferStack } from './typed-stack.js';

const empty = Object.freeze([]);
const profile = 'SharpForge.TypedCIL.Numeric/1';

function mergeStates(incoming, stored, state, options) {
  if (incoming.length !== stored.length) state.fail('PathStackDepth');
  state.charge(stored.length);
  let merged;
  try {
    merged = mergeVerificationStacks(incoming, stored, {
      maxStack: state.method.maxStack, signal: options.signal, relations: primitiveRelations,
    });
  } catch (error) {
    if (error instanceof CilError && error.code === 'CILV0002') state.fail('PathStackUnexpected');
    throw error;
  }
  return merged.every((value, index) => sameVerificationType(value, stored[index])) ? stored : merged;
}

function transferBlock(block, incoming, state, options) {
  state.restore(incoming);
  for (let index = block.start; index < block.end; index++) {
    dataflowCancellation(options.signal);
    const instruction = state.method.instructions[index];
    state.instruction = instruction;
    transferNumericInstruction(numericTransfers[instruction.name], instruction, state);
    if (state.ended) return null;
  }
  return state.snapshot();
}

function preflight(method, state, options) {
  if (!method.hasBody || method.implFlags & 3 || method.flags & 0x2000)
    state.fail('UnsupportedBody', 'Typed verification requires an IL method body', true);
  if (method.handlers.length) state.fail('UnsupportedHandlers', 'Typed exception-state policies are not integrated yet', true);
  if (method.instructions.length > dataflowLimit(options.maxDataflowInstructions, 1000000, 1000000))
    dataflowFailure('Dataflow instruction limit exceeded');
  for (const instruction of method.instructions) {
    dataflowCancellation(options.signal);
    if (!Object.hasOwn(numericTransfers, instruction.name)) {
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
    preflight(method, state, options);
    state.signature = numericMethodSignature(inspector, method, options, state.fail);
    const offsets = executionHandlerOffsets(method, options, (current, instruction, code, message, details) => {
      state.instruction = instruction;
      state.fail(details?.diagnostic ?? code, message);
    });
    if (!offsets) state.fail('InvalidControlFlow');
    const graph = dataflowBlocks(method, offsets, options);
    const worklist = new DataflowWorklist(graph, {
      emptyState: empty,
      stopped: () => false,
      invalidEdge: () => state.fail('BadJumpTarget'),
      merge(incoming, stored, block) {
        state.instruction = method.instructions[block.start];
        return mergeStates(incoming, stored, state, options);
      },
      transfer: (block, incoming) => transferBlock(block, incoming, state, options),
    }, options);
    worklist.enqueue(graph.blocks.length ? 0 : -1, empty);
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
