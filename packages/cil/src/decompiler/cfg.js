import { dataflowBlocks } from '../verify/dataflow-blocks.js';
import { decodeControlFlow, prepareDecodedControlFlow } from './cfg-input.js';
import { controlFlowCancellation, controlFlowFailure, controlFlowOptions } from './cfg-contracts.js';
export { controlFlowGraphDiagnosticCatalog } from './cfg-contracts.js';

const clauseKinds = Object.freeze({ 0: 'catch', 1: 'filter', 2: 'finally', 4: 'fault' });

function projectBlocks(graph, instructions, codeSize, signal) {
  const blocks = [];
  for (const [id, block] of graph.blocks.entries()) {
    controlFlowCancellation(signal);
    blocks.push({ id, startOffset: instructions[block.start].offset,
      endOffset: block.end === instructions.length ? codeSize : instructions[block.end].offset,
      firstInstruction: block.start, instructionCount: block.end - block.start,
      successors: [], predecessors: [] });
  }
  return blocks;
}

function projectEdges(graph, blocks, instructions, signal) {
  const edges = [];
  for (const [source, block] of graph.blocks.entries()) {
    controlFlowCancellation(signal);
    const last = instructions[block.end - 1];
    for (const [slot, target] of block.successors.entries()) {
      controlFlowCancellation(signal);
      if (target < 0) controlFlowFailure('CILCFG0006', undefined, last.offset);
      const switching = last.operandKind === 'switch' && slot < last.operand.length;
      const branching = (last.operandKind === 'br8' || last.operandKind === 'br32') && slot === 0;
      const kind = switching ? 'switch' : branching ? block.clearStack ? 'leave' : 'branch' : 'fall-through';
      const edge = Object.freeze({ id: edges.length, source, target, kind,
        caseIndex: switching ? slot : null, clearsStack: kind === 'leave' });
      edges.push(edge);
      blocks[source].successors.push(edge.id);
      blocks[target].predecessors.push(edge.id);
    }
  }
  return edges;
}

function projectExceptions(handlers, signal) {
  const boundaries = [];
  for (const [clause, handler] of handlers.entries()) {
    controlFlowCancellation(signal);
    boundaries.push(Object.freeze({ clause, kind: clauseKinds[handler.flags], tryStart: handler.start, tryEnd: handler.end,
      handlerStart: handler.target, handlerEnd: handler.handlerEnd, filterStart: handler.flags === 1 ? handler.catchType : null }));
  }
  return boundaries;
}

/** Internal decoded-method stage. It neither reads a method body nor resolves metadata operands. */
export function decodedControlFlowGraph(method, options = {}) {
  const limits = controlFlowOptions(options);
  const prepared = prepareDecodedControlFlow(method, limits);
  let graph;
  try {
    graph = dataflowBlocks(prepared.method, prepared.offsets, { maxDataflowInstructions: limits.maxInstructions,
      maxDataflowEdges: limits.maxEdges, signal: limits.signal });
  } catch (error) {
    controlFlowCancellation(limits.signal);
    if (error.code === 'CILDF0001') controlFlowFailure('CILCFG0002', error.message);
    throw error;
  }
  const blocks = projectBlocks(graph, method.instructions, method.codeSize, limits.signal);
  const edges = projectEdges(graph, blocks, method.instructions, limits.signal);
  const exceptionBoundaries = projectExceptions(prepared.method.handlers, limits.signal);
  const instructionBlocks = [];
  for (const block of graph.blockAt) {
    controlFlowCancellation(limits.signal);
    instructionBlocks.push(block);
  }
  for (const block of blocks) {
    controlFlowCancellation(limits.signal);
    Object.freeze(block.successors);
    Object.freeze(block.predecessors);
    Object.freeze(block);
  }
  return Object.freeze({ format: 'sharpforge.control-flow-graph', version: 1, flow: 'normal', codeSize: method.codeSize,
    instructionCount: method.instructions.length, entryBlock: blocks.length ? 0 : null,
    blocks: Object.freeze(blocks), edges: Object.freeze(edges), instructionBlocks: Object.freeze(instructionBlocks),
    exceptionBoundaries: Object.freeze(exceptionBoundaries) });
}

/** Build an owned immutable normal-flow CFG from CIL bytes and raw EH clauses. Offsets are bytes.
 * Uses the existing decoder and verifier block splitter. Invalid/bounded/cancelled input throws stable CILCFG/CILR errors.
 * Leave edges name their eventual IL target; exception dispatch and finally execution order require region analysis. */
export function buildControlFlowGraph(code, handlers = [], options = {}) {
  const limits = controlFlowOptions(options);
  return decodedControlFlowGraph(decodeControlFlow(code, handlers, limits), limits);
}
