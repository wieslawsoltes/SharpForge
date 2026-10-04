import {enumTypes} from '@sharpforge/framework';
import {EnumConvertBase, decodeNumericMode, isNumericMode, isNumber, isDecimal} from '@sharpforge/bytecode';
import {scalarBinary, scalarConvert, scalarUnary, sourceNumericContext} from './scalar-ops.js';
import {checkArrayStore} from './casting.js';
import {binary as cilBinary,convert as cilConvert,float,defaults,number} from './numeric-ops.js';
import {ManagedFault, isReference} from '../heap.js';
import {enumInfo,enumValue} from './enums.js';
export {sourceEnum,enumToString} from './enums.js';
export {runtimeTypeRoots,clearRuntimeTypes,runtimeTypeText} from './tokens.js';
const numericContext = Object.freeze({fault: (name, message) => new ManagedFault(name, message)});

export function defaultValue(type,vm={}) {
  if(enumInfo(vm,type))return enumValue(vm,type,0);
  return type === 'double' ? 0 : type === 'bool' ? false : defaults(type, vm.options);
}

/** Legacy modes retain their meaning; typed modes delegate to the shared scalar helpers. */
export function binary(vm, operator, a, b, mode = 0) {
  if (mode === 2 && operator === '+') return vm.heap.string(vm.format(a) + vm.format(b), [a, b]);
  if (isNumericMode(mode)) {
    const typed = decodeNumericMode(mode);
    return scalarBinary(operator, a, b, typed.type, typed.checked, sourceNumericContext(vm));
  }
  const l = number(vm.value(a)), r = number(vm.value(b));
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
    case '/': return mode === 1 ? cilBinary('div', l, r, numericContext) : l / r;
    case '%': return mode === 1 ? cilBinary('rem', l, r, numericContext) : l % r;
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

export function convert(value, type, checked = 0, vm = {}) {
  if(type>=EnumConvertBase)return enumValue(vm,enumTypes[type-EnumConvertBase],convert(value,0,checked,vm));
  if(value?.enumType)value=value.value;
  if (isNumericMode(checked)) {
    const source = decodeNumericMode(checked);
    return scalarConvert(value, source.type, type, source.checked, sourceNumericContext(vm));
  }
  if (type !== 0) return Number(number(value));
  return cilConvert(checked === 1 ? 'conv.ovf.i4' : 'conv.i4', float(value), {
    fault: (name, message) => new ManagedFault(name, message)
  });
}

export function unary(operator, value, mode = 0, vm = {}) {
  if (isNumericMode(mode)) {
    const typed = decodeNumericMode(mode);
    return scalarUnary(operator, value, typed.type, typed.checked, sourceNumericContext(vm));
  }
  value=number(value?.enumType?value.value:value);
  if (mode === 5 && value === -2147483648) throw new ManagedFault('OverflowException', 'Checked Int32 negation overflow');
  switch (operator) {
    case '!': return !value;
    case '~': return ~value;
    case '-': return mode === 1 || mode === 5 ? (-value) | 0 : -value;
    default: return +value;
  }
}

/** Source bytecode keeps scalar object values unboxed until CIL emission. */
export function checkSourceArrayStore(vm,record,value) {
  if(record.methodTable.elementType===vm.heap.methodTables.get('object')&&!isReference(value)&&
      (value?.enumType||isNumber(value)||isDecimal(value)||typeof value==='boolean'))return value;
  return checkArrayStore(vm.heap,record,value);
}
