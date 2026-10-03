import {convert as cilConvert,float} from './numeric-ops.js';
import {ManagedFault, isReference} from '../heap.js';

export const defaultValue = type => type === 'int' || type === 'double' ? 0 : type === 'bool' ? false : null;

/** Source numeric modes: 0 floating, 1 Int32, 2 string, 3 Boolean, 5 checked Int32. */
export function binary(vm, operator, a, b, mode = 0) {
  if (mode === 2 && operator === '+') return vm.heap.string(vm.format(a) + vm.format(b), [a, b]);
  const l = vm.value(a), r = vm.value(b);
  if (mode === 5) {
    const value = operator === '+' ? BigInt(l) + BigInt(r) : operator === '-' ? BigInt(l) - BigInt(r) : BigInt(l) * BigInt(r);
    if (value < -2147483648n || value > 2147483647n) throw new ManagedFault('OverflowException', 'Checked Int32 arithmetic overflow');
    return Number(value);
  }
  const same = () => isReference(l) && isReference(r) ? l.h === r.h && l.g === r.g : l === r;
  switch (operator) {
    case '+': return mode === 1 ? (l + r) | 0 : l + r;
    case '-': return mode === 1 ? (l - r) | 0 : l - r;
    case '*': return mode === 1 ? Math.imul(l, r) : l * r;
    case '/':
      if (mode === 1) {
        if (r === 0) throw new ManagedFault('DivideByZeroException', 'Attempted to divide by zero');
        if (l === -2147483648 && r === -1) throw new ManagedFault('OverflowException', 'Integer division overflow');
        return (l / r) | 0;
      }
      return l / r;
    case '%':
      if (mode === 1 && r === 0) throw new ManagedFault('DivideByZeroException', 'Attempted to divide by zero');
      return mode === 1 ? (l % r) | 0 : l % r;
    case '==': return same();
    case '!=': return !same();
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    case '>=': return l >= r;
    case '&': return mode === 3 ? Boolean(l & r) : l & r;
    case '|': return mode === 3 ? Boolean(l | r) : l | r;
    case '^': return mode === 3 ? Boolean(l ^ r) : l ^ r;
    case '<<': return l << (r & 31);
    case '>>': return l >> (r & 31);
    default: throw new ManagedFault('InvalidProgramException', 'Unknown binary operation');
  }
}

export function convert(value, type, checked = 0) {
  if (type !== 0) return Number(value);
  return cilConvert(checked === 1 ? 'conv.ovf.i4' : 'conv.i4', float(value), {
    fault: (name, message) => new ManagedFault(name, message)
  });
}

export function unary(operator, value, mode = 0) {
  if (mode === 5 && value === -2147483648) throw new ManagedFault('OverflowException', 'Checked Int32 negation overflow');
  switch (operator) {
    case '!': return !value;
    case '~': return ~value;
    case '-': return mode === 1 || mode === 5 ? (-value) | 0 : -value;
    default: return +value;
  }
}
