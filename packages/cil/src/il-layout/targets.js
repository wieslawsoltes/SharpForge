import { CilError } from '../binary.js';

/** Resolve both recorded symbolic fixups and existing numeric branch targets before layout. */
export function resolveLayoutTargets(instructions, labels, fixups) {
  const starts = new Map();
  for (let index = 0; index < instructions.length; index++) starts.set(instructions[index].offset, index);
  const pending = new Map();
  for (const fixup of fixups) {
    if (!labels.has(fixup.label)) throw new CilError(`Undefined IL label '${fixup.label}'`);
    if (pending.has(fixup.at)) throw new CilError('Duplicate CIL layout fixup');
    pending.set(fixup.at, { ...fixup, target: labels.get(fixup.label) });
  }
  function target(at, base, size, numeric, offset) {
    const fixup = pending.get(at);
    if (fixup && (fixup.base !== base || fixup.size !== size)) throw new CilError('Invalid CIL layout fixup', offset);
    const destination = fixup ? fixup.target : numeric;
    pending.delete(at);
    const index = starts.get(destination);
    if (index === undefined) throw new CilError('Branch target is not an instruction boundary', offset);
    return index;
  }
  const targets = new Int32Array(instructions.length);
  for (let index = 0; index < instructions.length; index++) {
    const instruction = instructions[index], { offset, size, operandKind } = instruction;
    if (operandKind === 'br8' || operandKind === 'br32') {
      targets[index] = target(offset + 1, offset + size, size - 1, instruction.operand, offset);
    } else if (operandKind === 'switch') {
      for (let slot = 0; slot < instruction.operand.length; slot++) {
        instruction.operand[slot] = target(offset + 5 + slot * 4, offset + size, 4, instruction.operand[slot], offset);
      }
    }
  }
  if (pending.size) throw new CilError('CIL layout fixup is not an operand boundary');
  return targets;
}
