import { CilError } from '../binary.js';
import { CilOpcodes } from '../opcodes/catalog.js';
import { decodeInstructionBytes } from '../opcodes/decoder.js';
import { decodedExceptionRegions } from '../eh-regions/build.js';
import { exceptionClausePayload } from '../exception-clauses.js';
import { controlFlowCancellation, controlFlowExtents, controlFlowFailure } from './cfg-contracts.js';

export function decodeControlFlow(code, handlers, limits) {
  if (!(code instanceof Uint8Array)) controlFlowFailure('CILCFG0001');
  controlFlowExtents(code.length, handlers, limits);
  let instructions;
  try {
    instructions = decodeInstructionBytes(code, limits.maxInstructions);
  } catch (error) {
    controlFlowCancellation(limits.signal);
    if (!(error instanceof CilError)) throw error;
    const code = error.message.includes('instruction limit') ? 'CILCFG0002' : 'CILCFG0004';
    controlFlowFailure(code, error.message, error.offset);
  }
  controlFlowCancellation(limits.signal);
  return { codeSize: code.length, instructions, handlers };
}

function ownedHandlers(handlers, signal) {
  const result = [];
  for (const handler of handlers) {
    controlFlowCancellation(signal);
    if (!handler || typeof handler !== 'object') controlFlowFailure('CILCFG0001');
    result.push({ start: handler.start, end: handler.end, target: handler.target, handlerEnd: handler.handlerEnd,
      flags: handler.flags ?? 0, catchType: handler.catchType, filterOffset: handler.filterOffset });
  }
  return result;
}

function instructionOffsets(method, limits) {
  if (!Array.isArray(method.instructions)) controlFlowFailure('CILCFG0001');
  if (method.instructions.length > limits.maxInstructions) controlFlowFailure('CILCFG0002');
  const offsets = new Map();
  let offset = 0;
  let targetCount = 0;
  for (let index = 0; index < method.instructions.length; index++) {
    controlFlowCancellation(limits.signal);
    const instruction = method.instructions[index];
    if (!instruction || !Object.hasOwn(CilOpcodes, instruction.name) || instruction.offset !== offset ||
        !Number.isSafeInteger(instruction.size) || instruction.size <= 0 || instruction.size > method.codeSize - offset ||
        instruction.operandKind !== CilOpcodes[instruction.name].operand) controlFlowFailure('CILCFG0004', undefined, offset);
    if (instruction.operandKind === 'switch') {
      if (!Array.isArray(instruction.operand)) controlFlowFailure('CILCFG0004', undefined, offset);
      targetCount += instruction.operand.length;
    } else if (instruction.operandKind === 'br8' || instruction.operandKind === 'br32') targetCount++;
    if (targetCount > limits.maxEdges) controlFlowFailure('CILCFG0002');
    offsets.set(offset, index);
    offset += instruction.size;
  }
  if (offset !== method.codeSize) controlFlowFailure('CILCFG0004');
  return offsets;
}

function validateTargets(method, boundary, signal) {
  const validate = (target, source) => {
    if (!Number.isInteger(target) || target < 0 || target >= method.codeSize || !boundary(target)) {
      controlFlowFailure('CILCFG0005', undefined, source);
    }
  };
  for (const instruction of method.instructions) {
    controlFlowCancellation(signal);
    if (instruction.operandKind === 'br8' || instruction.operandKind === 'br32') validate(instruction.operand, instruction.offset);
    if (instruction.operandKind !== 'switch') continue;
    for (const target of instruction.operand) {
      controlFlowCancellation(signal);
      validate(target, instruction.offset);
    }
  }
}

/** Internal pipeline seam: reuse existing decoded records and established EH/prefix boundary validation. */
export function prepareDecodedControlFlow(method, limits) {
  controlFlowExtents(method.codeSize, method.handlers, limits);
  const offsets = instructionOffsets(method, limits);
  const handlers = ownedHandlers(method.handlers, limits.signal);
  let regions;
  try {
    regions = decodedExceptionRegions(method.codeSize, method.instructions, handlers, {
      maxCodeBytes: limits.maxCodeBytes, maxInstructions: limits.maxInstructions, maxClauses: limits.maxClauses,
      maxDepth: limits.maxRegionDepth, signal: limits.signal,
    });
  } catch (error) {
    controlFlowCancellation(limits.signal);
    throw error;
  }
  validateTargets(method, regions.boundaries, limits.signal);
  for (const handler of handlers) handler.catchType = exceptionClausePayload(handler);
  return { method: { codeSize: method.codeSize, instructions: method.instructions, handlers }, offsets };
}
