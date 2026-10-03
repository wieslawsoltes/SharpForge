import {memoryOpcodes as Op} from './memory-types.js';

export function memoryStackEffect(op, a, b, constants) {
  const rank = () => Number.isInteger(a) && a >= 2 && a <= 32;
  const element = () => typeof constants[a] === 'string' && constants[a].length > 0;
  switch (op) {
    case Op.SPANDEFAULT: return {need: 0, delta: 1, valid: element() && (b === 0 || b === 1)};
    case Op.NEWRECT: return {need: b, delta: 1 - b, valid: element() && b >= 2 && b <= 32};
    case Op.LDRECT: case Op.RECTADDR: return {need: a + 1, delta: -a, valid: rank()};
    case Op.STRECT: return {need: a + 2, delta: -a - 1, valid: rank()};
    case Op.STACKALLOC: return {need: 1, delta: 0, valid: element()};
    case Op.SPANGET: case Op.SPANADDR: return {need: 2, delta: -1, valid: a === 0 && b === 0};
    case Op.SPANSET: return {need: 3, delta: -2, valid: a === 0 && b === 0};
    case Op.SPANSLICE: return {need: b + 1, delta: -b, valid: b === 1 || b === 2};
    case Op.SPANLENGTH: case Op.SPANREADONLY: return {need: 1, delta: 0, valid: a === 0 && b === 0};
    default: return null;
  }
}
