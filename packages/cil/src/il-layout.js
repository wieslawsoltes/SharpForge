import { Writer, CilError } from './binary.js';
import { CilOpcodes } from './opcodes/catalog.js';
import { decodeInstructionBytes } from './opcodes/decoder.js';
import { LayoutOffsets } from './il-layout/offsets.js';
import { resolveLayoutTargets } from './il-layout/targets.js';

const branchForms = new Map();
for (const opcode of Object.values(CilOpcodes)) {
  if (opcode.operand !== 'br32') continue;
  const short = CilOpcodes[opcode.name + '.s'];
  if (short?.operand !== 'br8') continue;
  const pair = Object.freeze({ short, long: opcode });
  branchForms.set(opcode.name, pair);
  branchForms.set(short.name, pair);
}

function checkCancellation(signal) {
  if (signal?.aborted) throw new CilError('CIL layout cancelled');
}

function relax(instructions, targets, signal) {
  const sizes = Uint32Array.from(instructions, instruction => branchForms.has(instruction.name) ? 2 : instruction.size);
  const offsets = new LayoutOffsets(sizes), queue = [];
  function widenIfNeeded(index) {
    if (sizes[index] !== 2 || !branchForms.has(instructions[index].name)) return;
    const delta = offsets.before(targets[index]) - offsets.before(index) - 2;
    if (delta >= -128 && delta <= 127) return;
    sizes[index] = 5;
    offsets.widen(index);
    queue.push(index);
  }
  for (let index = 0; index < instructions.length; index++) {
    checkCancellation(signal);
    widenIfNeeded(index);
  }
  for (let head = 0; head < queue.length; head++) {
    checkCancellation(signal);
    const changed = queue[head];
    // A still-short branch crossing this point has at most 128 instruction boundaries
    // between its source and target: every encoded instruction occupies at least one byte.
    for (let index = Math.max(0, changed - 128); index < Math.min(sizes.length, changed + 129); index++) {
      widenIfNeeded(index);
    }
  }
  return sizes;
}

function encode(bytes, instructions, targets, sizes, signal) {
  const positions = new Uint32Array(sizes.length + 1), offsetMap = new Map();
  for (let index = 0; index < sizes.length; index++) {
    positions[index + 1] = positions[index] + sizes[index];
    offsetMap.set(instructions[index].offset, positions[index]);
  }
  offsetMap.set(bytes.length, positions.at(-1));
  const writer = new Writer(positions.at(-1));
  for (let index = 0; index < instructions.length; index++) {
    checkCancellation(signal);
    const instruction = instructions[index], pair = branchForms.get(instruction.name);
    if (pair) {
      writer.u8(sizes[index] === 2 ? pair.short.value : pair.long.value);
      const delta = positions[targets[index]] - positions[index + 1];
      if (sizes[index] === 2) writer.u8(delta);
      else writer.u32(delta);
      continue;
    }
    writer.bytes(bytes.subarray(instruction.offset, instruction.offset + instruction.size));
    if (instruction.operandKind === 'switch') {
      for (let slot = 0; slot < instruction.operand.length; slot++) {
        writer.patch32(positions[index] + 5 + slot * 4, positions[instruction.operand[slot]] - positions[index + 1]);
      }
    }
  }
  return { code: writer.finish(), offsetMap };
}

/** Internal bounded layout for CilWriter.finishWithLayout; never mutates the original writer. */
export function finishCilLayout(bytes, labels, fixups, { maxInstructions = 1_000_000, signal } = {}) {
  checkCancellation(signal);
  if (!Number.isInteger(maxInstructions) || maxInstructions < 0 || maxInstructions > 1_000_000) {
    throw new CilError('Invalid CIL layout instruction limit');
  }
  if (bytes.length > 16 * 1024 * 1024 || labels.size > 1_000_000 || fixups.length > 1_000_000) {
    throw new CilError('CIL layout input limit exceeded');
  }
  const instructions = decodeInstructionBytes(bytes, maxInstructions, 1_000_000);
  checkCancellation(signal);
  const targets = resolveLayoutTargets(instructions, labels, fixups);
  const sizes = relax(instructions, targets, signal);
  return encode(bytes, instructions, targets, sizes, signal);
}
