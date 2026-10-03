import {Op} from '@sharpforge/bytecode';
import {CilError} from './binary.js';

export function analyzeReferenceInstruction(stack, instruction, image, method, types) {
  const {op, a, b} = instruction;
  if (![Op.ADDRESS, Op.LDIND, Op.STIND].includes(op)) return false;
  const pop = () => {
    if (!stack.length) throw new CilError('Managed reference stack underflow');
    return stack.pop();
  };
  if (op === Op.ADDRESS) {
    const kind = a & 3;
    let type;
    if (kind === 0) type = method.locals[b].type;
    else if (kind === 1) type = image.statics[b].type;
    else if (kind === 2) type = types.get(pop().replace(/&$/, ''))?.fields[b]?.type;
    else { pop(); const array = pop(); if (array.endsWith('[]')) type = array.slice(0, -2); }
    if (!type || a & 8 && !type.endsWith('&')) throw new CilError('Unknown managed address type');
    stack.push(a & 8 ? type : type + '&');
  } else {
    if (op === Op.STIND) pop();
    const pointer = pop(), type = image.constants[a];
    if (pointer !== type + '&') throw new CilError('Managed reference storage type mismatch');
    stack.push(type);
  }
  return true;
}
