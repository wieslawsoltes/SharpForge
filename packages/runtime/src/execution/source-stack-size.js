import {Op, memoryStackEffect} from '@sharpforge/bytecode';

const effects = new Map([
  [Op.SEQ, 0], [Op.NOP, 0], [Op.ENDFINALLY, 0], [Op.JUMP, 0],
  [Op.CONST, 1], [Op.LDLOC, 1], [Op.LDSTATIC, 1], [Op.NEWOBJ, 1], [Op.ENUM, 1],
  [Op.STLOC, 0], [Op.STSTATIC, 0], [Op.LDFLD, 0], [Op.STFLD, -1],
  [Op.DUP, 1], [Op.POP, -1], [Op.BINARY, -1], [Op.UNARY, 0], [Op.CONVERT, 0],
  [Op.JFALSE, -1], [Op.JTRUE, -1], [Op.RET, -1], [Op.NEWARR, 0],
  [Op.LDELEM, -1], [Op.STELEM, -2], [Op.LENGTH, 0], [Op.THROW, -1],
  [Op.ENDFILTER, -1], [Op.RETHROW, 0], [Op.DELEGATE, 0], [Op.LDIND, 0], [Op.STIND, -1]
]);
const endings = new Set([Op.RET, Op.THROW, Op.RETHROW, Op.ENDFINALLY, Op.ENDFILTER]);

/** Maximum evaluation slots for an already verified source method, in O(IL). */
export function sourceStackSlots(method, constants = []) {
  const heights = new Map();
  const queue = [[0, 0]];
  for (const handler of method.handlers) {
    queue.push([handler.target, 0]);
    if (handler.filter !== undefined) queue.push([handler.filter, 0]);
  }
  let maximum = 0;
  while (queue.length) {
    const [offset, height] = queue.pop();
    if (heights.has(offset)) continue;
    heights.set(offset, height);
    const opcode = method.code[offset * 3];
    const operand = method.code[offset * 3 + 1];
    const count = method.code[offset * 3 + 2];
    let change = memoryStackEffect(opcode, operand, count, constants)?.delta ?? effects.get(opcode);
    if (opcode === Op.CALL || opcode === Op.BUILTIN) change = 1 - count;
    if (opcode === Op.ADDRESS) change = 1 - ((operand & 3) === 3 ? 2 : (operand & 3) === 2 ? 1 : 0);
    if (change === undefined) throw new TypeError('Unknown source stack effect');
    const after = height + change;
    maximum = Math.max(maximum, height, after);
    if (endings.has(opcode)) continue;
    if (opcode === Op.JUMP || opcode === Op.JFALSE || opcode === Op.JTRUE) queue.push([operand, after]);
    if (opcode !== Op.JUMP && offset + 1 < method.code.length / 3) queue.push([offset + 1, after]);
  }
  return maximum;
}
