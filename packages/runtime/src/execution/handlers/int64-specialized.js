import {int64Binary, int64Compare, int64Unary} from '@sharpforge/bytecode';
import {ManagedFault} from '../../heap.js';
import {StackCategory} from '../numeric-stack-types.js';

const minimum = -(1n << 63n);
const maximum = (1n << 63n) - 1n;
const canonical = value => typeof value === 'bigint' && value >= minimum && value <= maximum;
const canonicalCount = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const context = Object.freeze({fault: (name, message) => new ManagedFault(name, message)});
const operations = new Map([
  ['add', (left, right) => BigInt.asIntN(64, left + right)],
  ['sub', (left, right) => BigInt.asIntN(64, left - right)],
  ['mul', (left, right) => BigInt.asIntN(64, left * right)],
  ['and', (left, right) => left & right],
  ['or', (left, right) => left | right],
  ['xor', (left, right) => left ^ right],
  ['shl', (left, right) => BigInt.asIntN(64, left << (BigInt(right) & 63n))],
  ['shr', (left, right) => left >> (BigInt(right) & 63n)],
  ['shr.un', (left, right) => BigInt.asIntN(64, BigInt.asUintN(64, left) >> (BigInt(right) & 63n))]
]);
const comparisons = Object.freeze({
  eq: order => order === 0, ne: order => order !== 0,
  gt: order => order > 0, ge: order => order >= 0,
  lt: order => order < 0, le: order => order <= 0
});

// Keep checked bounds and managed division/remainder faults in the shared helper.
for (const name of ['div', 'rem', 'div.un', 'rem.un', 'add.ovf', 'sub.ovf', 'mul.ovf',
  'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un']) {
  operations.set(name, (left, right) => int64Binary(name, left, right, context));
}

function binaryHandler(operation, acceptsRight, generic) {
  return (vm, frame, instruction) => {
    const stack = frame.stack;
    if (vm.options.specializeNumericHandlers !== true || !canonical(stack.at(-2)) ||
        !acceptsRight(stack.at(-1))) return generic(vm, frame, instruction);
    const right = vm.pop();
    const left = vm.pop();
    vm.push(operation(left, right));
  };
}

function comparisonHandler(name, generic) {
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match) return null;
  const [, form, comparison, unsigned] = match;
  const accepts = comparisons[comparison];
  return (vm, frame, instruction) => {
    const stack = frame.stack;
    if (vm.options.specializeNumericHandlers !== true || !canonical(stack.at(-2)) ||
        !canonical(stack.at(-1))) return generic(vm, frame, instruction);
    const right = vm.pop();
    const left = vm.pop();
    const result = accepts(int64Compare(left, right, !!unsigned));
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(instruction.operand);
  };
}

/** Select only proven Int64 operations; actual BigInt stack patterns are guarded at dispatch. */
export function specializedInt64Handler(name, state, generic) {
  if (!state) return null;
  const rightType = state.at(-1);
  let handler;
  if ((name === 'neg' || name === 'not') && rightType === StackCategory.i8) {
    handler = (vm, frame, instruction) => {
      if (vm.options.specializeNumericHandlers !== true || !canonical(frame.stack.at(-1))) return generic(vm, frame, instruction);
      vm.push(int64Unary(name, vm.pop(), context));
    };
  } else if (state.at(-2) === StackCategory.i8) {
    const shift = name === 'shl' || name === 'shr' || name === 'shr.un';
    const acceptsRight = rightType === StackCategory.i8 ? canonical :
      shift && rightType === StackCategory.i4 ? canonicalCount : null;
    if (!acceptsRight) return null;
    const operation = operations.get(name);
    handler = operation ? binaryHandler(operation, acceptsRight, generic) : comparisonHandler(name, generic);
  }
  return handler ? {id: name.replaceAll('.', '_') + '_i8', handler} : null;
}
