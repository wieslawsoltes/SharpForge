import { CilError } from './binary.js';
import { decodeInstructionGroups } from './il-prefixes.js';
import { fixedStackEffect } from './stack-effects.js';
import { decodedExceptionRegions, regionSettings } from './eh-regions/build.js';
import { validateDecodedExceptionControlFlow } from './eh-regions/control-flow.js';
import { ExceptionRegionCursor } from './eh-regions/cursor.js';
import { validateInstructionOutsideRegions, validateTailPlacement } from './eh-control-flow.js';
import { validateHandlerEntryHeights } from './verify/handlers-access.js';
import { DataflowWorklist, dataflowCancellation, dataflowLimit } from './verify/dataflow.js';
import { dataflowBlocks } from './verify/dataflow-blocks.js';

export const maxStackDiagnosticCatalog = Object.freeze({
  CILMS0001: 'Invalid maxstack analysis input or instructions',
  CILMS0002: 'An authoritative variable stack effect is required',
  CILMS0003: 'Invalid evaluation stack height',
  CILMS0004: 'Evaluation stack exceeds the UInt16 method-header limit',
  CILMS0005: 'Invalid evaluation stack control flow',
  CILMS0006: 'Stack-analysis decoding limit exceeded',
});

function failure(code, offset, message = maxStackDiagnosticCatalog[code]) {
  const error = new CilError(message, offset);
  error.code = code;
  throw error;
}

class EffectResolutionFailure extends Error {
  constructor(original) {
    super('Stack-effect resolver threw');
    this.original = original;
  }
}

function effectOf(instruction, options) {
  let effect = fixedStackEffect(instruction.name);
  if (effect !== null) return effect;
  if (options.resolveStackEffect) {
    try { effect = options.resolveStackEffect(instruction); }
    catch (error) { throw new EffectResolutionFailure(error); }
  }
  if (effect === undefined || effect === null) failure('CILMS0002', instruction.offset);
  const { pops, pushes } = effect;
  if (!Number.isSafeInteger(pops) || pops < 0 || !Number.isSafeInteger(pushes) || pushes < 0 || pushes > 1 ||
      (instruction.name === 'ret' && (pops > 1 || pushes !== 0)) ||
      (instruction.name === 'newobj' && pushes !== 1) ||
      ((instruction.name === 'calli' || instruction.name === 'callvirt') && pops === 0)) {
    failure('CILMS0001', instruction.offset, 'Invalid authoritative stack effect');
  }
  return effect;
}

function validateRegions(code, instructions, handlers, options) {
  if (!handlers.length) {
    for (const instruction of instructions) {
      dataflowCancellation(options.signal);
      validateInstructionOutsideRegions(instruction);
    }
    return;
  }
  const { tree, boundaries, limits } = decodedExceptionRegions(code.length, instructions, handlers, options);
  validateDecodedExceptionControlFlow(instructions, tree, limits, boundaries);
  // The graph uses prefix groups; placement still needs the otherwise hidden tail. instruction.
  const cursor = new ExceptionRegionCursor(tree);
  for (const instruction of instructions) {
    dataflowCancellation(options.signal);
    cursor.advance(instruction.offset);
    for (const prefix of instruction.prefixes) if (prefix.name === 'tail.') validateTailPlacement(prefix, cursor);
  }
}

function transfer(method, options, result) {
  return (block, incoming) => {
    let height = incoming;
    for (let index = block.start; index < block.end; index++) {
      dataflowCancellation(options.signal);
      const instruction = method.instructions[index];
      result.heights?.set(index, height);
      result.peak = Math.max(result.peak, height);
      const { pops, pushes } = effectOf(instruction, options);
      if (height < pops) failure('CILMS0003', instruction.offset, 'Evaluation stack underflow');
      const after = height - pops + pushes;
      if (!Number.isSafeInteger(after) || after > 65535) failure('CILMS0004', instruction.offset);
      result.peak = Math.max(result.peak, after);
      if ((instruction.name === 'ret' && height !== pops) ||
          ((instruction.name === 'endfinally' || instruction.name === 'jmp') && height !== 0) ||
          ((instruction.name === 'endfilter' || instruction.name === 'localloc') && height !== 1)) {
        failure('CILMS0003', instruction.offset, `Invalid stack at ${instruction.name}`);
      }
      height = after;
    }
    return height;
  };
}

function analyze(code, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || !Array.isArray(options.handlers ?? []) ||
      (options.resolveStackEffect !== undefined && typeof options.resolveStackEffect !== 'function')) failure('CILMS0001');
  if (options.signal != null && (typeof options.signal !== 'object' || typeof options.signal.aborted !== 'boolean')) {
    failure('CILMS0001', undefined, 'Invalid cancellation signal');
  }
  try {
    dataflowLimit(options.maxDataflowInstructions, 1000000, 1000000);
    dataflowLimit(options.maxDataflowEdges, 4000000, 4000000);
    dataflowLimit(options.maxDataflowSteps, 16000000, 16000000);
  } catch (error) {
    if (!(error instanceof CilError)) throw error;
    failure('CILMS0001', undefined, error.message);
  }
  dataflowCancellation(options.signal);
  const limits = regionSettings(code?.length, options.handlers ?? [], options);
  const instructions = decodeInstructionGroups(code, limits);
  validateRegions(code, instructions, options.handlers ?? [], options);
  const handlers = (options.handlers ?? []).map(handler => ({ ...handler, flags: handler.flags ?? 0,
    ...(handler.flags === 1 ? { catchType: handler.filterOffset ?? handler.catchType } : {}),
  }));
  const method = { instructions, handlers };
  const offsets = new Map(instructions.map((instruction, index) => [instruction.offset, index]));
  const graph = dataflowBlocks(method, offsets, options);
  for (const block of graph.blocks) {
    if (block.successors.includes(-1)) failure('CILMS0005', instructions[block.end - 1].offset, 'Control flow leaves the method');
  }
  const result = { peak: 0, heights: handlers.length ? new Map() : null };
  const worklist = new DataflowWorklist(graph, {
    emptyState: 0,
    stopped: () => false,
    invalidEdge: () => failure('CILMS0005', undefined, 'Control flow leaves the method'),
    merge(incoming, stored, block) {
      if (incoming !== stored) failure('CILMS0003', instructions[block.start].offset, 'Inconsistent stack height at join');
      return stored;
    },
    transfer: transfer(method, options, result),
  }, options);
  worklist.enqueue(graph.blocks.length ? 0 : -1, 0);
  for (const handler of handlers) {
    dataflowCancellation(options.signal);
    const index = offsets.get(handler.target);
    worklist.enqueue(graph.blockAt[index], handler.flags === 0 || handler.flags === 1 ? 1 : 0);
    if (handler.flags === 1) worklist.enqueue(graph.blockAt[offsets.get(handler.catchType)], 1);
  }
  worklist.run();
  if (handlers.length) validateHandlerEntryHeights(method, offsets, result.heights, (_method, instruction, _code, message) =>
    failure('CILMS0003', instruction?.offset, message), { filteredHandlers: true });
  return { status: 'complete', maxStack: result.peak, diagnostics: [],
    hasDynamicStackAllocation: instructions.some(instruction => instruction.name === 'localloc') };
}

/** Exact reachable height bound using canonical decoding/EH/dataflow, not CLR type verification.
 * Variable opcodes require resolveStackEffect(group) -> {pops,pushes}, including ret; null means unknown.
 * Unknown/invalid/budget/cancelled results have maxStack:null. Unexpected resolver exceptions propagate.
 * Byte offsets, clauses and limits use the existing prefix-group/EH/dataflow APIs; no input is retained.
 */
export function analyzeMaxStack(code, options = {}) {
  try {
    return analyze(code, options);
  } catch (error) {
    if (error instanceof EffectResolutionFailure) throw error.original;
    if (!(error instanceof CilError)) throw error;
    const code = error.code ?? (error.limitKind ? 'CILMS0006' : 'CILMS0001');
    const cancelled = options?.signal?.aborted === true || code === 'CILDF0002' || code === 'CILR0003';
    const status = cancelled ? 'cancelled' : code === 'CILMS0002' ? 'unknown'
      : code === 'CILDF0001' || code === 'CILR0002' || code === 'CILR0028' || error.limitKind ? 'limited' : 'invalid';
    return { status, maxStack: null, diagnostics: [{ code, offset: error.offset ?? null, message: error.message,
      ...(error.limitKind ? { limitKind: error.limitKind } : {}) }],
      hasDynamicStackAllocation: null };
  }
}
