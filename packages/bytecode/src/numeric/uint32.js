import {integerArithmetic} from './integer-arithmetic.js';
import {numericFault} from './checked.js';

/** i4 arithmetic preserves the signed stack pattern; .un selects unsigned meaning. */
export function uint32Binary(name, left, right, context = {}) {
  if (name.includes('.ovf')) return Number(integerArithmetic(name, left, right, 32, context));
  const operation = name.split('.')[0];
  const unsigned = name.endsWith('.un');
  const first = unsigned ? left >>> 0 : left | 0;
  const second = unsigned ? right >>> 0 : right | 0;
  if ((operation === 'div' || operation === 'rem') && second === 0) {
    numericFault(context, 'DivideByZeroException', 'Attempted to divide by zero');
  }
  if (operation === 'div' && !unsigned && first === -2147483648 && second === -1) {
    numericFault(context, 'OverflowException', 'Integer division overflow');
  }
  switch (operation) {
    case 'add': return (first + second) | 0;
    case 'sub': return (first - second) | 0;
    case 'mul': return Math.imul(first, second);
    case 'div': return (first / second) | 0;
    case 'rem': return (first % second) | 0;
    case 'and': return first & second;
    case 'or': return first | second;
    case 'xor': return first ^ second;
    case 'shl': return first << (second & 31);
    case 'shr': return unsigned ? (first >>> (second & 31)) | 0 : first >> (second & 31);
    default:
      if (context.error) throw context.error('Unknown arithmetic opcode');
      numericFault(context, 'CilError', 'Unknown arithmetic opcode');
  }
}

/** Unsigned ordering is independent of the signed i4 storage representation. */
export function uint32Compare(left, right) {
  const first = left >>> 0;
  const second = right >>> 0;
  return first < second ? -1 : first > second ? 1 : 0;
}
