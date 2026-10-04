import {ManagedFault} from '../../heap.js';
import {StackCategory} from '../numeric-stack-types.js';

const minimum = -2147483648;
const maximum = 2147483647;
const unsignedMaximum = 4294967295;
const canonical = value => Number.isInteger(value) && value >= minimum && value <= maximum;
const overflow = () => { throw new ManagedFault('OverflowException', 'Checked arithmetic overflow'); };
const operations = new Map([
  ['add', (left, right) => (left + right) | 0],
  ['sub', (left, right) => (left - right) | 0],
  ['mul', (left, right) => Math.imul(left, right)],
  ['and', (left, right) => left & right],
  ['or', (left, right) => left | right],
  ['xor', (left, right) => left ^ right],
  ['shl', (left, right) => left << (right & 31)],
  ['shr', (left, right) => left >> (right & 31)],
  ['shr.un', (left, right) => (left >>> (right & 31)) | 0]
]);
const comparisons = Object.freeze({
  eq: (left, right) => left === right, ne: (left, right) => left !== right,
  gt: (left, right) => left > right, ge: (left, right) => left >= right,
  lt: (left, right) => left < right, le: (left, right) => left <= right
});

for (const operation of ['div', 'rem']) {
  for (const unsigned of [false, true]) {
    operations.set(operation + (unsigned ? '.un' : ''), (left, right) => {
      if (unsigned) {
        left >>>= 0;
        right >>>= 0;
      }
      if (right === 0) throw new ManagedFault('DivideByZeroException', 'Attempted to divide by zero');
      // CoreCLR Int32 MinValue / -1 and MinValue % -1 both raise overflow.
      if (left === minimum && right === -1) throw new ManagedFault('OverflowException', 'Integer division overflow');
      return (operation === 'div' ? left / right : left % right) | 0;
    });
  }
}
for (const [name, operation] of [['add', (left, right) => left + right],
  ['sub', (left, right) => left - right], ['mul', (left, right) => left * right]]) {
  for (const unsigned of [false, true]) {
    operations.set(name + '.ovf' + (unsigned ? '.un' : ''), (left, right) => {
      if (unsigned) {
        left >>>= 0;
        right >>>= 0;
      }
      const result = operation(left, right);
      // All non-overflowing 32-bit results are exact JS integers, including products.
      if (result < (unsigned ? 0 : minimum) || result > (unsigned ? unsignedMaximum : maximum)) overflow();
      return result | 0;
    });
  }
}

function binaryHandler(operation, generic) {
  return (vm, frame, instruction) => {
    const stack = frame.stack;
    if (vm.options.specializeNumericHandlers !== true || !canonical(stack.at(-2)) ||
        !canonical(stack.at(-1))) return generic(vm, frame, instruction);
    const right = vm.pop();
    const left = vm.pop();
    vm.push(operation(left, right));
  };
}

function comparisonHandler(name, generic) {
  const match = /^(c|b)(eq|ne|lt|le|gt|ge)(\.un)?(\.s)?$/.exec(name);
  if (!match) return null;
  const [, form, comparison, unsigned] = match;
  const compare = comparisons[comparison];
  return (vm, frame, instruction) => {
    const stack = frame.stack;
    if (vm.options.specializeNumericHandlers !== true || !canonical(stack.at(-2)) ||
        !canonical(stack.at(-1))) return generic(vm, frame, instruction);
    const right = vm.pop();
    const left = vm.pop();
    const result = unsigned ? compare(left >>> 0, right >>> 0) : compare(left, right);
    if (form === 'c') vm.push(result ? 1 : 0);
    else if (result) frame.pc = frame.offsets.get(instruction.operand);
  };
}

/** Predecode selects width and operation once; host-edited noncanonical slots use the original handler. */
export function specializedInt32Handler(name, state, generic) {
  if (!state || state.at(-1) !== StackCategory.i4) return null;
  let handler;
  if (name === 'neg' || name === 'not') {
    handler = (vm, frame, instruction) => {
      if (vm.options.specializeNumericHandlers !== true || !canonical(frame.stack.at(-1))) return generic(vm, frame, instruction);
      const value = vm.pop();
      vm.push(name === 'neg' ? (-value) | 0 : ~value);
    };
  } else if (state.at(-2) === StackCategory.i4) {
    const operation = operations.get(name);
    handler = operation ? binaryHandler(operation, generic) : comparisonHandler(name, generic);
  }
  return handler ? {id: name.replaceAll('.', '_') + '_i4', handler} : null;
}
