import { CilError } from '../binary.js';
import { validateHandlerEntryHeights } from './handlers-access.js';
import { DataflowWorklist, dataflowCancellation } from './dataflow.js';
import { dataflowBlocks } from './dataflow-blocks.js';

function heightTransfer(inspector, method, context, result) {
  const { issue, issues, stackEffect, options = {} } = context;
  const reject = (instruction, message, diagnostic) =>
    issue(method, instruction, 'IL_STACK', message, diagnostic ? { diagnostic } : {});
  return (block, incoming) => {
    let height = incoming;
    for (let index = block.start; index < block.end && issues.length < 200; index++) {
      dataflowCancellation(options.signal);
      const instruction = method.instructions[index];
      result.peak = Math.max(result.peak, height);
      if (height > method.maxStack) {
        reject(instruction, 'Incoming evaluation stack exceeds maxstack', 'StackOverflow');
        return null;
      }
      result.heights.set(index, height);
      let pop, push;
      try {
        [pop, push] = stackEffect(inspector, method, instruction);
      } catch (error) {
        reject(instruction, error.message);
        return null;
      }
      if (height < pop) {
        reject(instruction, 'Evaluation stack underflow', 'StackUnderflow');
        return null;
      }
      const after = height - pop + push;
      result.peak = Math.max(result.peak, after);
      if (after > method.maxStack) reject(instruction, 'Evaluation stack exceeds maxstack', 'StackOverflow');
      if (instruction.name === 'ret') {
        if (height !== pop) reject(instruction, 'Invalid return stack', pop ? 'ReturnEmpty' : 'ReturnVoid');
        return null;
      }
      if (instruction.name === 'jmp' && height !== 0) reject(instruction, 'jmp requires an empty stack', 'JmpStack');
      if (instruction.name === 'endfilter' && height !== 1) reject(instruction, 'endfilter requires one Int32 decision', 'FilterStack');
      if (instruction.name === 'endfinally' && height !== 0)
        reject(instruction, 'endfinally requires an empty stack', 'FinOrFaultNonEmptyStack');
      height = after;
    }
    return height;
  };
}

/** Execution-profile height policy over the shared bounded block solver; this does not infer stack types. */
export function executionStackHeights(inspector, method, offsets, context) {
  const { issue, issues, options = {} } = context;
  const result = { peak: 0, heights: new Map() };
  try {
    const graph = dataflowBlocks(method, offsets, options);
    const worklist = new DataflowWorklist(graph, {
      emptyState: 0,
      stopped: () => issues.length >= 200,
      invalidEdge: () => issue(method, null, 'IL_FLOW', 'Control flow leaves the method'),
      merge(incoming, stored, block) {
        result.peak = Math.max(result.peak, incoming);
        if (incoming > method.maxStack) {
          issue(method, method.instructions[block.start], 'IL_STACK',
            'Incoming evaluation stack exceeds maxstack', { diagnostic: 'StackOverflow' });
          return stored;
        }
        if (incoming !== stored) issue(method, method.instructions[block.start], 'IL_STACK',
          'Inconsistent evaluation stack height at join', { diagnostic: 'PathStackDepth' });
        return stored;
      },
      transfer: heightTransfer(inspector, method, context, result),
    }, options);
    worklist.enqueue(graph.blocks.length ? 0 : -1, 0);
    for (const handler of method.handlers) {
      const index = offsets.get(handler.target);
      worklist.enqueue(index === undefined ? -1 : graph.blockAt[index], handler.flags === 0 || handler.flags === 1 ? 1 : 0);
      if (handler.flags === 1) {
        const filter = offsets.get(handler.catchType);
        worklist.enqueue(filter === undefined ? -1 : graph.blockAt[filter], 1);
      }
    }
    worklist.run();
    validateHandlerEntryHeights(method, offsets, result.heights, issue, { filteredHandlers: true });
  } catch (error) {
    if (!(error instanceof CilError) || !['CILDF0001', 'CILDF0002'].includes(error.code)) throw error;
    issue(method, null, error.code === 'CILDF0002' ? 'IL_CANCELLED' : 'IL_LIMIT', error.message, { diagnostic: error.code });
  }
  return result;
}
