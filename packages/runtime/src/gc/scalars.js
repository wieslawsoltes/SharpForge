import {binary, unary, compare, convert, float, number} from '../execution/numeric-ops.js';
import {ManagedFault} from './fault.js';

const context = Object.freeze({fault: (name, message) => new ManagedFault(name, message)});
const binaryNames = Object.freeze({'+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'rem', '&': 'and', '|': 'or', '^': 'xor'});
const compareNames = Object.freeze({'==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge'});
const convertNames = Object.freeze({Long: 'i8', Native: 'i', Int32: 'i4', Double: 'r8'});
const opaque = value => value && typeof value === 'object' && typeof value.kind === 'string' && value.kind.includes('token');

function numeric(value) {
  if (opaque(value)) throw new ManagedFault('NotSupportedException', 'Opaque GC address tokens do not support numeric arithmetic');
  return value;
}

function literal(text, native) {
  if (typeof text !== 'string' || text.length > 32 || !/^-?\d+$/.test(text)) {
    throw new ManagedFault('FormatException', 'Invalid GC scalar integer constant');
  }
  const value = BigInt(text);
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) throw new ManagedFault('OverflowException', 'Int64 constant overflow');
  return native ? convert('conv.ovf.i', value, context) : value;
}

function scalarCompare(left, right, operation) {
  const name = compareNames[operation];
  if (!name) throw new ManagedFault('InvalidProgramException', 'Invalid GC scalar comparison');
  if (opaque(left) || opaque(right)) {
    if (name !== 'eq' && name !== 'ne') throw new ManagedFault('NotSupportedException', 'GC tokens only support identity comparisons');
    const equal = left === right || opaque(left) && opaque(right) && left.owner === right.owner &&
      left.kind === right.kind && left.value === right.value;
    return name === 'eq' ? equal : !equal;
  }
  return compare(left, right, name, false, context);
}

/** Source adapter only: all arithmetic delegates to the same exact helpers as direct CLI execution. */
export function invokeGCScalar(platform, descriptor, args) {
  const values = args.map(value => platform.native(value));
  const name = descriptor.name;
  let result;
  if (name.startsWith('Constant')) result = literal(values[0], name.endsWith('Native'));
  else if (name.startsWith('Convert')) {
    const target = convertNames[name.slice(7)];
    if (!target) throw new ManagedFault('MissingMethodException', name);
    const input = values[1] === 'double' ? float(numeric(values[0])) : numeric(values[0]);
    result = convert('conv.' + (values[2] && target !== 'r8' ? 'ovf.' : '') + target, input, context);
  } else if (name.startsWith('Compare')) result = scalarCompare(values[0], values[1], values[2]);
  else if (name.startsWith('Binary')) {
    const operation = binaryNames[values[2]];
    if (!operation) throw new ManagedFault('InvalidProgramException', 'Invalid GC scalar binary operator');
    result = binary(operation + (values[3] && ['add', 'sub', 'mul'].includes(operation) ? '.ovf' : ''),
      numeric(values[0]), numeric(values[1]), context);
  } else if (name.startsWith('Shift')) {
    const operation = {'<<': 'shl', '>>': 'shr', '>>>': 'shr.un'}[values[2]];
    if (!operation) throw new ManagedFault('InvalidProgramException', 'Invalid GC scalar shift');
    result = binary(operation, numeric(values[0]), numeric(values[1]), context);
  } else if (name.startsWith('Unary')) {
    const value = numeric(values[0]);
    if (values[1] === '+') result = value;
    else if (values[1] === '-' && values[2]) result = binary('sub.ovf', typeof value === 'bigint' ? 0n : 0, value, context);
    else if (values[1] === '-' || values[1] === '~') result = unary(values[1] === '-' ? 'neg' : 'not', value, context);
    else throw new ManagedFault('InvalidProgramException', 'Invalid GC scalar unary operator');
  } else throw new ManagedFault('MissingMethodException', name);
  return {handled: true, value: platform.managed(number(result), descriptor.result)};
}
