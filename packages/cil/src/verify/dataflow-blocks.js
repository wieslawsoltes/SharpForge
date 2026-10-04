import { opcodeByName } from '../opcodes/catalog.js';
import { dataflowLimit, dataflowFailure, dataflowCancellation } from './dataflow.js';

function fallsThrough(instruction) {
  const flow = opcodeByName[instruction.name]?.flowControl;
  return flow !== 'Branch' && flow !== 'Return' && flow !== 'Throw' && instruction.name !== 'jmp';
}

function isBranch(instruction) {
  return instruction.operandKind === 'br8' || instruction.operandKind === 'br32';
}

function markTargets(method, offsets, starts, limits) {
  const mark = offset => {
    const index = offsets.get(offset);
    if (index !== undefined) starts[index] = 1;
  };
  let edges = 0;
  for (let index = 0; index < method.instructions.length; index++) {
    dataflowCancellation(limits.signal);
    const instruction = method.instructions[index];
    const branch = isBranch(instruction);
    const switching = instruction.operandKind === 'switch';
    if (branch || switching || !fallsThrough(instruction)) starts[index + 1] = 1;
    if (branch) {
      if (++edges > limits.edges) dataflowFailure('Dataflow edge limit exceeded');
      mark(instruction.operand);
    }
    if (!switching) continue;
    if (instruction.operand.length > limits.edges - edges) dataflowFailure('Dataflow edge limit exceeded');
    edges += instruction.operand.length;
    for (const target of instruction.operand) {
      dataflowCancellation(limits.signal);
      mark(target);
    }
  }
  for (const handler of method.handlers) {
    dataflowCancellation(limits.signal);
    mark(handler.start);
    mark(handler.end);
    mark(handler.target);
    mark(handler.handlerEnd);
    if (handler.flags === 1) mark(handler.catchType);
  }
}

function connectBlocks(blocks, blockAt, method, offsets, limits) {
  let edges = 0;
  const connect = (block, index) => {
    if (++edges > limits.edges) dataflowFailure('Dataflow edge limit exceeded');
    block.successors.push(index === undefined || index >= blockAt.length ? -1 : blockAt[index]);
  };
  for (const block of blocks) {
    dataflowCancellation(limits.signal);
    const last = method.instructions[block.end - 1];
    if (isBranch(last)) connect(block, offsets.get(last.operand));
    if (last.operandKind === 'switch') {
      for (const target of last.operand) {
        dataflowCancellation(limits.signal);
        connect(block, offsets.get(target));
      }
    }
    if (fallsThrough(last)) connect(block, block.end);
  }
}

/** Build O(instructions + edges + clauses) basic blocks from already decoded IL and its existing offset map.
 * Invalid targets stay explicit until reached. No body reread, instruction decode or metadata lookup occurs. */
export function dataflowBlocks(method, offsets, options = {}) {
  const count = method.instructions.length;
  const maxInstructions = dataflowLimit(options.maxDataflowInstructions, 1000000, 1000000);
  const limits = { edges: dataflowLimit(options.maxDataflowEdges, 4000000, 4000000), signal: options.signal };
  dataflowCancellation(limits.signal);
  if (count > maxInstructions) dataflowFailure('Dataflow instruction limit exceeded');
  const starts = new Uint8Array(count + 1);
  starts[0] = 1;
  starts[count] = 1;
  markTargets(method, offsets, starts, limits);
  const blockAt = new Uint32Array(count);
  const blocks = [];
  let start = 0;
  for (let end = 1; end <= count; end++) {
    if ((end & 255) === 0) dataflowCancellation(limits.signal);
    if (!starts[end]) continue;
    blockAt.fill(blocks.length, start, end);
    const name = method.instructions[end - 1].name;
    blocks.push({ start, end, successors: [], clearStack: name === 'leave' || name === 'leave.s' });
    start = end;
  }
  connectBlocks(blocks, blockAt, method, offsets, limits);
  return { blocks, blockAt };
}
