import {float} from '@sharpforge/bytecode';
import {ManagedFault} from '../heap.js';
import {StackCategory} from './numeric-stack-types.js';

const C = StackCategory;
const comparisons = Object.freeze({
  eq: (left, right) => left === right, ne: (left, right) => left !== right,
  gt: (left, right) => left > right, ge: (left, right) => left >= right,
  lt: (left, right) => left < right, le: (left, right) => left <= right,
});
const divideByZero = () => { throw new ManagedFault('DivideByZeroException', 'Attempted to divide by zero'); };
const overflow = () => { throw new ManagedFault('OverflowException', 'Checked arithmetic overflow'); };
const i4 = Object.freeze({
  add: (left, right) => (left + right) | 0,
  sub: (left, right) => (left - right) | 0,
  mul: (left, right) => Math.imul(left, right),
  and: (left, right) => left & right,
  or: (left, right) => left | right,
  xor: (left, right) => left ^ right,
  shl: (left, right) => left << (right & 31),
  shr: (left, right) => left >> (right & 31),
  'shr.un': (left, right) => (left >>> (right & 31)) | 0,
});
const i8 = Object.freeze({
  add: (left, right) => BigInt.asIntN(64, left + right),
  sub: (left, right) => BigInt.asIntN(64, left - right),
  mul: (left, right) => BigInt.asIntN(64, left * right),
  and: (left, right) => left & right,
  or: (left, right) => left | right,
  xor: (left, right) => left ^ right,
});
const floating = Object.freeze({
  add: (left, right) => left + right,
  sub: (left, right) => left - right,
  mul: (left, right) => left * right,
  div: (left, right) => left / right,
  rem: (left, right) => left % right,
});
const handlers = new Map();

function i4Operation(name) {
  if (i4[name]) return i4[name];
  const [operation, modifier, suffix] = name.split('.');
  const unsigned = modifier === 'un' || suffix === 'un';
  if (['div', 'rem'].includes(operation)) return (left, right) => {
    if (unsigned) { left >>>= 0; right >>>= 0; }
    if (right === 0) divideByZero();
    if (left === -2147483648 && right === -1) {
      throw new ManagedFault('OverflowException', 'Integer division overflow');
    }
    return (operation === 'div' ? left / right : left % right) | 0;
  };
  if (modifier === 'ovf' && ['add', 'sub', 'mul'].includes(operation)) return (left, right) => {
    if (unsigned) { left >>>= 0; right >>>= 0; }
    const value = operation === 'add' ? left + right : operation === 'sub' ? left - right : left * right;
    if (value < (unsigned ? 0 : -2147483648) || value > (unsigned ? 4294967295 : 2147483647)) overflow();
    return value | 0;
  };
  return null;
}

function arithmeticHandler(name, left, right) {
  if (left === C.i4 && right === C.i4) {
    const operation = i4Operation(name);
    return operation ? vm => { const second = vm.pop(), first = vm.pop(); vm.push(operation(first, second)); } : null;
  }
  if (left === C.i8 && right === C.i8 && i8[name]) {
    const operation = i8[name];
    return vm => { const second = vm.pop(), first = vm.pop(); vm.push(operation(first, second)); };
  }
  if ([C.r4, C.r8].includes(left) && [C.r4, C.r8].includes(right) && floating[name]) {
    const operation = floating[name], kind = left === C.r4 && right === C.r4 ? 'r4' : 'r8';
    return vm => { const second = vm.pop(), first = vm.pop(); vm.push(float(operation(first.value, second.value), kind)); };
  }
  return null;
}

function comparisonHandler(name, left, right) {
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match || left !== right || ![C.i4, C.i8, C.r4, C.r8].includes(left)) return null;
  const [, form, comparison, modifier] = match, operation = comparisons[comparison], unsigned = !!modifier;
  const compare = left === C.i4 ? unsigned ? (a, b) => operation(a >>> 0, b >>> 0) : operation :
    left === C.i8 ? unsigned ? (a, b) => operation(BigInt.asUintN(64, a), BigInt.asUintN(64, b)) : operation :
      (a, b) => Number.isNaN(a.value) || Number.isNaN(b.value) ? comparison === 'ne' || unsigned : operation(a.value, b.value);
  return (vm, frame, instruction) => {
    const second = vm.pop(), first = vm.pop(), result = compare(first, second);
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(instruction.operand);
  };
}

/** Select once at decode time; hot handlers trust only categories proven by dataflow. */
export function specializedNumericHandler(name, state) {
  if (!state || state.length < 2) return null;
  const left = state.at(-2), right = state.at(-1), key = name + ':' + left + ':' + right;
  if (handlers.has(key)) return handlers.get(key);
  const handler = arithmeticHandler(name, left, right) ?? comparisonHandler(name, left, right);
  const resultCategory = [left, right].includes(C.r8) ? C.r8 : left;
  const kind = Object.keys(C).find(candidate => C[candidate] === resultCategory);
  const result = handler ? Object.freeze({id: name.replaceAll('.', '_') + '_' + kind, handler}) : null;
  handlers.set(key, result);
  return result;
}
