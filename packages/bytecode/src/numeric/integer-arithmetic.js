import {checkedInteger, numericFault} from './checked.js';

/** BigInt arithmetic for the CLI i8 and native categories, and checked i4. */
export function integerArithmetic(name, left, right, bits, context = {}) {
  const operation = name.split('.')[0];
  const unsigned = name.endsWith('.un');
  const checked = name.includes('.ovf');
  let first = BigInt(left);
  let second = BigInt(right);
  if (unsigned) {
    first = BigInt.asUintN(bits, first);
    second = BigInt.asUintN(bits, second);
  }
  if ((operation === 'div' || operation === 'rem') && second === 0n) {
    numericFault(context, 'DivideByZeroException', 'Attempted to divide by zero');
  }
  if ((operation === 'div' || operation === 'rem') && !unsigned && first === -(1n << BigInt(bits - 1)) && second === -1n) {
    numericFault(context, 'OverflowException', 'Integer division overflow');
  }
  const shift = second & BigInt(bits - 1);
  let result;
  switch (operation) {
    case 'add': result = first + second; break;
    case 'sub': result = first - second; break;
    case 'mul': result = first * second; break;
    case 'div': result = first / second; break;
    case 'rem': result = first % second; break;
    case 'and': result = first & second; break;
    case 'or': result = first | second; break;
    case 'xor': result = first ^ second; break;
    case 'shl': result = first << shift; break;
    case 'shr': result = first >> shift; break;
    default:
      if (context.error) throw context.error('Unknown arithmetic opcode');
      numericFault(context, 'CilError', 'Unknown arithmetic opcode');
  }
  if (checked) checkedInteger(result, bits, unsigned, context);
  return BigInt.asIntN(bits, result);
}
